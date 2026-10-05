import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber, fixtureProcessor } from "../src/core/index.ts";

test("importing a Source adds a Project titled from the Source filename", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    expect(project.title).toBe("standup.mp4");
    expect(describer.library.projects).toEqual([project]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recorded-at defaults to the Source file time", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const sourceStat = await stat(sourcePath);
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    expect(project.recordedAt).toEqual(sourceStat.mtime);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import stores the Source path and the chosen language", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "French");
    expect(project.sourcePath).toBe(sourcePath);
    expect(project.language).toBe("French");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import language defaults to last used", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const firstPath = path.join(root, "standup.mp4");
  const secondPath = path.join(root, "retro.wav");
  await writeFile(firstPath, "");
  await writeFile(secondPath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    await describer.importSource(firstPath, "French");
    const project = await describer.importSource(secondPath);
    expect(project.language).toBe("French");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("imported Project persists in the Library without an explicit Save", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "French");
    const reopened = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    expect(reopened.library.projects).toEqual([project]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("last used language persists across launches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const firstPath = path.join(root, "standup.mp4");
  const secondPath = path.join(root, "retro.wav");
  await writeFile(firstPath, "");
  await writeFile(secondPath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    await describer.importSource(firstPath, "French");
    const reopened = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await reopened.importSource(secondPath);
    expect(project.language).toBe("French");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("title, recorded-at, and language edits persist without an explicit Save", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-import-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  const recordedAt = new Date("2026-03-04T15:00:00.000Z");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, {
      title: "Weekly standup",
      recordedAt,
      language: "French",
    });
    const reopened = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    expect(reopened.library.projects).toEqual([
      {
        id: project.id,
        title: "Weekly standup",
        recordedAt,
        language: "French",
        sourcePath,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
