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

test("the Library lists Projects sorted by recorded-at", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-search-"));
  const libraryDir = path.join(root, "library");
  const olderPath = path.join(root, "standup.mp4");
  const newerPath = path.join(root, "retro.wav");
  await writeFile(olderPath, "");
  await writeFile(newerPath, "");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(),
    });
    const firstImported = await describer.importSource(olderPath, "English");
    const secondImported = await describer.importSource(newerPath, "English");
    await describer.updateProject(firstImported.id, {
      recordedAt: new Date("2026-01-01T10:00:00.000Z"),
    });
    await describer.updateProject(secondImported.id, {
      recordedAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    expect(describer.library.projects.map((project) => project.id)).toEqual([
      secondImported.id,
      firstImported.id,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Library search matches a Project title", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-search-"));
  const libraryDir = path.join(root, "library");
  const standupPath = path.join(root, "standup.mp4");
  const retroPath = path.join(root, "retro.wav");
  await writeFile(standupPath, "");
  await writeFile(retroPath, "");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(),
    });
    const standup = await describer.importSource(standupPath, "English");
    await describer.updateProject(standup.id, { title: "Weekly standup" });
    const retro = await describer.importSource(retroPath, "English");
    await describer.updateProject(retro.id, { title: "Sprint retro" });
    const hits = describer.searchLibrary("standup");
    expect(hits.map((hit) => hit.project.id)).toEqual([standup.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Library search matches a Speaker name", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-search-"));
  const libraryDir = path.join(root, "library");
  const standupPath = path.join(root, "standup.mp4");
  const retroPath = path.join(root, "retro.wav");
  await writeFile(standupPath, "");
  await writeFile(retroPath, "");
  const alex: Speaker = { id: "s1", name: "Alex" };
  const sam: Speaker = { id: "s2", name: "Sam" };
  const hello = word("w1", "Hello", 0, 0.4, "s1");
  const thanks = word("w2", "Thanks", 0, 0.4, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      processor: {
        async process(sourcePath) {
          if (sourcePath === standupPath) {
            return { speakers: [alex], words: [hello] };
          }
          return { speakers: [sam], words: [thanks] };
        },
      },
    });
    const standup = await describer.importSource(standupPath, "English");
    await describer.importSource(retroPath, "English");
    const hits = describer.searchLibrary("Alex");
    expect(hits.map((hit) => hit.project.id)).toEqual([standup.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("searching Transcript text opens that Project at the matching Word", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-search-"));
  const libraryDir = path.join(root, "library");
  const standupPath = path.join(root, "standup.mp4");
  const retroPath = path.join(root, "retro.wav");
  await writeFile(standupPath, "");
  await writeFile(retroPath, "");
  const we = word("w1", "we", 0, 0.3, "s1");
  const should = word("w2", "should", 0.3, 0.7, "s1");
  const ship = word("w3", "ship", 0.7, 1.0, "s1");
  const friday = word("w4", "Friday", 1.0, 1.5, "s1");
  const hello = word("w5", "Hello", 0, 0.4, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => 0,
      processor: {
        async process(sourcePath) {
          if (sourcePath === standupPath) {
            return {
              speakers: [speaker1],
              words: [we, should, ship, friday],
            };
          }
          return { speakers: [speaker2], words: [hello] };
        },
      },
    });
    const standup = await describer.importSource(standupPath, "English");
    await describer.importSource(retroPath, "English");
    const hits = describer.searchLibrary("should ship");
    const hit = hits[0];
    expect(hit?.project.id).toBe(standup.id);
    expect(hit?.word).toEqual(should);
    const opened = describer.openProject(hit!.project.id);
    opened.seekToWord(hit!.word!);
    expect(opened.currentWord).toEqual(should);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find in the open Transcript jumps to matching Words without searching the Library", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-search-"));
  const libraryDir = path.join(root, "library");
  const standupPath = path.join(root, "standup.mp4");
  const retroPath = path.join(root, "retro.wav");
  await writeFile(standupPath, "");
  await writeFile(retroPath, "");
  const the = word("w1", "the", 0, 0.2, "s1");
  const budget = word("w2", "budget", 0.2, 0.6, "s1");
  const later = word("w3", "later", 0.6, 1.0, "s1");
  const otherBudget = word("w4", "budget", 0, 0.4, "s2");
  const cuts = word("w5", "cuts", 0.4, 0.8, "s2");
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => 0,
      processor: {
        async process(sourcePath) {
          if (sourcePath === standupPath) {
            return { speakers: [speaker1], words: [the, budget, later] };
          }
          return { speakers: [speaker2], words: [otherBudget, cuts] };
        },
      },
    });
    const standup = await describer.importSource(standupPath, "English");
    const retro = await describer.importSource(retroPath, "English");
    const opened = describer.openProject(standup.id);
    const found = opened.findInTranscript("budget");
    expect(found).toEqual([budget]);
    opened.seekToWord(found[0]!);
    expect(opened.currentWord).toEqual(budget);
    expect(
      describer.searchLibrary("budget").map((hit) => hit.project.id).sort(),
    ).toEqual([standup.id, retro.id].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
