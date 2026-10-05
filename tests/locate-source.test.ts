import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber } from "../src/core/index.ts";

test("Locate Source updates the path without replacing the Transcript", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-locate-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const movedPath = path.join(root, "moved-standup.mp4");
  await writeFile(sourcePath, "");
  await writeFile(movedPath, "");
  try {
    const describer = await openDescriber({ libraryDir });
    const project = await describer.importSource(sourcePath, "French");
    await describer.updateProject(project.id, { title: "Weekly standup" });
    const located = await describer.locateSource(project.id, movedPath);
    expect(located.sourcePath).toBe(movedPath);
    expect(located.title).toBe("Weekly standup");
    expect(located.language).toBe("French");
    expect(located.recordedAt).toEqual(project.recordedAt);
    expect(located.id).toBe(project.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Locate Source persists the new path across launches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-locate-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const movedPath = path.join(root, "moved-standup.mp4");
  await writeFile(sourcePath, "");
  await writeFile(movedPath, "");
  try {
    const describer = await openDescriber({ libraryDir });
    const project = await describer.importSource(sourcePath, "English");
    await describer.locateSource(project.id, movedPath);
    const reopened = await openDescriber({ libraryDir });
    expect(reopened.library.projects).toEqual([
      {
        id: project.id,
        title: project.title,
        recordedAt: project.recordedAt,
        language: "English",
        sourcePath: movedPath,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Locate Source restores playback for a missing Source without re-processing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-locate-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const movedPath = path.join(root, "archive", "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0 });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, { title: "Weekly standup" });
    await mkdir(path.dirname(movedPath), { recursive: true });
    await rename(sourcePath, movedPath);
    const missing = describer.openProject(project.id);
    expect(missing.playback.playing).toBe(false);
    await describer.locateSource(project.id, movedPath);
    const restored = describer.openProject(project.id);
    expect(restored.project.title).toBe("Weekly standup");
    expect(restored.project.sourcePath).toBe(movedPath);
    expect(restored.playback.playing).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Locate Source on an open Project lets playback start from the new path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-locate-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  const movedPath = path.join(root, "moved-standup.mp4");
  await writeFile(sourcePath, "");
  await writeFile(movedPath, "");
  try {
    const describer = await openDescriber({ libraryDir, now: () => 0 });
    const project = await describer.importSource(sourcePath, "English");
    await rm(sourcePath);
    const opened = describer.openProject(project.id);
    expect(opened.play()).toBe(false);
    await describer.locateSource(project.id, movedPath);
    expect(opened.project.sourcePath).toBe(movedPath);
    expect(opened.play()).toBe(true);
    expect(opened.playback.playing).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
