import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber, fixtureProcessor } from "../src/core/index.ts";

test("deleting a Project removes it from the Library and never deletes the Source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-delete-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const project = await describer.importSource(sourcePath, "English");
    await describer.deleteProject(project.id);
    expect(describer.library.projects).toEqual([]);
    await access(sourcePath, constants.F_OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleted Project stays gone after reopen and the Source remains", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-delete-"));
  const libraryDir = path.join(root, "library");
  const keepPath = path.join(root, "retro.wav");
  const deletePath = path.join(root, "standup.mp4");
  await writeFile(keepPath, "");
  await writeFile(deletePath, "");
  try {
    const describer = await openDescriber({ libraryDir, processor: fixtureProcessor() });
    const kept = await describer.importSource(keepPath, "English");
    const removed = await describer.importSource(deletePath, "French");
    await describer.deleteProject(removed.id);
    const reopened = await openDescriber({ libraryDir });
    expect(reopened.library.projects).toEqual([kept]);
    await access(keepPath, constants.F_OK);
    await access(deletePath, constants.F_OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
