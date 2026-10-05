import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { openDescriber, fixtureProcessor } from "../src/core/index.ts";

const execFileAsync = promisify(execFile);

async function writeVideoSource(sourcePath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=16x16:d=0.1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=8000:cl=mono:d=0.1",
    "-shortest",
    "-y",
    sourcePath,
  ]);
}

async function writeAudioMp4(sourcePath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=8000:cl=mono:d=0.1",
    "-c:a",
    "aac",
    "-y",
    sourcePath,
  ]);
}

test("opening a Project plays the Source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.playback.playing).toBe(true);
    expect(opened.playback.currentTime).toBe(0);
    expect(opened.playback.rate).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a video Source has a picture when opened", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeVideoSource(sourcePath);
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.hasPicture).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an audio-only Source has no picture when opened", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "memo.wav");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.hasPicture).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an audio-only mp4 Source has no picture when opened", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "memo.mp4");
  await writeAudioMp4(sourcePath);
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.hasPicture).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("playback current time advances at 1, 1.5, and 2", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  let now = 0;
  try {
    const describer = await openDescriber({ libraryDir, now: () => now, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    now = 1000;
    expect(opened.playback.currentTime).toBe(1);
    opened.setRate(2);
    expect(opened.playback.rate).toBe(2);
    now = 2000;
    expect(opened.playback.currentTime).toBe(3);
    opened.setRate(1.5);
    expect(opened.playback.rate).toBe(1.5);
    now = 3000;
    expect(opened.playback.currentTime).toBe(4.5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing Source stays listed and playback does not start", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    await rm(sourcePath);
    const reopened = await openDescriber({ libraryDir, now: () => 0, processor: fixtureProcessor() });
    expect(reopened.library.projects).toEqual([project]);
    const opened = reopened.openProject(project.id);
    expect(opened.playback.playing).toBe(false);
    expect(opened.play()).toBe(false);
    expect(opened.playback.playing).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editing an open Project keeps playback going", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  let now = 0;
  try {
    const describer = await openDescriber({ libraryDir, now: () => now, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    now = 1000;
    await describer.updateProject(project.id, { title: "Weekly standup" });
    expect(opened.project.title).toBe("Weekly standup");
    expect(opened.playback.playing).toBe(true);
    expect(opened.playback.currentTime).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opening a Project does not play the Source while processing is still in flight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  let finish: (() => void) | undefined;
  try {
    const describer = await openDescriber({
      libraryDir,
      now: () => 0,
      processor: {
        process(_sourcePath, _language, controls) {
          return new Promise((resolve) => {
            finish = () => {
              void fixtureProcessor()
                .process(_sourcePath, _language, controls)
                .then(resolve);
            };
          });
        },
      },
    });
    const pending = describer.importSource(sourcePath, "English");
    await expect.poll(() => describer.library.projects).toHaveLength(1);
    const queued = describer.library.projects[0];
    if (queued === undefined) {
      throw new Error("queued Project missing");
    }
    const opened = describer.openProject(queued.id);
    expect(opened.transcript.editable).toBe(false);
    expect(opened.playback.playing).toBe(false);
    finish?.();
    const project = await pending;
    const completed = describer.openProject(project.id);
    expect(completed.transcript.editable).toBe(true);
    expect(completed.playback.playing).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
