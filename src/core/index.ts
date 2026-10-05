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

export type Speaker = {
  readonly id: string;
  readonly name: string;
};

export type Word = {
  readonly id: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly speakerId: string;
  readonly paragraphBreakBefore?: boolean;
};

export type Utterance = {
  readonly speaker: Speaker;
  readonly words: readonly Word[];
};

export type Transcript = {
  readonly utterances: readonly Utterance[];
  readonly editable: boolean;
};

export type OpenedProject = {
  readonly project: Project;
  readonly playback: Playback;
  readonly hasPicture: boolean;
  readonly transcript: Transcript;
  readonly currentWord: Word | undefined;
  setRate(rate: PlaybackRate): void;
  play(): boolean;
  seekToWord(word: Word): void;
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

export type ProcessorResult = {
  readonly speakers: readonly Speaker[];
  readonly words: readonly Word[];
};

export type Processor = {
  process(sourcePath: string, language: Language): Promise<ProcessorResult>;
};

export type OpenDescriberOptions = {
  readonly libraryDir?: string;
  readonly now?: () => number;
  readonly processor?: Processor;
};

type StoredProject = {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly language: Language;
  readonly sourcePath: string;
  readonly speakers?: readonly Speaker[];
  readonly words?: readonly Word[];
};

type StoredLibrary = {
  readonly lastUsedLanguage: Language;
  readonly projects: ReadonlyArray<StoredProject>;
};

type StoredTranscript = {
  readonly speakers: readonly Speaker[];
  readonly words: readonly Word[];
};

const EMPTY_TRANSCRIPT: StoredTranscript = { speakers: [], words: [] };

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

const emptyProcessor: Processor = {
  async process() {
    return { speakers: [], words: [] };
  },
};

const LONG_PAUSE_SECONDS = 2;

function utterancesFrom(
  speakers: readonly Speaker[],
  words: readonly Word[],
): Utterance[] {
  const byId = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const utterances: Array<{ speaker: Speaker; words: Word[] }> = [];
  for (const word of words) {
    const speaker = byId.get(word.speakerId);
    if (speaker === undefined) {
      throw new Error(`Unknown Speaker: ${word.speakerId}`);
    }
    const current = utterances[utterances.length - 1];
    const previous = current?.words[current.words.length - 1];
    const longPause =
      previous !== undefined &&
      word.start - previous.end >= LONG_PAUSE_SECONDS;
    if (
      current === undefined ||
      current.speaker.id !== speaker.id ||
      longPause ||
      word.paragraphBreakBefore === true
    ) {
      utterances.push({ speaker, words: [word] });
    } else {
      current.words.push(word);
    }
  }
  return utterances;
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

  seek(time: number): void {
    this.originTime = time;
    if (this.playing) {
      this.originMs = this.now();
    }
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

function toStoredProject(
  project: Project,
  transcript: StoredTranscript = EMPTY_TRANSCRIPT,
): StoredProject {
  return {
    id: project.id,
    title: project.title,
    recordedAt: project.recordedAt.toISOString(),
    language: project.language,
    sourcePath: project.sourcePath,
    speakers: transcript.speakers,
    words: transcript.words,
  };
}

function fromStoredProject(project: StoredProject): Project {
  return {
    id: project.id,
    title: project.title,
    recordedAt: new Date(project.recordedAt),
    language: project.language,
    sourcePath: project.sourcePath,
  };
}

function transcriptFromStored(project: StoredProject): StoredTranscript {
  return {
    speakers: project.speakers ?? [],
    words: (project.words ?? []).map((word) => ({
      ...word,
      paragraphBreakBefore: word.paragraphBreakBefore === true,
    })),
  };
}

async function loadLibrary(libraryDir: string): Promise<{
  lastUsedLanguage: Language;
  projects: Project[];
  transcripts: Map<
    string,
    { speakers: readonly Speaker[]; words: readonly Word[] }
  >;
}> {
  try {
    const raw = await readFile(libraryFile(libraryDir), "utf8");
    const stored = JSON.parse(raw) as StoredLibrary;
    const transcripts = new Map<string, StoredTranscript>();
    const projects = stored.projects.map((project) => {
      transcripts.set(project.id, transcriptFromStored(project));
      return fromStoredProject(project);
    });
    return {
      lastUsedLanguage: stored.lastUsedLanguage,
      projects,
      transcripts,
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        lastUsedLanguage: "English",
        projects: [],
        transcripts: new Map(),
      };
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
  const transcripts = loaded.transcripts;
  let lastUsedLanguage: Language = loaded.lastUsedLanguage;
  const now = options.now ?? Date.now;
  const processor = options.processor ?? emptyProcessor;

  async function persist(): Promise<void> {
    const stored: StoredLibrary = {
      lastUsedLanguage,
      projects: projects.map((project) =>
        toStoredProject(project, transcripts.get(project.id) ?? EMPTY_TRANSCRIPT),
      ),
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
      const processed = await processor.process(sourcePath, language);
      utterancesFrom(processed.speakers, processed.words);
      const project: Project = {
        id: randomUUID(),
        title: path.basename(sourcePath),
        recordedAt: sourceStat.mtime,
        language,
        sourcePath,
      };
      projects.push(project);
      transcripts.set(project.id, {
        speakers: processed.speakers,
        words: processed.words.map((word) => ({
          id: word.id,
          text: word.text,
          start: word.start,
          end: word.end,
          speakerId: word.speakerId,
          paragraphBreakBefore: word.paragraphBreakBefore === true,
        })),
      });
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
      transcripts.delete(projectId);
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
        `${JSON.stringify(
          toStoredProject(
            project,
            transcripts.get(project.id) ?? EMPTY_TRANSCRIPT,
          ),
          null,
          2,
        )}\n`,
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
      transcripts.set(project.id, transcriptFromStored(stored));
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
      const stored = transcripts.get(projectId) ?? {
        speakers: [],
        words: [],
      };
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
        get transcript(): Transcript {
          return {
            utterances: utterancesFrom(stored.speakers, stored.words),
            editable: true,
          };
        },
        get currentWord(): Word | undefined {
          const time = cursor.currentTime;
          return stored.words.find(
            (word) => word.start <= time && time < word.end,
          );
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
        seekToWord(word: Word): void {
          cursor.seek(word.start);
        },
      };
    },
  };
}
