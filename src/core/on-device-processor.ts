import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import {
  AutoModelForXVector,
  AutoProcessor,
  env,
  pipeline,
} from "@huggingface/transformers";
import type {
  Language,
  Processor,
  ProcessorControls,
  ProcessorResult,
  Speaker,
  SpeakerEmbedding,
  Word,
} from "./index.js";

const SAMPLE_RATE = 16000;
const MODEL_ID = "Xenova/whisper-tiny";
const EMBEDDING_MODEL_ID = "Xenova/wavlm-base-plus-sv";
const FRAME_SECONDS = 0.02;
const MIN_SPEECH_SECONDS = 0.25;
const MERGE_GAP_SECONDS = 0.4;
const EMBED_SECONDS = 12;
const MIN_SPEECH_RMS = 0.005;
const SAME_SPEAKER_COSINE = 0.65;

type Transcriber = (
  audio: Float32Array,
  options: {
    readonly return_timestamps: "word";
    readonly language: string;
    readonly task: "transcribe";
    readonly chunk_length_s: number;
  },
) => Promise<{
  readonly text: string;
  readonly chunks?: ReadonlyArray<{
    readonly text: string;
    readonly timestamp: readonly [number, number | null];
  }>;
}>;

type Embedder = {
  embed(samples: Float32Array): Promise<number[]>;
};

type SpeechRegion = {
  readonly start: number;
  readonly end: number;
};

let transcriberPromise: Promise<Transcriber> | undefined;
let embedderPromise: Promise<Embedder> | undefined;

function cacheDir(): string {
  return path.join(
    process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"),
    "describer",
    "whisper",
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Processing cancelled");
  }
}

function decodeSourceAudio(
  sourcePath: string,
  signal: AbortSignal,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        sourcePath,
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "pipe:1",
      ],
      { signal, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;
    const finish = (error: Error | null, samples?: Float32Array): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error !== null) {
        reject(error);
        return;
      }
      if (samples === undefined) {
        reject(new Error("Failed to read Source audio"));
        return;
      }
      resolve(samples);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors.push(chunk);
    });
    child.on("error", (error) => {
      finish(
        signal.aborted ? new Error("Processing cancelled") : error,
      );
    });
    child.on("close", (code) => {
      if (signal.aborted) {
        finish(new Error("Processing cancelled"));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString().trim();
        finish(
          new Error(
            detail.length > 0
              ? `Failed to read Source audio: ${detail}`
              : "Failed to read Source audio",
          ),
        );
        return;
      }
      const bytes = Buffer.concat(chunks);
      const samples = new Float32Array(bytes.byteLength / 4);
      samples.set(
        new Float32Array(bytes.buffer, bytes.byteOffset, samples.length),
      );
      finish(null, samples);
    });
  });
}

function wordsFromOutput(output: {
  readonly text: string;
  readonly chunks?: ReadonlyArray<{
    readonly text: string;
    readonly timestamp: readonly [number, number | null];
  }>;
}): Word[] {
  if (output.chunks !== undefined && output.chunks.length > 0) {
    return output.chunks.flatMap((chunk, index) => {
      const text = chunk.text.trim();
      if (text.length === 0) {
        return [];
      }
      const start = chunk.timestamp[0] ?? 0;
      const end = chunk.timestamp[1] ?? start;
      return [
        {
          id: `w${index + 1}`,
          text,
          start,
          end: Math.max(end, start),
          speakerId: "speaker-1",
        },
      ];
    });
  }
  const text = output.text.trim();
  if (text.length === 0) {
    return [];
  }
  return [{ id: "w1", text, start: 0, end: 0, speakerId: "speaker-1" }];
}

function resultFromWords(
  words: Word[],
  embeddings: readonly SpeakerEmbedding[] = [],
): ProcessorResult {
  const speakers: Speaker[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (seen.has(word.speakerId)) {
      continue;
    }
    seen.add(word.speakerId);
    speakers.push({
      id: word.speakerId,
      name: `Speaker ${speakers.length + 1}`,
    });
  }
  return { speakers, words, embeddings };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

function padToMin(samples: Float32Array, minLength: number): Float32Array {
  if (samples.length >= minLength) {
    return samples;
  }
  const padded = new Float32Array(minLength);
  padded.set(samples);
  return padded;
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

function l2normalize(vector: readonly number[]): number[] {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  const scale = Math.sqrt(norm);
  if (scale === 0) {
    return [...vector];
  }
  return vector.map((value) => value / scale);
}

function meanVectors(vectors: readonly (readonly number[])[]): number[] {
  const first = vectors[0];
  if (first === undefined) {
    return [];
  }
  const mean = new Array<number>(first.length).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < mean.length; i += 1) {
      mean[i] = (mean[i] ?? 0) + (vector[i] ?? 0);
    }
  }
  return mean.map((value) => value / vectors.length);
}

function clusterByCentroid(
  vectors: readonly (readonly number[])[],
  threshold: number,
): number[] {
  type Cluster = { members: number[]; centroid: number[] };
  const clusters: Cluster[] = vectors.map((vector, index) => ({
    members: [index],
    centroid: l2normalize(vector),
  }));
  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const left = clusters[i];
        const right = clusters[j];
        if (left === undefined || right === undefined) {
          continue;
        }
        const similarity = cosineSimilarity(left.centroid, right.centroid);
        if (similarity > best) {
          best = similarity;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (best < threshold) {
      break;
    }
    const first = clusters[bestI];
    const second = clusters[bestJ];
    if (first === undefined || second === undefined) {
      break;
    }
    const members = [...first.members, ...second.members];
    const centroid = l2normalize(
      meanVectors(members.map((index) => vectors[index] ?? [])),
    );
    clusters.splice(Math.max(bestI, bestJ), 1);
    clusters.splice(Math.min(bestI, bestJ), 1);
    clusters.push({ members, centroid });
  }
  const labels = vectors.map(() => 0);
  const ordered = [...clusters].sort(
    (left, right) => Math.min(...left.members) - Math.min(...right.members),
  );
  for (const [label, cluster] of ordered.entries()) {
    for (const member of cluster.members) {
      labels[member] = label;
    }
  }
  return labels;
}

function speechRegions(audio: Float32Array): SpeechRegion[] {
  const frameSamples = Math.max(1, Math.round(FRAME_SECONDS * SAMPLE_RATE));
  const raw: SpeechRegion[] = [];
  let offset = 0;
  while (offset < audio.length) {
    while (
      offset < audio.length &&
      rms(audio.subarray(offset, Math.min(offset + frameSamples, audio.length))) <
        MIN_SPEECH_RMS
    ) {
      offset += frameSamples;
    }
    if (offset >= audio.length) {
      break;
    }
    const start = offset;
    while (
      offset < audio.length &&
      rms(audio.subarray(offset, Math.min(offset + frameSamples, audio.length))) >=
        MIN_SPEECH_RMS
    ) {
      offset += frameSamples;
    }
    raw.push({
      start: start / SAMPLE_RATE,
      end: Math.min(offset, audio.length) / SAMPLE_RATE,
    });
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const region of raw) {
    const current = merged[merged.length - 1];
    if (current !== undefined && region.start - current.end <= MERGE_GAP_SECONDS) {
      current.end = region.end;
    } else {
      merged.push({ start: region.start, end: region.end });
    }
  }
  const usable = merged.filter(
    (region) => region.end - region.start >= MIN_SPEECH_SECONDS,
  );
  if (usable.length > 0) {
    return usable;
  }
  if (audio.length === 0) {
    return [];
  }
  return [{ start: 0, end: audio.length / SAMPLE_RATE }];
}

function sliceAudio(
  audio: Float32Array,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  const start = Math.max(0, Math.floor(startSeconds * SAMPLE_RATE));
  const end = Math.min(audio.length, Math.ceil(endSeconds * SAMPLE_RATE));
  return padToMin(
    audio.slice(start, Math.max(end, start)),
    Math.round(MIN_SPEECH_SECONDS * SAMPLE_RATE),
  );
}

function offsetWords(
  words: readonly Word[],
  region: SpeechRegion,
  speakerId: string,
  idFrom: number,
): Word[] {
  const duration = Math.max(region.end - region.start, 0);
  return words.map((word, index) => {
    const start = Math.min(Math.max(word.start, 0), duration);
    const end = Math.min(Math.max(word.end, start), duration);
    return {
      id: `w${idFrom + index}`,
      text: word.text,
      start: region.start + start,
      end: region.start + end,
      speakerId,
    };
  });
}

async function loadTranscriber(
  onProgress: (progress: number) => void,
): Promise<Transcriber> {
  if (transcriberPromise === undefined) {
    env.cacheDir = cacheDir();
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: "q8",
      progress_callback: (info) => {
        if (info.status === "progress") {
          onProgress(0.2 + 0.25 * (info.progress / 100));
        }
      },
    }) as Promise<Transcriber>;
  }
  return transcriberPromise;
}

async function loadEmbedder(
  onProgress: (progress: number) => void,
): Promise<Embedder> {
  if (embedderPromise === undefined) {
    env.cacheDir = cacheDir();
    embedderPromise = (async () => {
      const processor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID);
      const model = await AutoModelForXVector.from_pretrained(
        EMBEDDING_MODEL_ID,
        {
          dtype: "q8",
          progress_callback: (info) => {
            if (info.status === "progress") {
              onProgress(0.7 + 0.1 * (info.progress / 100));
            }
          },
        },
      );
      return {
        async embed(samples: Float32Array): Promise<number[]> {
          const inputs = await processor(samples);
          const output = await model(inputs);
          const embeddings = (
            output as { embeddings?: { data?: ArrayLike<number> } }
          ).embeddings?.data;
          if (embeddings === undefined) {
            throw new Error("Speaker embedding failed");
          }
          return Array.from(embeddings);
        },
      };
    })();
  }
  return embedderPromise;
}

async function transcribeAndDiarize(
  audio: Float32Array,
  language: Language,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<{ words: Word[]; embeddings: SpeakerEmbedding[] }> {
  const regions = speechRegions(audio);
  if (regions.length === 0) {
    return { words: [], embeddings: [] };
  }
  const transcriber = await loadTranscriber(onProgress);
  throwIfAborted(signal);
  onProgress(0.45);
  const embedder = await loadEmbedder(onProgress);
  throwIfAborted(signal);
  const whisperLanguage = language === "French" ? "french" : "english";
  const vectors: number[][] = [];
  const regionWords: Word[][] = [];
  for (const [index, region] of regions.entries()) {
    throwIfAborted(signal);
    const samples = sliceAudio(audio, region.start, region.end);
    const output = await transcriber(samples, {
      return_timestamps: "word",
      language: whisperLanguage,
      task: "transcribe",
      chunk_length_s: 29,
    });
    regionWords.push(wordsFromOutput(output));
    const embedSlice = sliceAudio(
      audio,
      region.start,
      Math.min(region.end, region.start + EMBED_SECONDS),
    );
    vectors.push(await embedder.embed(embedSlice));
    onProgress(0.55 + 0.4 * ((index + 1) / regions.length));
  }
  const labels = clusterByCentroid(vectors, SAME_SPEAKER_COSINE);
  const words: Word[] = [];
  const vectorsBySpeaker = new Map<string, number[][]>();
  for (const [index, region] of regions.entries()) {
    const speakerId = `speaker-${(labels[index] ?? 0) + 1}`;
    const vector = vectors[index];
    if (vector !== undefined) {
      const list = vectorsBySpeaker.get(speakerId) ?? [];
      list.push(vector);
      vectorsBySpeaker.set(speakerId, list);
    }
    words.push(
      ...offsetWords(regionWords[index] ?? [], region, speakerId, words.length + 1),
    );
  }
  const embeddings: SpeakerEmbedding[] = [...vectorsBySpeaker.entries()].map(
    ([speakerId, speakerVectors]) => ({
      speakerId,
      embedding: l2normalize(meanVectors(speakerVectors)),
    }),
  );
  return { words, embeddings };
}

export function onDeviceProcessor(): Processor {
  return {
    async process(sourcePath, language, controls?: ProcessorControls) {
      const signal = controls?.signal ?? new AbortController().signal;
      const onProgress = controls?.onProgress ?? (() => {});
      throwIfAborted(signal);
      onProgress(0.05);
      const audio = await decodeSourceAudio(sourcePath, signal);
      throwIfAborted(signal);
      onProgress(0.2);
      const { words, embeddings } = await transcribeAndDiarize(
        audio,
        language,
        signal,
        onProgress,
      );
      onProgress(1);
      return resultFromWords(words, embeddings);
    },
  };
}

