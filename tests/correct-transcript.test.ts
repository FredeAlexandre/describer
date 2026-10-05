import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  openDescriber,
  type Processor,
  type Speaker,
  type Word,
} from "../src/core/index.ts";

const speaker1: Speaker = { id: "s1", name: "Speaker 1" };
const speaker2: Speaker = { id: "s2", name: "Speaker 2" };

function fixtureProcessor(words: readonly Word[]): Processor {
  const speakerIds = new Set(words.map((word) => word.speakerId));
  const speakers = [speaker1, speaker2].filter((speaker) =>
    speakerIds.has(speaker.id),
  );
  return {
    process: async () => ({ speakers, words }),
  };
}

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speakerId: string,
  paragraphBreakBefore = false,
): Word {
  return { id, text, start, end, speakerId, paragraphBreakBefore };
}

test("changing Word text leaves start and end times put", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: speaker1,
        words: [{ ...hello, text: "Hey" }, there],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleting a Word leaves the Source unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "media-bytes");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.deleteWord(there);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      { speaker: speaker2, words: [thanks] },
    ]);
    expect(opened.project.sourcePath).toBe(sourcePath);
    await access(sourcePath, constants.F_OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inserted missed words inherit neighboring times", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const did = word("w1", "did", 0, 0.4, "s1");
  const go = word("w2", "go", 0.5, 0.9, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([did, go]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    const inserted = await opened.insertWord(did, "not", "after");
    expect(inserted.text).toBe("not");
    expect(inserted.start).toBe(0.4);
    expect(inserted.end).toBe(0.5);
    expect(inserted.speakerId).toBe("s1");
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [did, inserted, go] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missed word at the edge copies the neighbor's times", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    const before = await opened.insertWord(hello, "Okay", "before");
    const after = await opened.insertWord(hello, "team", "after");
    expect(before.start).toBe(0);
    expect(before.end).toBe(0.4);
    expect(after.start).toBe(0);
    expect(after.end).toBe(0.4);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [before, hello, after] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inserting a paragraph break starts a new Utterance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const again = word("w2", "again", 0.45, 0.9, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, again]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, again] },
    ]);
    await opened.insertParagraphBreak(again);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      {
        speaker: speaker1,
        words: [{ ...again, paragraphBreakBefore: true }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Transcript edits are written to the Library Project as they happen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    await opened.deleteWord(there);
    const inserted = await opened.insertWord(hello, "team", "after");
    await opened.insertParagraphBreak(inserted);
    const reopened = await openDescriber({ libraryDir });
    const again = reopened.openProject(project.id);
    expect(again.transcript.utterances).toEqual([
      { speaker: speaker1, words: [{ ...hello, text: "Hey" }] },
      {
        speaker: speaker1,
        words: [{ ...inserted, paragraphBreakBefore: true }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo and redo reverse Transcript text edits in the current session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, there] },
    ]);
    expect(await opened.redo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: speaker1,
        words: [{ ...hello, text: "Hey" }, there],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo reverses insert, delete, and paragraph-break edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    const inserted = await opened.insertWord(hello, "team", "after");
    await opened.insertParagraphBreak(inserted);
    await opened.deleteWord(there);
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      {
        speaker: speaker1,
        words: [{ ...inserted, paragraphBreakBefore: true }, there],
      },
    ]);
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, inserted, there] },
    ]);
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, there] },
    ]);
    expect(await opened.undo()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo does not reverse Transcript edits after the session is reopened", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    const reopened = await openDescriber({ libraryDir });
    const again = reopened.openProject(project.id);
    expect(await again.undo()).toBe(false);
    expect(again.transcript.utterances).toEqual([
      { speaker: speaker1, words: [{ ...hello, text: "Hey" }] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo writes the restored Transcript to the Library", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    await opened.undo();
    const reopened = await openDescriber({ libraryDir });
    const again = reopened.openProject(project.id);
    expect(again.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a later Transcript edit clears redo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    expect(await opened.undo()).toBe(true);
    await opened.changeWordText(hello, "Hi");
    expect(await opened.redo()).toBe(false);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [{ ...hello, text: "Hi" }] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo does not reverse import or delete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-correct-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const otherPath = path.join(root, "retro.wav");
  await writeFile(sourcePath, "");
  await writeFile(otherPath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.changeWordText(hello, "Hey");
    const imported = await describer.importSource(otherPath, "French");
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
    expect(describer.library.projects.map((entry) => entry.id)).toEqual([
      project.id,
      imported.id,
    ]);
    await describer.deleteProject(imported.id);
    expect(await opened.undo()).toBe(false);
    expect(describer.library.projects.map((entry) => entry.id)).toEqual([
      project.id,
    ]);
    await describer.deleteProject(project.id);
    expect(describer.library.projects).toEqual([]);
    await access(sourcePath, constants.F_OK);
    await access(otherPath, constants.F_OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
