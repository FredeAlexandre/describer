import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { onDeviceProcessor } from "./on-device-processor.js";
import { probeMachine } from "./machine-facts.js";

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

export type SpeakerSuggestion = {
  readonly speaker: Speaker;
  readonly suggestedName: string;
};

export type SpeakerEmbedding = {
  readonly speakerId: string;
  readonly embedding: readonly number[];
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
  readonly speakerSuggestions: readonly SpeakerSuggestion[];
};

export type Processing = {
  readonly progress: number;
};

export type WordPlacement = "before" | "after";

export type Citation = {
  readonly plainText: string;
  readonly markdown: string;
};

export type OpenedProject = {
  readonly project: Project;
  readonly playback: Playback;
  readonly hasPicture: boolean;
  readonly transcript: Transcript;
  readonly currentWord: Word | undefined;
  setRate(rate: PlaybackRate): void;
  play(): boolean;
  playSelection(from: Word, through: Word): boolean;
  citation(from: Word, through: Word): Citation;
  seekToWord(word: Word): void;
  wordById(wordId: string): Word;
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
  acceptSpeakerSuggestion(speaker: Speaker): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
};

export type SearchHit = {
  readonly project: Project;
  readonly word: Word | undefined;
};

export type ComputePreference = "GPU" | "CPU";

export type DeviceFact = {
  readonly name: string;
};

export type StackFacts = {
  readonly driver: {
    readonly present: boolean;
    readonly version: string | null;
  };
  readonly cuda13: boolean;
  readonly cudnn9: boolean;
};

export type MachineProbe = {
  readonly devices: readonly DeviceFact[];
  readonly stack: StackFacts;
};

export type Preferences = {
  readonly compute: ComputePreference;
};

export type Machine = {
  readonly devices: readonly DeviceFact[];
  readonly stack: StackFacts;
  readonly latch: boolean;
  readonly gpuReady: boolean;
};

export type NextJob = {
  readonly compute: ComputePreference;
  readonly whyCpu: string | null;
};

export type Describer = {
  readonly library: Library;
  readonly processing: Processing | null;
  readonly preferences: Preferences;
  readonly machine: Machine;
  readonly nextJob: NextJob;
  setComputePreference(compute: ComputePreference): Promise<void>;
  importSource(sourcePath: string, language?: Language): Promise<Project>;
  cancelProcessing(): void;
  searchLibrary(query: string): readonly SearchHit[];
  updateProject(
    projectId: string,
    patch: {
      readonly title?: string;
      readonly recordedAt?: Date;
    },
  ): Promise<Project>;
  locateSource(projectId: string, sourcePath: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  exportProject(projectId: string, destinationPath: string): Promise<void>;
  exportMarkdown(projectId: string, destinationPath: string): Promise<void>;
  exportPdf(projectId: string, destinationPath: string): Promise<void>;
  exportSrt(projectId: string, destinationPath: string): Promise<void>;
  exportVtt(projectId: string, destinationPath: string): Promise<void>;
  importProject(projectFilePath: string): Promise<Project>;
  reprocessProject(projectId: string, confirmed: boolean): Promise<Project>;
  openProject(projectId: string): OpenedProject;
};

export type ProcessorResult = {
  readonly speakers: readonly Speaker[];
  readonly words: readonly Word[];
  readonly embeddings?: readonly SpeakerEmbedding[];
};

export type ProcessorControls = {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
};

export type Processor = {
  process(
    sourcePath: string,
    language: Language,
    compute: ComputePreference,
    controls?: ProcessorControls,
  ): Promise<ProcessorResult>;
};

export class BindTimeGpuFailure extends Error {
  constructor(message = "CUDA failed to load") {
    super(message);
    this.name = "BindTimeGpuFailure";
  }
}

export class MidJobGpuFailure extends Error {
  constructor(message = "GPU failed after CUDA session") {
    super(message);
    this.name = "MidJobGpuFailure";
  }
}

export function fixtureProcessor(
  words: readonly Word[] = [],
  speakers?: readonly Speaker[],
  embeddings: readonly SpeakerEmbedding[] = [],
): Processor {
  const resolvedSpeakers =
    speakers ??
    [...new Set(words.map((word) => word.speakerId))].map((id) => {
      const numbered = /^s(\d+)$/.exec(id);
      return {
        id,
        name: numbered !== null ? `Speaker ${numbered[1]}` : id,
      };
    });
  return {
    async process(_sourcePath, _language, _compute, controls) {
      if (controls?.signal.aborted === true) {
        throw new Error("Processing cancelled");
      }
      controls?.onProgress(1);
      return { speakers: resolvedSpeakers, words, embeddings };
    },
  };
}

export type OpenDescriberOptions = {
  readonly libraryDir?: string;
  readonly configDir?: string;
  readonly now?: () => number;
  readonly processor?: Processor;
  readonly machine?: MachineProbe;
};

type StoredSpeakerSuggestion = {
  readonly speakerId: string;
  readonly suggestedName: string;
};

type StoredVoice = {
  readonly name: string;
  readonly embedding: readonly number[];
};

type StoredProject = {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly language: Language;
  readonly sourcePath: string;
  readonly speakers?: readonly Speaker[];
  readonly words?: readonly Word[];
  readonly embeddings?: readonly SpeakerEmbedding[];
  readonly speakerSuggestions?: readonly StoredSpeakerSuggestion[];
};

type StoredLibrary = {
  readonly lastUsedLanguage: Language;
  readonly projects: ReadonlyArray<StoredProject>;
  readonly voices?: readonly StoredVoice[];
};

type StoredTranscript = {
  readonly speakers: readonly Speaker[];
  readonly words: readonly Word[];
  readonly embeddings: readonly SpeakerEmbedding[];
  readonly speakerSuggestions: readonly StoredSpeakerSuggestion[];
};

const EMPTY_TRANSCRIPT: StoredTranscript = {
  speakers: [],
  words: [],
  embeddings: [],
  speakerSuggestions: [],
};

const DEFAULT_SPEAKER_NAME = /^Speaker \d+$/;
const VOICE_MATCH_COSINE = 0.65;

function storedFromProcessed(
  processed: ProcessorResult,
  voices: readonly StoredVoice[],
): StoredTranscript {
  utterancesFrom(processed.speakers, processed.words);
  const embeddings = (processed.embeddings ?? []).map((entry) => ({
    speakerId: entry.speakerId,
    embedding: [...entry.embedding],
  }));
  return {
    speakers: processed.speakers.map((speaker) => ({ ...speaker })),
    words: processed.words.map((word) => ({
      id: word.id,
      text: word.text,
      start: word.start,
      end: word.end,
      speakerId: word.speakerId,
      paragraphBreakBefore: word.paragraphBreakBefore === true,
    })),
    embeddings,
    speakerSuggestions: matchVoices(embeddings, voices),
  };
}

function sourceHasPicture(sourcePath: string): boolean {
  const probed = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      sourcePath,
    ],
    { encoding: "utf8" },
  );
  if (probed.status !== 0) {
    return false;
  }
  return probed.stdout.split(/\r?\n/).some((line) => line.trim() === "video");
}

const LONG_PAUSE_SECONDS = 2;

function padTime(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatSrtTime(seconds: number): string {
  return formatTimestamp(seconds, ",");
}

function formatVttTime(seconds: number): string {
  return formatTimestamp(seconds, ".");
}

function formatTimestamp(seconds: number, fractionSep: "," | "."): string {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${padTime(hours, 2)}:${padTime(minutes, 2)}:${padTime(secs, 2)}${fractionSep}${padTime(millis, 3)}`;
}

const MAX_CAPTION_DURATION_SECONDS = 7;
const MAX_CAPTION_LENGTH = 42;

type Caption = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

function captionText(words: readonly Word[]): string {
  return words.map((entry) => entry.text).join(" ");
}

function wrapCaptions(words: readonly Word[]): Caption[] {
  const captions: Caption[] = [];
  let current: Word[] = [];
  for (const entry of words) {
    const first = current[0];
    if (
      first !== undefined &&
      (entry.end - first.start > MAX_CAPTION_DURATION_SECONDS ||
        captionText([...current, entry]).length > MAX_CAPTION_LENGTH)
    ) {
      const last = current[current.length - 1];
      if (last !== undefined) {
        captions.push({
          start: first.start,
          end: last.end,
          text: captionText(current),
        });
      }
      current = [];
    }
    current.push(entry);
  }
  const first = current[0];
  const last = current[current.length - 1];
  if (first !== undefined && last !== undefined) {
    captions.push({
      start: first.start,
      end: last.end,
      text: captionText(current),
    });
  }
  return captions;
}

function formatSrt(captions: readonly Caption[]): string {
  if (captions.length === 0) {
    return "";
  }
  return captions
    .map(
      (caption, index) =>
        `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`,
    )
    .join("\n");
}

function formatVtt(captions: readonly Caption[]): string {
  if (captions.length === 0) {
    return "WEBVTT\n";
  }
  const body = captions
    .map(
      (caption) =>
        `${formatVttTime(caption.start)} --> ${formatVttTime(caption.end)}\n${caption.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function formatMarkdownTime(seconds: number): string {
  return formatTimestamp(seconds, ".");
}

function formatMarkdown(
  project: Project,
  utterances: readonly Utterance[],
): string {
  const lines = [
    `# ${project.title}`,
    "",
    `Recorded at: ${project.recordedAt.toISOString()}`,
    `Language: ${project.language}`,
  ];
  for (const utterance of utterances) {
    const first = utterance.words[0];
    if (first === undefined) {
      continue;
    }
    lines.push(
      "",
      `**${utterance.speaker.name}** (${formatMarkdownTime(first.start)})`,
      "",
      utterance.words.map((entry) => entry.text).join(" "),
    );
  }
  return `${lines.join("\n")}\n`;
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 72;
const PDF_FONT_SIZE = 12;
const PDF_LINE_HEIGHT = 16;

function wrapPdfLine(
  text: string,
  widthOf: (value: string) => number,
  maxWidth: number,
): string[] {
  if (text.length === 0) {
    return [""];
  }
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const piece of words) {
    const next = current.length === 0 ? piece : `${current} ${piece}`;
    if (widthOf(next) <= maxWidth) {
      current = next;
    } else {
      if (current.length > 0) {
        lines.push(current);
      }
      current = piece;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

async function writeReadablePdf(
  destinationPath: string,
  body: string,
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const widthOf = (value: string): number =>
    font.widthOfTextAtSize(value, PDF_FONT_SIZE);
  let page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  for (const line of body.split("\n")) {
    for (const wrapped of wrapPdfLine(line, widthOf, maxWidth)) {
      if (y < PDF_MARGIN) {
        page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
        y = PDF_PAGE_HEIGHT - PDF_MARGIN;
      }
      if (wrapped.length > 0) {
        page.drawText(wrapped, {
          x: PDF_MARGIN,
          y,
          size: PDF_FONT_SIZE,
          font,
        });
      }
      y -= PDF_LINE_HEIGHT;
    }
  }
  await writeFile(destinationPath, await doc.save());
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

function wordSpan(
  words: readonly Word[],
  from: Word,
  through: Word,
): { start: Word; end: Word; selected: readonly Word[] } {
  const fromIndex = words.findIndex((entry) => entry.id === from.id);
  const throughIndex = words.findIndex((entry) => entry.id === through.id);
  if (fromIndex < 0) {
    throw new Error(`Word not found: ${from.id}`);
  }
  if (throughIndex < 0) {
    throw new Error(`Word not found: ${through.id}`);
  }
  const startIndex = Math.min(fromIndex, throughIndex);
  const endIndex = Math.max(fromIndex, throughIndex);
  const start = words[startIndex];
  const end = words[endIndex];
  if (start === undefined || end === undefined) {
    throw new Error(`Word not found: ${from.id}`);
  }
  return { start, end, selected: words.slice(startIndex, endIndex + 1) };
}

function formatCitationTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${padTime(minutes, 2)}:${padTime(rest, 2)}`;
  }
  return `${minutes}:${padTime(rest, 2)}`;
}

function speakerNamesFor(
  speakers: readonly Speaker[],
  words: readonly Word[],
): string {
  const byId = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of words) {
    if (seen.has(entry.speakerId)) {
      continue;
    }
    seen.add(entry.speakerId);
    const speaker = byId.get(entry.speakerId);
    if (speaker !== undefined) {
      names.push(speaker.name);
    }
  }
  return names.join(", ");
}

function formatCitation(
  quote: string,
  speaker: string,
  timestamp: string,
  title: string,
  recordedAt: string,
): Citation {
  return {
    plainText: `"${quote}"\n${speaker}\n${timestamp}\n${title}\n${recordedAt}`,
    markdown: `> ${quote}\n\n${speaker} · ${timestamp} · ${title} · ${recordedAt}`,
  };
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
    embeddings: stored.embeddings.map((entry) => ({
      speakerId: entry.speakerId,
      embedding: [...entry.embedding],
    })),
    speakerSuggestions: stored.speakerSuggestions.map((entry) => ({
      ...entry,
    })),
  };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function isDefaultSpeakerName(name: string): boolean {
  return DEFAULT_SPEAKER_NAME.test(name);
}

function matchVoices(
  embeddings: readonly SpeakerEmbedding[],
  voices: readonly StoredVoice[],
): StoredSpeakerSuggestion[] {
  type Pair = {
    readonly speakerId: string;
    readonly name: string;
    readonly similarity: number;
  };
  const pairs: Pair[] = [];
  for (const embedding of embeddings) {
    for (const voice of voices) {
      const similarity = cosineSimilarity(embedding.embedding, voice.embedding);
      if (similarity >= VOICE_MATCH_COSINE) {
        pairs.push({
          speakerId: embedding.speakerId,
          name: voice.name,
          similarity,
        });
      }
    }
  }
  pairs.sort((left, right) => right.similarity - left.similarity);
  const usedSpeakers = new Set<string>();
  const usedVoices = new Set<string>();
  const suggestions: StoredSpeakerSuggestion[] = [];
  for (const pair of pairs) {
    if (usedSpeakers.has(pair.speakerId) || usedVoices.has(pair.name)) {
      continue;
    }
    usedSpeakers.add(pair.speakerId);
    usedVoices.add(pair.name);
    suggestions.push({
      speakerId: pair.speakerId,
      suggestedName: pair.name,
    });
  }
  return suggestions;
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
  private stopAt: number | undefined;

  constructor(private readonly now: () => number) {}

  get snapshot(): Playback {
    const currentTime = this.currentTime;
    return {
      playing: this.playing,
      currentTime,
      rate: this.rate,
    };
  }

  get currentTime(): number {
    const elapsed = this.playing
      ? this.originTime + ((this.now() - this.originMs) / 1000) * this.rate
      : this.originTime;
    if (this.stopAt !== undefined && elapsed >= this.stopAt) {
      this.playing = false;
      this.originTime = this.stopAt;
      this.stopAt = undefined;
      return this.originTime;
    }
    return elapsed;
  }

  play(until?: number): void {
    this.stopAt = until;
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
    this.stopAt = undefined;
    this.originTime = time;
    if (this.playing) {
      this.originMs = this.now();
    }
  }
}

function gpuReady(machine: MachineProbe): boolean {
  return (
    machine.devices.length > 0 &&
    machine.stack.driver.present &&
    machine.stack.cuda13 &&
    machine.stack.cudnn9
  );
}

function jobCompute(
  preference: ComputePreference,
  machine: MachineProbe,
  latch: boolean,
): ComputePreference {
  if (preference === "GPU" && gpuReady(machine) && !latch) {
    return "GPU";
  }
  return "CPU";
}

function whyCpu(
  preference: ComputePreference,
  machine: MachineProbe,
  latch: boolean,
): string | null {
  if (jobCompute(preference, machine, latch) === "GPU") {
    return null;
  }
  if (preference === "CPU") {
    return "You chose CPU.";
  }
  if (latch) {
    return "GPU failed in this process. Later jobs use CPU until you pick CPU, then GPU, or quit Describer.";
  }
  if (machine.devices.length === 0) {
    return "No NVIDIA GPU on this machine. Preference is still GPU; this job uses CPU, silently.";
  }
  return "GPU is not ready (driver, CUDA 13, or cuDNN 9). Preference is still GPU; this job uses CPU, silently.";
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

function defaultConfigDir(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "describer",
  );
}

function preferencesFile(configDir: string): string {
  return path.join(configDir, "preferences.json");
}

type StoredPreferences = {
  readonly compute?: unknown;
};

async function loadPreferences(configDir: string): Promise<ComputePreference> {
  try {
    const raw = await readFile(preferencesFile(configDir), "utf8");
    const stored = JSON.parse(raw) as StoredPreferences;
    if (stored.compute === "CPU" || stored.compute === "GPU") {
      return stored.compute;
    }
    return "GPU";
  } catch (error) {
    if (isMissingFile(error)) {
      return "GPU";
    }
    throw error;
  }
}

async function persistPreferences(
  configDir: string,
  compute: ComputePreference,
): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(
    preferencesFile(configDir),
    `${JSON.stringify({ compute }, null, 2)}\n`,
  );
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
    embeddings: transcript.embeddings,
    speakerSuggestions: transcript.speakerSuggestions,
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
    embeddings: project.embeddings ?? [],
    speakerSuggestions: project.speakerSuggestions ?? [],
  };
}

async function loadLibrary(libraryDir: string): Promise<{
  lastUsedLanguage: Language;
  projects: Project[];
  transcripts: Map<string, StoredTranscript>;
  voices: StoredVoice[];
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
      voices: (stored.voices ?? []).map((voice) => ({
        name: voice.name,
        embedding: [...voice.embedding],
      })),
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        lastUsedLanguage: "English",
        projects: [],
        transcripts: new Map(),
        voices: [],
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
  const configDir = options.configDir ?? defaultConfigDir();

  const loaded = await loadLibrary(libraryDir);
  const projects: Project[] = loaded.projects;
  const transcripts = loaded.transcripts;
  let voices: StoredVoice[] = loaded.voices;
  let lastUsedLanguage: Language = loaded.lastUsedLanguage;
  const now = options.now ?? Date.now;
  const processor = options.processor ?? onDeviceProcessor();
  let computePreference: ComputePreference = await loadPreferences(configDir);
  let latch = false;
  let processing: Processing | null = null;
  let activeImport: AbortController | undefined;
  const transcriptEpoch = new Map<string, number>();
  const lockedProjects = new Set<string>();
  const unpersistedProjects = new Set<string>();
  let processQueue: Promise<void> = Promise.resolve();
  const waiting: Array<{
    kind: "import" | "reprocess";
    projectId: string;
    cancelled: boolean;
  }> = [];

  function epochOf(projectId: string): number {
    return transcriptEpoch.get(projectId) ?? 0;
  }

  function dropOpenedHandles(projectId: string): void {
    transcriptEpoch.set(projectId, epochOf(projectId) + 1);
  }

  function enqueueProcess<T>(
    kind: "import" | "reprocess",
    projectId: string,
    job: () => Promise<T>,
  ): Promise<T> {
    const entry = { kind, projectId, cancelled: false };
    waiting.push(entry);
    const start = async (): Promise<T> => {
      const index = waiting.indexOf(entry);
      if (index >= 0) {
        waiting.splice(index, 1);
      }
      if (entry.cancelled) {
        throw new Error("Processing cancelled");
      }
      return job();
    };
    const run = processQueue.then(start, start);
    processQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function persist(): Promise<void> {
    const stored: StoredLibrary = {
      lastUsedLanguage,
      projects: projects
        .filter((project) => !unpersistedProjects.has(project.id))
        .map((project) =>
          toStoredProject(project, transcripts.get(project.id) ?? EMPTY_TRANSCRIPT),
        ),
      voices,
    };
    await writeFile(libraryFile(libraryDir), `${JSON.stringify(stored, null, 2)}\n`);
  }

  function rememberVoice(name: string, embedding: readonly number[]): void {
    const trimmed = name.trim();
    if (trimmed.length === 0 || isDefaultSpeakerName(trimmed)) {
      return;
    }
    const next: StoredVoice = { name: trimmed, embedding: [...embedding] };
    voices = [
      ...voices.filter(
        (voice) =>
          voice.name !== trimmed &&
          cosineSimilarity(voice.embedding, embedding) < VOICE_MATCH_COSINE,
      ),
      next,
    ];
  }

  function listedProjects(): Project[] {
    return [...projects].sort(
      (left, right) => right.recordedAt.getTime() - left.recordedAt.getTime(),
    );
  }

  function dropImport(projectId: string): void {
    const index = projects.findIndex((project) => project.id === projectId);
    if (index >= 0) {
      projects.splice(index, 1);
    }
    transcripts.delete(projectId);
    lockedProjects.delete(projectId);
    unpersistedProjects.delete(projectId);
  }

  function projectForExport(projectId: string): {
    project: Project;
    stored: StoredTranscript;
  } {
    const project = projects.find((entry) => entry.id === projectId);
    if (project === undefined) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return {
      project,
      stored: transcripts.get(project.id) ?? EMPTY_TRANSCRIPT,
    };
  }

  function currentMachine(): MachineProbe {
    return options.machine ?? probeMachine();
  }

  async function runProcessor(
    sourcePath: string,
    language: Language,
  ): Promise<ProcessorResult> {
    const controller = new AbortController();
    activeImport = controller;
    processing = { progress: 0 };
    const compute = jobCompute(
      computePreference,
      currentMachine(),
      latch,
    );
    const controls: ProcessorControls = {
      signal: controller.signal,
      onProgress: (progress) => {
        processing = { progress };
      },
    };
    try {
      try {
        const processed = await processor.process(
          sourcePath,
          language,
          compute,
          controls,
        );
        if (controller.signal.aborted) {
          throw new Error("Processing cancelled");
        }
        return processed;
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("Processing cancelled");
        }
        if (compute === "GPU" && error instanceof BindTimeGpuFailure) {
          latch = true;
          const processed = await processor.process(
            sourcePath,
            language,
            "CPU",
            controls,
          );
          if (controller.signal.aborted) {
            throw new Error("Processing cancelled");
          }
          return processed;
        }
        if (compute === "GPU" && error instanceof MidJobGpuFailure) {
          latch = true;
        }
        throw error;
      }
    } finally {
      processing = null;
      if (activeImport === controller) {
        activeImport = undefined;
      }
    }
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
    get preferences(): Preferences {
      return { compute: computePreference };
    },
    get machine(): Machine {
      const probe = currentMachine();
      return {
        devices: probe.devices,
        stack: probe.stack,
        latch,
        gpuReady: gpuReady(probe),
      };
    },
    get nextJob(): NextJob {
      const probe = currentMachine();
      return {
        compute: jobCompute(computePreference, probe, latch),
        whyCpu: whyCpu(computePreference, probe, latch),
      };
    },
    async setComputePreference(compute: ComputePreference): Promise<void> {
      const wasCpu = computePreference === "CPU";
      computePreference = compute;
      if (compute === "GPU" && wasCpu) {
        latch = false;
      }
      await persistPreferences(configDir, computePreference);
    },
    cancelProcessing(): void {
      activeImport?.abort();
      for (const job of waiting) {
        job.cancelled = true;
        if (job.kind === "import") {
          dropImport(job.projectId);
        } else {
          lockedProjects.delete(job.projectId);
        }
      }
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
      transcripts.set(project.id, EMPTY_TRANSCRIPT);
      lockedProjects.add(project.id);
      unpersistedProjects.add(project.id);
      return enqueueProcess("import", project.id, async () => {
        try {
          const processed = await runProcessor(sourcePath, language);
          transcripts.set(project.id, storedFromProcessed(processed, voices));
          lockedProjects.delete(project.id);
          unpersistedProjects.delete(project.id);
          lastUsedLanguage = language;
          await persist();
          return project;
        } catch (error) {
          dropImport(project.id);
          throw error;
        }
      });
    },
    async updateProject(
      projectId: string,
      patch: {
        readonly title?: string;
        readonly recordedAt?: Date;
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
      lockedProjects.delete(projectId);
      unpersistedProjects.delete(projectId);
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
    async exportMarkdown(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const { project, stored } = projectForExport(projectId);
      await writeFile(
        destinationPath,
        formatMarkdown(
          project,
          utterancesFrom(stored.speakers, stored.words),
        ),
      );
    },
    async exportPdf(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const { project, stored } = projectForExport(projectId);
      await writeReadablePdf(
        destinationPath,
        formatMarkdown(
          project,
          utterancesFrom(stored.speakers, stored.words),
        ),
      );
    },
    async exportSrt(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const { stored } = projectForExport(projectId);
      await writeFile(destinationPath, formatSrt(wrapCaptions(stored.words)));
    },
    async exportVtt(
      projectId: string,
      destinationPath: string,
    ): Promise<void> {
      const { stored } = projectForExport(projectId);
      await writeFile(destinationPath, formatVtt(wrapCaptions(stored.words)));
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
    async reprocessProject(
      projectId: string,
      confirmed: boolean,
    ): Promise<Project> {
      const project = projects.find((entry) => entry.id === projectId);
      if (project === undefined) {
        throw new Error(`Project not found: ${projectId}`);
      }
      if (!confirmed) {
        throw new Error("Re-process requires confirmation");
      }
      dropOpenedHandles(project.id);
      lockedProjects.add(project.id);
      return enqueueProcess("reprocess", project.id, async () => {
        const current = projects.find((entry) => entry.id === projectId);
        if (current === undefined) {
          lockedProjects.delete(projectId);
          throw new Error(`Project not found: ${projectId}`);
        }
        try {
          const processed = await runProcessor(
            current.sourcePath,
            current.language,
          );
          transcripts.set(current.id, storedFromProcessed(processed, voices));
          lockedProjects.delete(current.id);
          await persist();
          return current;
        } catch (error) {
          lockedProjects.delete(current.id);
          throw error;
        }
      });
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
      const handleEpoch = epochOf(projectId);
      function handleIsCurrent(): boolean {
        return epochOf(projectId) === handleEpoch;
      }
      function storedTranscript(): StoredTranscript {
        return transcripts.get(projectId) ?? EMPTY_TRANSCRIPT;
      }
      const undoStack: StoredTranscript[] = [];
      const redoStack: StoredTranscript[] = [];
      async function applyEdit(next: StoredTranscript): Promise<void> {
        if (!handleIsCurrent()) {
          throw new Error("OpenedProject handle is no longer current");
        }
        if (lockedProjects.has(projectId)) {
          throw new Error("Transcript is not editable");
        }
        undoStack.push(snapshotTranscript(storedTranscript()));
        redoStack.length = 0;
        transcripts.set(projectId, next);
        await persist();
      }
      if (sourcePresent && !lockedProjects.has(projectId)) {
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
          const speakersById = new Map(
            stored.speakers.map((speaker) => [speaker.id, speaker]),
          );
          return {
            utterances: utterancesFrom(stored.speakers, stored.words),
            editable: !lockedProjects.has(projectId),
            speakers: stored.speakers,
            speakerSuggestions: stored.speakerSuggestions.flatMap(
              (suggestion) => {
                const speaker = speakersById.get(suggestion.speakerId);
                if (speaker === undefined) {
                  return [];
                }
                return [
                  {
                    speaker,
                    suggestedName: suggestion.suggestedName,
                  },
                ];
              },
            ),
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
        playSelection(from: Word, through: Word): boolean {
          const current = projects.find((entry) => entry.id === projectId);
          if (current === undefined || !existsSync(current.sourcePath)) {
            return false;
          }
          const span = wordSpan(storedTranscript().words, from, through);
          cursor.seek(span.start.start);
          cursor.play(span.end.end);
          return true;
        },
        citation(from: Word, through: Word): Citation {
          const current = projects.find((entry) => entry.id === projectId);
          if (current === undefined) {
            throw new Error(`Project not found: ${projectId}`);
          }
          const stored = storedTranscript();
          const span = wordSpan(stored.words, from, through);
          const quote = span.selected.map((entry) => entry.text).join(" ");
          return formatCitation(
            quote,
            speakerNamesFor(stored.speakers, span.selected),
            formatCitationTime(span.start.start),
            current.title,
            current.recordedAt.toISOString().slice(0, 10),
          );
        },
        seekToWord(word: Word): void {
          cursor.seek(word.start);
        },
        wordById(wordId: string): Word {
          const word = storedTranscript().words.find(
            (entry) => entry.id === wordId,
          );
          if (word === undefined) {
            throw new Error(`Word not found: ${wordId}`);
          }
          return word;
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
            ...stored,
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
            ...stored,
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
            ...stored,
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
            ...stored,
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
          const embedding = stored.embeddings.find(
            (entry) => entry.speakerId === speaker.id,
          )?.embedding;
          if (embedding !== undefined) {
            rememberVoice(name, embedding);
          }
          await applyEdit({
            ...stored,
            speakers: stored.speakers.map((entry, speakerIndex) =>
              speakerIndex === index ? { ...entry, name } : entry,
            ),
            words: stored.words,
            speakerSuggestions: stored.speakerSuggestions.filter(
              (entry) => entry.speakerId !== speaker.id,
            ),
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
            ...stored,
            speakers: stored.speakers.filter((entry) => entry.id !== from.id),
            words: stored.words.map((entry) =>
              entry.speakerId === from.id
                ? { ...entry, speakerId: into.id }
                : entry,
            ),
            embeddings: stored.embeddings.filter(
              (entry) => entry.speakerId !== from.id,
            ),
            speakerSuggestions: stored.speakerSuggestions.filter(
              (entry) => entry.speakerId !== from.id,
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
            ...stored,
            speakers: speakerKnown
              ? stored.speakers
              : [...stored.speakers, { id: speaker.id, name: speaker.name }],
            words: stored.words.map((entry) =>
              ids.has(entry.id) ? { ...entry, speakerId: speaker.id } : entry,
            ),
          });
        },
        async acceptSpeakerSuggestion(speaker: Speaker): Promise<void> {
          const stored = storedTranscript();
          const suggestion = stored.speakerSuggestions.find(
            (entry) => entry.speakerId === speaker.id,
          );
          if (suggestion === undefined) {
            throw new Error(`No Voice suggestion for Speaker: ${speaker.id}`);
          }
          await this.renameSpeaker(speaker, suggestion.suggestedName);
        },
        async undo(): Promise<boolean> {
          if (!handleIsCurrent() || lockedProjects.has(projectId)) {
            return false;
          }
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
          if (!handleIsCurrent() || lockedProjects.has(projectId)) {
            return false;
          }
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
