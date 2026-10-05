import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { onDeviceProcessor } from "./on-device-processor.js";

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
  readonly speakers: readonly Speaker[];
};

export type Processing = {
  readonly progress: number;
};

export type WordPlacement = "before" | "after";

export type OpenedProject = {
  readonly project: Project;
  readonly playback: Playback;
  readonly hasPicture: boolean;
  readonly transcript: Transcript;
  readonly currentWord: Word | undefined;
  setRate(rate: PlaybackRate): void;
  play(): boolean;
  seekToWord(word: Word): void;
  findInTranscript(query: string): readonly Word[];
  changeWordText(word: Word, text: string): Promise<void>;
  deleteWord(word: Word): Promise<void>;
  insertWord(
    neighbor: Word,
    text: string,
    placement: WordPlacement,
  ): Promise<Word>;
  insertParagraphBreak(word: Word): Promise<void>;
  renameSpeaker(speaker: Speaker, name: string): Promise<void>;
  mergeSpeakers(from: Speaker, into: Speaker): Promise<void>;
  reassignWords(words: readonly Word[], speaker: Speaker): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
};

export type SearchHit = {
  readonly project: Project;
  readonly word: Word | undefined;
};

export type Describer = {
  readonly library: Library;
  readonly processing: Processing | null;
  importSource(sourcePath: string, language?: Language): Promise<Project>;
  cancelProcessing(): void;
  searchLibrary(query: string): readonly SearchHit[];
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
  exportSrt(projectId: string, destinationPath: string): Promise<void>;
  exportVtt(projectId: string, destinationPath: string): Promise<void>;
  importProject(projectFilePath: string): Promise<Project>;
  openProject(projectId: string): OpenedProject;
};

export type ProcessorResult = {
  readonly speakers: readonly Speaker[];
  readonly words: readonly Word[];
};

export type ProcessorControls = {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
};

export type Processor = {
  process(
    sourcePath: string,
    language: Language,
    controls?: ProcessorControls,
  ): Promise<ProcessorResult>;
};

export function fixtureProcessor(
  words: readonly Word[] = [],
  speakers?: readonly Speaker[],
): Processor {
  const resolvedSpeakers =
    speakers ??
    [...new Set(words.map((word) => word.speakerId))].map((id) => ({
      id,
      name: id === "s1" ? "Speaker 1" : id,
    }));
  return {
    async process(_sourcePath, _language, controls) {
      if (controls?.signal.aborted === true) {
        throw new Error("Processing cancelled");
      }
      controls?.onProgress(1);
      return { speakers: resolvedSpeakers, words };
    },
  };
}

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

const LONG_PAUSE_SECONDS = 2;

function padTime(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatSrtTime(seconds: number): string {
  return formatCaptionTime(seconds, ",");
}

function formatVttTime(seconds: number): string {
  return formatCaptionTime(seconds, ".");
}

function formatCaptionTime(seconds: number, fractionSep: "," | "."): string {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${padTime(hours, 2)}:${padTime(minutes, 2)}:${padTime(secs, 2)}${fractionSep}${padTime(millis, 3)}`;
}

const MAX_CUE_DURATION_SECONDS = 7;
const MAX_CUE_LENGTH = 42;

type CaptionCue = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

function cueText(words: readonly Word[]): string {
  return words.map((entry) => entry.text).join(" ");
}

function wrapCaptionCues(words: readonly Word[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let current: Word[] = [];
  for (const entry of words) {
    const first = current[0];
    if (
      first !== undefined &&
      (entry.end - first.start > MAX_CUE_DURATION_SECONDS ||
        cueText([...current, entry]).length > MAX_CUE_LENGTH)
    ) {
      const last = current[current.length - 1];
      if (last !== undefined) {
        cues.push({ start: first.start, end: last.end, text: cueText(current) });
      }
      current = [];
    }
    current.push(entry);
  }
  const first = current[0];
  const last = current[current.length - 1];
  if (first !== undefined && last !== undefined) {
    cues.push({ start: first.start, end: last.end, text: cueText(current) });
  }
  return cues;
}

function formatSrt(cues: readonly CaptionCue[]): string {
  if (cues.length === 0) {
    return "";
  }
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`,
    )
    .join("\n");
}

function formatVtt(cues: readonly CaptionCue[]): string {
  if (cues.length === 0) {
    return "WEBVTT\n";
  }
  const body = cues
    .map(
      (cue) =>
        `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function findPhraseStarts(words: readonly Word[], needle: string): Word[] {
  if (needle.length === 0 || words.length === 0) {
    return [];
  }
  const starts: number[] = [];
  let offset = 0;
  const lowered = words.map((word, index) => {
    if (index > 0) {
      offset += 1;
    }
    starts.push(offset);
    const text = word.text.toLowerCase();
    offset += text.length;
    return text;
  });
  const joined = lowered.join(" ");
  const hits: Word[] = [];
  let from = 0;
  while (from <= joined.length - needle.length) {
    const index = joined.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    let wordIndex = 0;
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      if (start !== undefined && start <= index) {
        wordIndex = i;
      } else {
        break;
      }
    }
    const word = words[wordIndex];
    if (word !== undefined) {
      hits.push(word);
    }
    from = index + 1;
  }
  return hits;
}

function inheritedTimes(
  previous: Word | undefined,
  next: Word | undefined,
  neighbor: Word,
): { start: number; end: number } {
  if (
    previous !== undefined &&
    next !== undefined &&
    next.start > previous.end
  ) {
    return { start: previous.end, end: next.start };
  }
  return { start: neighbor.start, end: neighbor.end };
}

function snapshotTranscript(stored: StoredTranscript): StoredTranscript {
  return {
    speakers: stored.speakers.map((speaker) => ({ ...speaker })),
    words: stored.words.map((word) => ({ ...word })),
  };
}

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
  const processor = options.processor ?? onDeviceProcessor();
  let processing: Processing | null = null;
  let activeImport: AbortController | undefined;

  async function persist(): Promise<void> {
    const stored: StoredLibrary = {
      lastUsedLanguage,
      projects: projects.map((project) =>
        toStoredProject(project, transcripts.get(project.id) ?? EMPTY_TRANSCRIPT),
      ),
    };
    await writeFile(libraryFile(libraryDir), `${JSON.stringify(stored, null, 2)}\n`);
  }

  function listedProjects(): Project[] {
    return [...projects].sort(
      (left, right) => right.recordedAt.getTime() - left.recordedAt.getTime(),
    );
  }

  return {
    get library(): Library {
      return {
        path: libraryDir,
        projects: listedProjects(),
        lastUsedLanguage,
      };
    },
    get processing(): Processing | null {
      return processing;
    },
    cancelProcessing(): void {
      activeImport?.abort();
    },
    async importSource(
      sourcePath: string,
      language: Language = lastUsedLanguage,
    ): Promise<Project> {
      const sourceStat = await stat(sourcePath);
      const controller = new AbortController();
      activeImport = controller;
      processing = { progress: 0 };
      try {
        const processed = await processor.process(sourcePath, language, {
          signal: controller.signal,
          onProgress: (progress) => {
            processing = { progress };
          },
        });
        if (controller.signal.aborted) {
          throw new Error("Processing cancelled");
        }
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
          speakers: processed.speakers.map((speaker) => ({ ...speaker })),
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
      } finally {
        processing = null;
        if (activeImport === controller) {
          activeImport = undefined;
        }
      }
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
    async exportSrt(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const stored = transcripts.get(project.id) ?? EMPTY_TRANSCRIPT;
      await writeFile(destinationPath, formatSrt(wrapCaptionCues(stored.words)));
    },
    async exportVtt(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const stored = transcripts.get(project.id) ?? EMPTY_TRANSCRIPT;
      await writeFile(destinationPath, formatVtt(wrapCaptionCues(stored.words)));
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
    searchLibrary(query: string): readonly SearchHit[] {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) {
        return [];
      }
      const hits: SearchHit[] = [];
      for (const project of listedProjects()) {
        if (project.title.toLowerCase().includes(needle)) {
          hits.push({ project, word: undefined });
        }
        const stored = transcripts.get(project.id) ?? EMPTY_TRANSCRIPT;
        if (
          stored.speakers.some((speaker) =>
            speaker.name.toLowerCase().includes(needle),
          )
        ) {
          hits.push({ project, word: undefined });
        }
        for (const word of findPhraseStarts(stored.words, needle)) {
          hits.push({ project, word });
        }
      }
      return hits;
    },
    openProject(projectId: string): OpenedProject {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const cursor = new PlaybackCursor(now);
      const sourcePresent = existsSync(project.sourcePath);
      function storedTranscript(): StoredTranscript {
        return (
          transcripts.get(projectId) ?? {
            speakers: [],
            words: [],
          }
        );
      }
      const undoStack: StoredTranscript[] = [];
      const redoStack: StoredTranscript[] = [];
      async function applyEdit(next: StoredTranscript): Promise<void> {
        undoStack.push(snapshotTranscript(storedTranscript()));
        redoStack.length = 0;
        transcripts.set(projectId, next);
        await persist();
      }
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
          const stored = storedTranscript();
          return {
            utterances: utterancesFrom(stored.speakers, stored.words),
            editable: true,
            speakers: stored.speakers,
          };
        },
        get currentWord(): Word | undefined {
          const time = cursor.currentTime;
          return storedTranscript().words.find(
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
        findInTranscript(query: string): readonly Word[] {
          const needle = query.trim().toLowerCase();
          if (needle.length === 0) {
            return [];
          }
          return findPhraseStarts(storedTranscript().words, needle);
        },
        async changeWordText(word: Word, text: string): Promise<void> {
          const stored = storedTranscript();
          const index = stored.words.findIndex((entry) => entry.id === word.id);
          if (index < 0) {
            throw new Error(`Word not found: ${word.id}`);
          }
          const current = stored.words[index];
          if (current !== undefined && current.text === text) {
            return;
          }
          await applyEdit({
            speakers: stored.speakers,
            words: stored.words.map((entry, wordIndex) =>
              wordIndex === index ? { ...entry, text } : entry,
            ),
          });
        },
        async deleteWord(word: Word): Promise<void> {
          const stored = storedTranscript();
          const index = stored.words.findIndex((entry) => entry.id === word.id);
          if (index < 0) {
            throw new Error(`Word not found: ${word.id}`);
          }
          await applyEdit({
            speakers: stored.speakers,
            words: stored.words.filter((entry) => entry.id !== word.id),
          });
        },
        async insertWord(
          neighbor: Word,
          text: string,
          placement: WordPlacement,
        ): Promise<Word> {
          const stored = storedTranscript();
          const index = stored.words.findIndex(
            (entry) => entry.id === neighbor.id,
          );
          if (index < 0) {
            throw new Error(`Word not found: ${neighbor.id}`);
          }
          const insertAt = placement === "before" ? index : index + 1;
          const previous = stored.words[insertAt - 1];
          const next = stored.words[insertAt];
          const times = inheritedTimes(previous, next, neighbor);
          const inserted: Word = {
            id: randomUUID(),
            text,
            start: times.start,
            end: times.end,
            speakerId: neighbor.speakerId,
            paragraphBreakBefore: false,
          };
          const words = [...stored.words];
          words.splice(insertAt, 0, inserted);
          await applyEdit({
            speakers: stored.speakers,
            words,
          });
          return inserted;
        },
        async insertParagraphBreak(word: Word): Promise<void> {
          const stored = storedTranscript();
          const index = stored.words.findIndex((entry) => entry.id === word.id);
          if (index < 0) {
            throw new Error(`Word not found: ${word.id}`);
          }
          const current = stored.words[index];
          if (current?.paragraphBreakBefore === true) {
            return;
          }
          await applyEdit({
            speakers: stored.speakers,
            words: stored.words.map((entry, wordIndex) =>
              wordIndex === index
                ? { ...entry, paragraphBreakBefore: true }
                : entry,
            ),
          });
        },
        async renameSpeaker(speaker: Speaker, name: string): Promise<void> {
          const stored = storedTranscript();
          const index = stored.speakers.findIndex(
            (entry) => entry.id === speaker.id,
          );
          if (index < 0) {
            throw new Error(`Speaker not found: ${speaker.id}`);
          }
          const current = stored.speakers[index];
          if (current !== undefined && current.name === name) {
            return;
          }
          await applyEdit({
            speakers: stored.speakers.map((entry, speakerIndex) =>
              speakerIndex === index ? { ...entry, name } : entry,
            ),
            words: stored.words,
          });
        },
        async mergeSpeakers(from: Speaker, into: Speaker): Promise<void> {
          const stored = storedTranscript();
          if (from.id === into.id) {
            return;
          }
          if (!stored.speakers.some((entry) => entry.id === from.id)) {
            throw new Error(`Speaker not found: ${from.id}`);
          }
          if (!stored.speakers.some((entry) => entry.id === into.id)) {
            throw new Error(`Speaker not found: ${into.id}`);
          }
          await applyEdit({
            speakers: stored.speakers.filter((entry) => entry.id !== from.id),
            words: stored.words.map((entry) =>
              entry.speakerId === from.id
                ? { ...entry, speakerId: into.id }
                : entry,
            ),
          });
        },
        async reassignWords(
          words: readonly Word[],
          speaker: Speaker,
        ): Promise<void> {
          if (words.length === 0) {
            return;
          }
          const stored = storedTranscript();
          const ids = new Set(words.map((word) => word.id));
          for (const word of words) {
            if (!stored.words.some((entry) => entry.id === word.id)) {
              throw new Error(`Word not found: ${word.id}`);
            }
          }
          const speakerKnown = stored.speakers.some(
            (entry) => entry.id === speaker.id,
          );
          const already =
            speakerKnown &&
            stored.words.every(
              (entry) => !ids.has(entry.id) || entry.speakerId === speaker.id,
            );
          if (already) {
            return;
          }
          await applyEdit({
            speakers: speakerKnown
              ? stored.speakers
              : [...stored.speakers, { id: speaker.id, name: speaker.name }],
            words: stored.words.map((entry) =>
              ids.has(entry.id) ? { ...entry, speakerId: speaker.id } : entry,
            ),
          });
        },
        async undo(): Promise<boolean> {
          const previous = undoStack.pop();
          if (previous === undefined) {
            return false;
          }
          redoStack.push(snapshotTranscript(storedTranscript()));
          transcripts.set(projectId, previous);
          await persist();
          return true;
        },
        async redo(): Promise<boolean> {
          const next = redoStack.pop();
          if (next === undefined) {
            return false;
          }
          undoStack.push(snapshotTranscript(storedTranscript()));
          transcripts.set(projectId, next);
          await persist();
          return true;
        },
      };
    },
  };
}
