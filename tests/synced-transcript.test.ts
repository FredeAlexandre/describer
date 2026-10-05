import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  openDescriber,
  type Processor,
  type ProcessorResult,
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

test("a Project whose processing produced no Words still opens with an empty Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "silence.wav");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0 });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([]);
    expect(opened.transcript.editable).toBe(true);
    expect(opened.currentWord).toBeUndefined();
    expect(opened.playback.playing).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a completed Project shows the Transcript as Utterances split on Speaker change", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
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
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, there] },
      { speaker: speaker2, words: [thanks] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a long pause starts a new Utterance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const later = word("w2", "Later", 2.5, 3.0, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, later]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      { speaker: speaker1, words: [later] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a user paragraph break starts a new Utterance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const again = word("w2", "Again", 0.5, 0.9, "s1", true);
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, again]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      { speaker: speaker1, words: [again] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clicking or selecting Transcript text seeks to the first Word in that range", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => 0,
      processor: fixtureProcessor([hello, there, thanks]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    const selected = [there, thanks];
    opened.seekToWord(selected[0]!);
    expect(opened.playback.currentTime).toBe(0.45);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("during playback the current Word follows the playhead", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 1, "s1");
  const world = word("w2", "world", 1, 2, "s1");
  let now = 0;
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => now,
      processor: fixtureProcessor([hello, world]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.currentWord).toEqual(hello);
    now = 1500;
    expect(opened.currentWord).toEqual(world);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no Word is current during a pause between Words", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.5, "s1");
  const later = word("w2", "Later", 2, 2.5, "s1");
  let now = 0;
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => now,
      processor: fixtureProcessor([hello, later]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    now = 1000;
    expect(opened.currentWord).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Transcript is not in the Library and not editable until processing finishes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  let finish!: (result: ProcessorResult) => void;
  let started!: () => void;
  const processor: Processor = {
    process: () => {
      const result = new Promise<ProcessorResult>((resolve) => {
        finish = resolve;
      });
      started();
      return result;
    },
  };
  try {
    const describer = await openDescriber({ libraryDir, processor });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = describer.importSource(sourcePath, "English");
    await ready;
    expect(describer.library.projects).toEqual([]);
    finish({ speakers: [speaker1], words: [hello] });
    const project = await pending;
    expect(describer.library.projects).toEqual([project]);
    const opened = describer.openProject(project.id);
    expect(opened.transcript.editable).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a processed Transcript is still there after reopening Describer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const thanks = word("w2", "Thanks", 0.5, 0.9, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, thanks]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const reopened = await openDescriber({ libraryDir });
    const opened = reopened.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      { speaker: speaker2, words: [thanks] },
    ]);
    expect(opened.transcript.editable).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Locate Source updates the path without replacing the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const movedPath = path.join(root, "moved-standup.mp4");
  await writeFile(sourcePath, "");
  await writeFile(movedPath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.locateSource(project.id, movedPath);
    const opened = describer.openProject(project.id);
    expect(opened.project.sourcePath).toBe(movedPath);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exporting and opening a Project file keeps the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-transcript-"));
  const libraryDir = path.join(root, "library");
  const otherLibrary = path.join(root, "other-library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.json");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportProject(project.id, exportPath);
    const other = await openDescriber({ libraryDir: otherLibrary });
    const imported = await other.importProject(exportPath);
    const opened = other.openProject(imported.id);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
    expect(opened.transcript.editable).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
