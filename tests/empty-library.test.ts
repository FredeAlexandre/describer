import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { openDescriber } from "../src/core/index.ts";

test("first launch shows an empty Library", async () => {
  const libraryDir = await mkdtemp(path.join(tmpdir(), "describer-library-"));
  try {
    const describer = await openDescriber({ libraryDir });
    expect(describer.library.projects).toEqual([]);
  } finally {
    await rm(libraryDir, { recursive: true, force: true });
  }
});

test("first launch creates the Library directory", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "describer-data-"));
  const libraryDir = path.join(parent, "describer", "library");
  try {
    await openDescriber({ libraryDir });
    await access(libraryDir, constants.F_OK);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Library lives in the app-owned XDG data directory", async () => {
  const dataHome = await mkdtemp(path.join(tmpdir(), "describer-xdg-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dataHome;
  try {
    const describer = await openDescriber();
    const libraryDir = path.join(dataHome, "describer", "library");
    expect(describer.library.path).toBe(libraryDir);
    expect(describer.library.projects).toEqual([]);
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = previous;
    }
    await rm(dataHome, { recursive: true, force: true });
  }
});

test("Library defaults to the XDG data home under the user home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "describer-home-"));
  const previousXdg = process.env.XDG_DATA_HOME;
  const previousHome = process.env.HOME;
  delete process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  try {
    const describer = await openDescriber();
    const libraryDir = path.join(home, ".local", "share", "describer", "library");
    expect(describer.library.path).toBe(libraryDir);
    expect(describer.library.projects).toEqual([]);
  } finally {
    if (previousXdg === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = previousXdg;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});
