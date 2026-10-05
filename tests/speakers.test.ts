import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type Speaker,
  type Word,
} from "../src/core/index.ts";

const speaker1: Speaker = { id: "s1", name: "Speaker 1" };
const speaker2: Speaker = { id: "s2", name: "Speaker 2" };

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speakerId: string,
): Word {
  return { id, text, start, end, speakerId, paragraphBreakBefore: false };
}

test("renaming a Speaker shows the new name on that Speaker's Utterances", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.renameSpeaker(speaker1, "Alex");
    expect(opened.transcript.utterances).toEqual([
      { speaker: { id: "s1", name: "Alex" }, words: [hello, there] },
      { speaker: speaker2, words: [thanks] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merging two Speakers into one keeps a single name on their Words", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.mergeSpeakers(speaker2, speaker1);
    expect(opened.transcript.speakers).toEqual([speaker1]);
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: speaker1,
        words: [hello, there, { ...thanks, speakerId: "s1" }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reassigning selected Words to an existing Speaker updates those Utterances", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.reassignWords([there], speaker2);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
      {
        speaker: speaker2,
        words: [{ ...there, speakerId: "s2" }, thanks],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reassigning selected Words can create a new Speaker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  const alex: Speaker = { id: "s3", name: "Alex" };
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.reassignWords([hello, there], alex);
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: alex,
        words: [
          { ...hello, speakerId: "s3" },
          { ...there, speakerId: "s3" },
        ],
      },
      { speaker: speaker2, words: [thanks] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Speaker rename stays local to that Project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const standupPath = path.join(root, "standup.mp4");
  const retroPath = path.join(root, "retro.wav");
  await writeFile(standupPath, "");
  await writeFile(retroPath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const thanks = word("w2", "Thanks", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, thanks], [speaker1]),
    });
    const standup = await describer.importSource(standupPath, "English");
    const retro = await describer.importSource(retroPath, "English");
    const openedStandup = describer.openProject(standup.id);
    await openedStandup.renameSpeaker(speaker1, "Alex");
    const openedRetro = describer.openProject(retro.id);
    expect(openedStandup.transcript.utterances).toEqual([
      {
        speaker: { id: "s1", name: "Alex" },
        words: [hello, thanks],
      },
    ]);
    expect(openedRetro.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, thanks] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Speaker edits are written to the Library Project as they happen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  const alex: Speaker = { id: "s3", name: "Alex" };
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.renameSpeaker(speaker1, "Sam");
    await opened.mergeSpeakers(speaker2, { id: "s1", name: "Sam" });
    await opened.reassignWords([{ ...thanks, speakerId: "s1" }], alex);
    const reopened = await openDescriber({ libraryDir });
    const again = reopened.openProject(project.id);
    expect(again.transcript.utterances).toEqual([
      {
        speaker: { id: "s1", name: "Sam" },
        words: [hello, there],
      },
      {
        speaker: alex,
        words: [{ ...thanks, speakerId: "s3" }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo and redo reverse Speaker edits in the current session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.renameSpeaker(speaker1, "Alex");
    await opened.mergeSpeakers(speaker2, { id: "s1", name: "Alex" });
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: { id: "s1", name: "Alex" },
        words: [hello, there],
      },
      { speaker: speaker2, words: [thanks] },
    ]);
    expect(await opened.undo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello, there] },
      { speaker: speaker2, words: [thanks] },
    ]);
    expect(await opened.redo()).toBe(true);
    expect(opened.transcript.utterances).toEqual([
      {
        speaker: { id: "s1", name: "Alex" },
        words: [hello, there],
      },
      { speaker: speaker2, words: [thanks] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("undo does not reverse Speaker edits after the session is reopened", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-speakers-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello], [speaker1]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await opened.renameSpeaker(speaker1, "Alex");
    const reopened = await openDescriber({ libraryDir });
    const again = reopened.openProject(project.id);
    expect(await again.undo()).toBe(false);
    expect(again.transcript.utterances).toEqual([
      {
        speaker: { id: "s1", name: "Alex" },
        words: [hello],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

