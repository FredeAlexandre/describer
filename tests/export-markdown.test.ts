import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  return { id, text, start, end, speakerId };
}

test("Export Markdown writes title, recorded-at, language, then Utterances as readable paragraphs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-markdown-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.md");
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
    await describer.updateProject(project.id, {
      title: "Weekly standup",
      recordedAt: new Date("2026-03-04T15:00:00.000Z"),
    });
    await describer.exportMarkdown(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(body).toBe(
      [
        "# Weekly standup",
        "",
        "Recorded at: 2026-03-04T15:00:00.000Z",
        "Language: English",
        "",
        "**Speaker 1** (00:00:00.000)",
        "",
        "Hello there",
        "",
        "**Speaker 2** (00:00:00.900)",
        "",
        "Thanks",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export Markdown uses renamed Speaker names on Utterances", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-markdown-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.md");
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
    await describer.exportMarkdown(project.id, exportPath);
    const body = await readFile(exportPath, "utf8");
    expect(body).toContain("**Alex** (00:00:00.000)");
    expect(body).toContain("Hello there");
    expect(body).not.toContain("**Speaker 1**");
    expect(body).toContain("**Speaker 2** (00:00:00.900)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editing exported Markdown does not change the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-markdown-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.md");
  await writeFile(sourcePath, "");
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const there = word("w2", "there", 0.45, 0.8, "s1");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([hello, there], [speaker1]),
    });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, {
      title: "Weekly standup",
      recordedAt: new Date("2026-03-04T15:00:00.000Z"),
    });
    await describer.exportMarkdown(project.id, exportPath);
    await writeFile(exportPath, "# Edited export\n");

    const reopened = await openDescriber({ libraryDir });
    const opened = reopened.openProject(project.id);
    expect(opened.project.title).toBe("Weekly standup");
    expect(opened.transcript.utterances[0]?.words.map((entry) => entry.text)).toEqual(
      ["Hello", "there"],
    );

    const againPath = path.join(root, "again.md");
    await reopened.exportMarkdown(project.id, againPath);
    expect(await readFile(againPath, "utf8")).toBe(
      [
        "# Weekly standup",
        "",
        "Recorded at: 2026-03-04T15:00:00.000Z",
        "Language: English",
        "",
        "**Speaker 1** (00:00:00.000)",
        "",
        "Hello there",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
