import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber } from "../src/core/index.ts";

test("opening a Project plays the Source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-play-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0 });
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
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir });
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
    const describer = await openDescriber({ libraryDir });
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
    const describer = await openDescriber({ libraryDir, now: () => now });
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
    const describer = await openDescriber({ libraryDir, now: () => 0 });
    const project = await describer.importSource(sourcePath, "English");
    await rm(sourcePath);
    const reopened = await openDescriber({ libraryDir, now: () => 0 });
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
    const describer = await openDescriber({ libraryDir, now: () => now });
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
