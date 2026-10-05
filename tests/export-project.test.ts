import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber } from "../src/core/index.ts";

test("Export Project writes a copy that opening copies into the Library", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-export-"));
  const libraryDir = path.join(root, "library");
  const otherLibrary = path.join(root, "other-library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "backup", "standup.project");
  await writeFile(sourcePath, "media-bytes");
  try {
    const describer = await openDescriber({ libraryDir });
    const project = await describer.importSource(sourcePath, "French");
    await describer.updateProject(project.id, { title: "Weekly standup" });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await describer.exportProject(project.id, exportPath);

    const other = await openDescriber({ libraryDir: otherLibrary });
    const imported = await other.importProject(exportPath);
    expect(imported.title).toBe("Weekly standup");
    expect(imported.language).toBe("French");
    expect(imported.sourcePath).toBe(sourcePath);
    expect(imported.recordedAt).toEqual(project.recordedAt);
    expect(other.library.projects).toEqual([imported]);
    await access(sourcePath, constants.F_OK);
    expect(await readdir(path.dirname(exportPath))).toEqual(["standup.project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("edits after opening a Project file apply to the Library copy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "describer-export-"));
  const libraryDir = path.join(root, "library");
  const otherLibrary = path.join(root, "other-library");
  const thirdLibrary = path.join(root, "third-library");
  const sourcePath = path.join(root, "standup.mp4");
  const exportPath = path.join(root, "standup.project");
  await writeFile(sourcePath, "media-bytes");
  try {
    const describer = await openDescriber({ libraryDir });
    const project = await describer.importSource(sourcePath, "English");
    await describer.updateProject(project.id, { title: "Weekly standup" });
    await describer.exportProject(project.id, exportPath);

    const other = await openDescriber({ libraryDir: otherLibrary });
    const imported = await other.importProject(exportPath);
    expect(imported.id).not.toBe(project.id);
    await other.updateProject(imported.id, { title: "Edited working copy" });
    const reopened = await openDescriber({ libraryDir: otherLibrary });
    expect(reopened.library.projects).toEqual([
      {
        id: imported.id,
        title: "Edited working copy",
        recordedAt: project.recordedAt,
        language: "English",
        sourcePath,
      },
    ]);

    const third = await openDescriber({ libraryDir: thirdLibrary });
    const fromFile = await third.importProject(exportPath);
    expect(fromFile.title).toBe("Weekly standup");
    expect(fromFile.sourcePath).toBe(sourcePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
