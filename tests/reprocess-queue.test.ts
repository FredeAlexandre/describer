import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type Word,
} from "../src/core/index.ts";

const speaker1 = { id: "s1", name: "Speaker 1" };

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speakerId = "s1",
): Word {
  return { id, text, start, end, speakerId, paragraphBreakBefore: false };
}

const hello = word("w1", "Hello", 0, 0.4);

async function withLibrary(
  run: (paths: { libraryDir: string; sourcePath: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "describer-reprocess-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "media-bytes");
  try {
    await run({ libraryDir, sourcePath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("re-process without confirmation leaves the Transcript unchanged", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    await expect(describer.reprocessProject(project.id, false)).rejects.toThrow(
      /confirmation/i,
    );
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [{ ...hello, text: "Hey" }] },
    ]);
    expect(opened.project.sourcePath).toBe(sourcePath);
  });
});

test("confirmed re-process replaces the Transcript and leaves the Source unchanged", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const bonjour = word("w2", "Bonjour", 0, 0.5);
    let pass = 0;
    const describer = await openDescriber({
      libraryDir,
      processor: {
        process: async (src, language, controls) => {
          pass += 1;
          const words = pass === 1 ? [hello] : [bonjour];
          return fixtureProcessor(words).process(src, language, controls);
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    const reprocessed = await describer.reprocessProject(project.id, true);
    expect(reprocessed.sourcePath).toBe(sourcePath);
    expect(reprocessed.id).toBe(project.id);
    const after = describer.openProject(project.id);
    expect(after.transcript.utterances).toEqual([
      { speaker: speaker1, words: [bonjour] },
    ]);
    expect(after.project.sourcePath).toBe(sourcePath);
    await access(sourcePath, constants.F_OK);
  });
});

test("confirmed re-process drops Speaker names from the old pass", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.renameSpeaker(speaker1, "Alex");
    expect(opened.transcript.utterances).toEqual([
      { speaker: { id: "s1", name: "Alex" }, words: [hello] },
    ]);
    await describer.reprocessProject(project.id, true);
    expect(describer.openProject(project.id).transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
    expect(describer.openProject(project.id).project.sourcePath).toBe(sourcePath);
  });
});

test("re-process is not on the undo stack", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const bonjour = word("w2", "Bonjour", 0, 0.5);
    let pass = 0;
    const describer = await openDescriber({
      libraryDir,
      processor: {
        process: async (src, language, controls) => {
          pass += 1;
          const words = pass === 1 ? [hello] : [bonjour];
          return fixtureProcessor(words).process(src, language, controls);
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    await describer.reprocessProject(project.id, true);
    expect(await opened.undo()).toBe(false);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [bonjour] },
    ]);
    const replaced = describer.openProject(project.id);
    expect(await replaced.undo()).toBe(false);
    expect(replaced.transcript.utterances).toEqual([
      { speaker: speaker1, words: [bonjour] },
    ]);
  });
});

test("importing multiple Sources queues them so only one process runs at a time", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const secondPath = path.join(path.dirname(sourcePath), "retro.wav");
    await writeFile(secondPath, "media-bytes");
    let running = 0;
    let maxRunning = 0;
    const describer = await openDescriber({
      libraryDir,
      processor: {
        async process(src, language, controls) {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 30));
          running -= 1;
          return fixtureProcessor([]).process(src, language, controls);
        },
      },
    });
    await Promise.all([
      describer.importSource(sourcePath, "English"),
      describer.importSource(secondPath, "French"),
    ]);
    expect(maxRunning).toBe(1);
    expect(describer.library.projects).toHaveLength(2);
    expect(describer.processing).toBeNull();
  });
});

test("each queued Project is uneditable until its own process finishes", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const secondPath = path.join(path.dirname(sourcePath), "retro.wav");
    await writeFile(secondPath, "media-bytes");
    const firstWords = [hello];
    const secondWords = [word("w2", "Later", 0, 0.4)];
    const gates = new Map<string, () => void>();
    const describer = await openDescriber({
      libraryDir,
      processor: {
        process(src, language, controls) {
          const words = src === sourcePath ? firstWords : secondWords;
          return new Promise((resolve) => {
            gates.set(src, () => {
              void resolve(
                fixtureProcessor(words).process(src, language, controls),
              );
            });
          });
        },
      },
    });
    const pendingFirst = describer.importSource(sourcePath, "English");
    const pendingSecond = describer.importSource(secondPath, "French");
    await expect.poll(() => describer.library.projects).toHaveLength(2);
    const firstId = describer.library.projects.find(
      (entry) => entry.sourcePath === sourcePath,
    )?.id;
    const secondId = describer.library.projects.find(
      (entry) => entry.sourcePath === secondPath,
    )?.id;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    if (firstId === undefined || secondId === undefined) {
      throw new Error("queued Projects missing");
    }
    expect(describer.openProject(firstId).transcript.editable).toBe(false);
    expect(describer.openProject(secondId).transcript.editable).toBe(false);
    gates.get(sourcePath)?.();
    const first = await pendingFirst;
    expect(describer.openProject(first.id).transcript.editable).toBe(true);
    expect(describer.openProject(secondId).transcript.editable).toBe(false);
    await expect.poll(() => gates.has(secondPath)).toBe(true);
    gates.get(secondPath)?.();
    const second = await pendingSecond;
    expect(describer.openProject(second.id).transcript.editable).toBe(true);
    expect(describer.openProject(first.id).transcript.utterances).toEqual([
      { speaker: speaker1, words: firstWords },
    ]);
    expect(describer.openProject(second.id).transcript.utterances).toEqual([
      { speaker: speaker1, words: secondWords },
    ]);
  });
});

test("re-process locks the Transcript until the new pass finishes", async () => {
  await withLibrary(async ({ libraryDir, sourcePath }) => {
    const bonjour = word("w2", "Bonjour", 0, 0.5);
    let pass = 0;
    let releaseSecond: (() => void) | undefined;
    const describer = await openDescriber({
      libraryDir,
      processor: {
        process(src, language, controls) {
          pass += 1;
          if (pass === 1) {
            return fixtureProcessor([hello]).process(src, language, controls);
          }
          return new Promise((resolve) => {
            releaseSecond = () => {
              void resolve(
                fixtureProcessor([bonjour]).process(src, language, controls),
              );
            };
          });
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    expect(describer.openProject(project.id).transcript.editable).toBe(true);
    const pending = describer.reprocessProject(project.id, true);
    await expect.poll(() => describer.processing != null).toBe(true);
    expect(describer.openProject(project.id).transcript.editable).toBe(false);
    expect(describer.openProject(project.id).transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
    releaseSecond?.();
    await pending;
    const opened = describer.openProject(project.id);
    expect(opened.transcript.editable).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [bonjour] },
    ]);
  });
});
