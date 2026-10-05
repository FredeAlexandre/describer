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

test("playing a Selection plays from its first Word through its last Word and then stops", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-selection-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  let now = 0;
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => now,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.playSelection(there, thanks)).toBe(true);
    expect(opened.playback.playing).toBe(true);
    expect(opened.playback.currentTime).toBe(0.45);
    now = 1000;
    expect(opened.playback.playing).toBe(false);
    expect(opened.playback.currentTime).toBe(1.3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("seeking a Word plays onward through the Source instead of stopping at a Selection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-selection-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  const thanks = word("w3", "Thanks", 0.9, 1.3, "s2");
  let now = 0;
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => now,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    opened.playSelection(hello, there);
    now = 200;
    opened.seekToWord(thanks);
    now = 1200;
    expect(opened.playback.playing).toBe(true);
    expect(opened.playback.currentTime).toBe(1.9);
    expect(opened.currentWord).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Citation of a Selection is quoted text, Speaker, timestamp, title, and recorded-at as plain text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-selection-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 65, 65.4, "s1");
  const there = word("w2", "there", 65.45, 65.8, "s1");
  const thanks = word("w3", "Thanks", 66, 66.4, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, {
      title: "Weekly standup",
      recordedAt: new Date("2026-03-15T09:30:00.000Z"),
    });
    const opened = describer.openProject(project.id);
    expect(opened.citation(hello, there).plainText).toBe(
      `"Hello there"\nSpeaker 1\n1:05\nWeekly standup\n2026-03-15`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Citation of a Selection is also available as Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-selection-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 65, 65.4, "s1");
  const there = word("w2", "there", 65.45, 65.8, "s1");
  const thanks = word("w3", "Thanks", 66, 66.4, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there, thanks], [speaker1, speaker2]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, {
      title: "Weekly standup",
      recordedAt: new Date("2026-03-15T09:30:00.000Z"),
    });
    const opened = describer.openProject(project.id);
    expect(opened.citation(hello, there).markdown).toBe(
      `> Hello there\n\nSpeaker 1 · 1:05 · Weekly standup · 2026-03-15`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
