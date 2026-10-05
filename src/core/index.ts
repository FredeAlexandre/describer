import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type Language = "French" | "English";

export type Project = {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: Date;
  readonly language: Language;
  readonly sourcePath: string;
};

export type Library = {
  readonly path: string;
  readonly projects: readonly Project[];
  readonly lastUsedLanguage: Language;
};

export type PlaybackRate = 1 | 1.5 | 2;

export type Playback = {
  readonly playing: boolean;
  readonly currentTime: number;
  readonly rate: PlaybackRate;
};

export type OpenedProject = {
  readonly project: Project;
  readonly playback: Playback;
  readonly hasPicture: boolean;
  setRate(rate: PlaybackRate): void;
  play(): boolean;
};

export type Describer = {
  readonly library: Library;
  importSource(sourcePath: string, language?: Language): Promise<Project>;
  updateProject(
    projectId: string,
    patch: {
      readonly title?: string;
      readonly recordedAt?: Date;
      readonly language?: Language;
    },
  ): Promise<Project>;
  locateSource(projectId: string, sourcePath: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  exportProject(projectId: string, destinationPath: string): Promise<void>;
  importProject(projectFilePath: string): Promise<Project>;
  openProject(projectId: string): OpenedProject;
};

export type OpenDescriberOptions = {
  readonly libraryDir?: string;
  readonly now?: () => number;
};

type StoredProject = {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly language: Language;
  readonly sourcePath: string;
};

type StoredLibrary = {
  readonly lastUsedLanguage: Language;
  readonly projects: ReadonlyArray<StoredProject>;
};

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mkv",
  ".mov",
  ".avi",
]);

function sourceHasPicture(sourcePath: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
}

class PlaybackCursor {
  private playing = false;
  private originMs = 0;
  private originTime = 0;
  private rate: PlaybackRate = 1;

  constructor(private readonly now: () => number) {}

  get snapshot(): Playback {
    return {
      playing: this.playing,
      currentTime: this.currentTime,
      rate: this.rate,
    };
  }

  get currentTime(): number {
    if (!this.playing) {
      return this.originTime;
    }
    return this.originTime + ((this.now() - this.originMs) / 1000) * this.rate;
  }

  play(): void {
    if (this.playing) {
      return;
    }
    this.originMs = this.now();
    this.playing = true;
  }

  setRate(rate: PlaybackRate): void {
    if (this.playing) {
      this.originTime = this.currentTime;
      this.originMs = this.now();
    }
    this.rate = rate;
  }
}

function defaultLibraryDir(): string {
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
    "describer",
    "library",
  );
}

function libraryFile(libraryDir: string): string {
  return path.join(libraryDir, "library.json");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function toStoredProject(project: Project): StoredProject {
  return {
    ...project,
    recordedAt: project.recordedAt.toISOString(),
  };
}

function fromStoredProject(project: StoredProject): Project {
  return {
    ...project,
    recordedAt: new Date(project.recordedAt),
  };
}

async function loadLibrary(libraryDir: string): Promise<{
  lastUsedLanguage: Language;
  projects: Project[];
}> {
  try {
    const raw = await readFile(libraryFile(libraryDir), "utf8");
    const stored = JSON.parse(raw) as StoredLibrary;
    return {
      lastUsedLanguage: stored.lastUsedLanguage,
      projects: stored.projects.map(fromStoredProject),
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return { lastUsedLanguage: "English", projects: [] };
    }
    throw error;
  }
}

export async function openDescriber(
  options: OpenDescriberOptions = {},
): Promise<Describer> {
  const libraryDir = options.libraryDir ?? defaultLibraryDir();
  await mkdir(libraryDir, { recursive: true });

  const loaded = await loadLibrary(libraryDir);
  const projects: Project[] = loaded.projects;
  let lastUsedLanguage: Language = loaded.lastUsedLanguage;
  const now = options.now ?? Date.now;

  async function persist(): Promise<void> {
    const stored: StoredLibrary = {
      lastUsedLanguage,
      projects: projects.map(toStoredProject),
    };
    await writeFile(libraryFile(libraryDir), `${JSON.stringify(stored, null, 2)}\n`);
  }

  return {
    get library(): Library {
      return {
        path: libraryDir,
        projects: [...projects],
        lastUsedLanguage,
      };
    },
    async importSource(
      sourcePath: string,
      language: Language = lastUsedLanguage,
    ): Promise<Project> {
      const sourceStat = await stat(sourcePath);
      const project: Project = {
        id: randomUUID(),
        title: path.basename(sourcePath),
        recordedAt: sourceStat.mtime,
        language,
        sourcePath,
      };
      projects.push(project);
      lastUsedLanguage = language;
      await persist();
      return project;
    },
    async updateProject(
      projectId: string,
      patch: {
        readonly title?: string;
        readonly recordedAt?: Date;
        readonly language?: Language;
      },
    ): Promise<Project> {
      const index = projects.findIndex((project) => project.id === projectId);
      if (index < 0) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const current = projects[index];
      if (current === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const updated: Project = {
        ...current,
        title: patch.title ?? current.title,
        recordedAt: patch.recordedAt ?? current.recordedAt,
        language: patch.language ?? current.language,
      };
      projects[index] = updated;
      await persist();
      return updated;
    },
    async locateSource(
      projectId: string,
      sourcePath: string,
    ): Promise<Project> {
      const index = projects.findIndex((project) => project.id === projectId);
      if (index < 0) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const current = projects[index];
      if (current === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      await stat(sourcePath);
      const updated: Project = {
        ...current,
        sourcePath,
      };
      projects[index] = updated;
      await persist();
      return updated;
    },
    async deleteProject(projectId: string): Promise<void> {
      const index = projects.findIndex((project) => project.id === projectId);
      if (index < 0) {
        throw new Error(`Project not found: ${projectId}`);
      }
      projects.splice(index, 1);
      await persist();
    },
    async exportProject(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      await writeFile(
        destinationPath,
        `${JSON.stringify(toStoredProject(project), null, 2)}\n`,
      );
    },
    async importProject(projectFilePath: string): Promise<Project> {
      const raw = await readFile(projectFilePath, "utf8");
      const stored = JSON.parse(raw) as StoredProject;
      const project: Project = {
        ...fromStoredProject(stored),
        id: randomUUID(),
      };
      projects.push(project);
      await persist();
      return project;
    },
    openProject(projectId: string): OpenedProject {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const cursor = new PlaybackCursor(now);
      const sourcePresent = existsSync(project.sourcePath);
      if (sourcePresent) {
        cursor.play();
      }
      return {
        get project(): Project {
          const current = projects.find((entry) => entry.id === projectId);
          if (current === undefined) {
            throw new Error(`Project not found: ${projectId}`);
          }
          return current;
        },
        get hasPicture(): boolean {
          const current = projects.find((entry) => entry.id === projectId);
          if (current === undefined) {
            return false;
          }
          return existsSync(current.sourcePath) && sourceHasPicture(current.sourcePath);
        },
        get playback(): Playback {
          return cursor.snapshot;
        },
        setRate(rate: PlaybackRate): void {
          cursor.setRate(rate);
        },
        play(): boolean {
          const current = projects.find((entry) => entry.id === projectId);
          if (current === undefined || !existsSync(current.sourcePath)) {
            return false;
          }
          cursor.play();
          return true;
        },
      };
    },
  };
}
