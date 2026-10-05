import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type Project = never;

export type Library = {
  readonly path: string;
  readonly projects: readonly Project[];
};

export type Describer = {
  readonly library: Library;
};

export type OpenDescriberOptions = {
  readonly libraryDir?: string;
};

export async function openDescriber(
  options: OpenDescriberOptions = {},
): Promise<Describer> {
  const libraryDir =
    options.libraryDir ??
    path.join(
      process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
      "describer",
      "library",
    );
  await mkdir(libraryDir, { recursive: true });

  return {
    library: {
      path: libraryDir,
      projects: [],
    },
  };
}
