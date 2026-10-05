import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type Word,
} from "../src/core/index.ts";

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  speakerId = "s1",
): Word {
  return { id, text, start, end, speakerId };
}

function captionTexts(exportBody: string): string[] {
  return exportBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "WEBVTT" &&
        !/^\d+$/.test(line) &&
        !line.includes("-->"),
    );
}

test("Export SRT writes Words as caption text without Speaker names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.srt");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4);
  const there = word("w2", "there", 0.45, 0.8);
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportSrt(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(captionTexts(body)).toEqual(["Hello there"]);
    expect(body).not.toContain("Speaker 1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export SRT wraps a 40-second Utterance by duration instead of dumping it as one caption", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.srt");
  await writeFile(sourcePath, "");
  const texts = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  const words = texts.map((text, index) =>
    word(`w${index + 1}`, text, index * 2, index * 2 + 2),
  );
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(words),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toHaveLength(1);
    expect(opened.transcript.utterances[0]?.words).toHaveLength(20);
    await describer.exportSrt(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(captionTexts(body)).toEqual([
      "one two three",
      "four five six",
      "seven eight nine",
      "ten eleven twelve",
      "thirteen fourteen fifteen",
      "sixteen seventeen eighteen",
      "nineteen twenty",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export SRT wraps caption text by length when Words fit in a short duration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.srt");
  await writeFile(sourcePath, "");
  const words = [
    word("w1", "Please", 0, 0.3),
    word("w2", "confirm", 0.3, 0.6),
    word("w3", "whether", 0.6, 0.9),
    word("w4", "the", 0.9, 1.1),
    word("w5", "budget", 1.1, 1.4),
    word("w6", "was", 1.4, 1.6),
    word("w7", "actually", 1.6, 2.0),
    word("w8", "approved", 2.0, 2.4),
    word("w9", "yesterday", 2.4, 2.9),
  ];
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(words),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportSrt(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(captionTexts(body)).toEqual([
      "Please confirm whether the budget was",
      "actually approved yesterday",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export VTT writes the same caption content as SRT", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const srtPath = path.join(root, "standup.srt");
  const vttPath = path.join(root, "standup.vtt");
  await writeFile(sourcePath, "");
  const words = [
    word("w1", "Please", 0, 0.3),
    word("w2", "confirm", 0.3, 0.6),
    word("w3", "whether", 0.6, 0.9),
    word("w4", "the", 0.9, 1.1),
    word("w5", "budget", 1.1, 1.4),
    word("w6", "was", 1.4, 1.6),
    word("w7", "actually", 1.6, 2.0),
    word("w8", "approved", 2.0, 2.4),
    word("w9", "yesterday", 2.4, 2.9),
  ];
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(words),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportSrt(project.id, srtPath);
    await describer.exportVtt(project.id, vttPath);
    const srt = await readFile(srtPath, "utf8");
    const vtt = await readFile(vttPath, "utf8");
    expect(captionTexts(vtt)).toEqual(captionTexts(srt));
    expect(captionTexts(vtt)).toEqual([
      "Please confirm whether the budget was",
      "actually approved yesterday",
    ]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(srt).not.toContain("WEBVTT");
    expect(vtt).not.toContain("Speaker 1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editing exported SRT or VTT does not change the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const srtPath = path.join(root, "standup.srt");
  const vttPath = path.join(root, "standup.vtt");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4);
  const there = word("w2", "there", 0.45, 0.8);
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportSrt(project.id, srtPath);
    await describer.exportVtt(project.id, vttPath);
    await writeFile(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nEdited SRT\n");
    await writeFile(vttPath, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEdited VTT\n");

    const reopened = await openDescriber({ libraryDir });
    const opened = reopened.openProject(project.id);
    expect(opened.transcript.utterances[0]?.words.map((entry) => entry.text)).toEqual([
      "Hello",
      "there",
    ]);

    const srtAgain = path.join(root, "again.srt");
    await reopened.exportSrt(project.id, srtAgain);
    expect(captionTexts(await readFile(srtAgain, "utf8"))).toEqual([
      "Hello there",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export SRT omits Speaker names when Words come from more than one Speaker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-captions-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.srt");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const thanks = word("w2", "Thanks", 0.5, 0.9, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, thanks]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.exportSrt(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(captionTexts(body)).toEqual(["Hello Thanks"]);
    expect(body).not.toContain("Speaker 1");
    expect(body).not.toContain("Speaker 2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
