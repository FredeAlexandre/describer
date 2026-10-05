import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
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

function readableTokens(text: string): string[] {
  return text
    .replace(/[#*_]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

async function extractPdfText(filePath: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

test("Export PDF writes the same readable content as Markdown Export", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-pdf-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const markdownPath = path.join(root, "standup.md");
  const exportPath = path.join(root, "standup.pdf");
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
    await describer.exportMarkdown(project.id, markdownPath);
    await describer.exportPdf(project.id, exportPath);
    const markdown = await readFile(markdownPath, "utf8");
    const pdfText = await extractPdfText(exportPath);
    expect(readableTokens(pdfText)).toEqual(readableTokens(markdown));
    expect(pdfText).toContain("Weekly standup");
    expect(pdfText).toContain("Recorded at: 2026-03-04T15:00:00.000Z");
    expect(pdfText).toContain("Language: English");
    expect(pdfText).toContain("Speaker 1");
    expect(pdfText).toContain("00:00:00.000");
    expect(pdfText).toContain("Hello there");
    expect(pdfText).toContain("Speaker 2");
    expect(pdfText).toContain("00:00:00.900");
    expect(pdfText).toContain("Thanks");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Export PDF uses renamed Speaker names on Utterances", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-pdf-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.pdf");
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
    await describer.exportPdf(project.id, exportPath);
    const pdfText = await extractPdfText(exportPath);
    expect(pdfText).toContain("Alex");
    expect(pdfText).toContain("00:00:00.000");
    expect(pdfText).toContain("Hello there");
    expect(pdfText).not.toContain("Speaker 1");
    expect(pdfText).toContain("Speaker 2");
    expect(pdfText).toContain("00:00:00.900");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editing exported PDF does not change the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-pdf-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.pdf");
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
    await describer.exportPdf(project.id, exportPath);
    await writeFile(exportPath, "not a transcript");

    const reopened = await openDescriber({ libraryDir });
    const opened = reopened.openProject(project.id);
    expect(opened.project.title).toBe("Weekly standup");
    expect(opened.transcript.utterances[0]?.words.map((entry) => entry.text)).toEqual(
      ["Hello", "there"],
    );

    const againPath = path.join(root, "again.pdf");
    await reopened.exportPdf(project.id, againPath);
    const pdfText = await extractPdfText(againPath);
    expect(pdfText).toContain("Weekly standup");
    expect(pdfText).toContain("Hello there");
    expect(pdfText).not.toContain("not a transcript");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
