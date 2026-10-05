import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import type {
  Processor,
  ProcessorControls,
  ProcessorResult,
  Speaker,
  Word,
} from "./index.js";

const SAMPLE_RATE = 16000;
const MODEL_ID = "Xenova/whisper-tiny";

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

let transcriberPromise: Promise<Transcriber> | undefined;

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
  const speakerId = "speaker-1";
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
          speakerId,
        },
      ];
    });
  }
  const text = output.text.trim();
  if (text.length === 0) {
    return [];
  }
  return [{ id: "w1", text, start: 0, end: 0, speakerId }];
}

const SINGLE_SPEAKER: Speaker = { id: "speaker-1", name: "Speaker 1" };

function resultFromWords(words: Word[]): ProcessorResult {
  return {
    speakers: words.length === 0 ? [] : [SINGLE_SPEAKER],
    words,
  };
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
          onProgress(0.2 + 0.4 * (info.progress / 100));
        }
      },
    }) as Promise<Transcriber>;
  }
  return transcriberPromise;
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
      const transcriber = await loadTranscriber(onProgress);
      throwIfAborted(signal);
      onProgress(0.7);
      const output = await transcriber(audio, {
        return_timestamps: "word",
        language: language === "French" ? "french" : "english",
        task: "transcribe",
        chunk_length_s: 29,
      });
      throwIfAborted(signal);
      onProgress(1);
      return resultFromWords(wordsFromOutput(output));
    },
  };
}
