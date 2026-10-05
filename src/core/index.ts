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
  openProject(projectId: string): OpenedProject;
};

export type OpenDescriberOptions = {
  readonly libraryDir?: string;
  readonly now?: () => number;
};

type StoredLibrary = {
  readonly lastUsedLanguage: Language;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly recordedAt: string;
    readonly language: Language;
    readonly sourcePath: string;
  }>;
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

async function loadLibrary(libraryDir: string): Promise<{
  lastUsedLanguage: Language;
  projects: Project[];
}> {
  try {
    const raw = await readFile(libraryFile(libraryDir), "utf8");
    const stored = JSON.parse(raw) as StoredLibrary;
    return {
      lastUsedLanguage: stored.lastUsedLanguage,
      projects: stored.projects.map((project) => ({
        id: project.id,
        title: project.title,
        recordedAt: new Date(project.recordedAt),
        language: project.language,
        sourcePath: project.sourcePath,
      })),
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
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        recordedAt: project.recordedAt.toISOString(),
        language: project.language,
        sourcePath: project.sourcePath,
      })),
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
        id: current.id,
        title: patch.title ?? current.title,
        recordedAt: patch.recordedAt ?? current.recordedAt,
        language: patch.language ?? current.language,
        sourcePath: current.sourcePath,
      };
      projects[index] = updated;
      await persist();
      return updated;
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
        hasPicture: sourcePresent && sourceHasPicture(project.sourcePath),
        get playback(): Playback {
          return cursor.snapshot;
        },
        setRate(rate: PlaybackRate): void {
          cursor.setRate(rate);
        },
        play(): boolean {
          if (!existsSync(project.sourcePath)) {
            return false;
          }
          cursor.play();
          return true;
        },
      };
    },
  };
}
