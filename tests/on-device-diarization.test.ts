import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { openDescriber } from "../src/core/index.ts";

const execFileAsync = promisify(execFile);

async function twoSpeakerSource(dir: string): Promise<string> {
  const firstPath = path.join(dir, "speaker-1.wav");
  const secondPath = path.join(dir, "speaker-2.wav");
  const sourcePath = path.join(dir, "meeting.wav");
  await execFileAsync("espeak-ng", [
    "-v",
    "en-us",
    "-s",
    "110",
    "-w",
    firstPath,
    "Hello there everyone, this is the first speaker talking now.",
  ]);
  await execFileAsync("espeak-ng", [
    "-v",
    "en+f4",
    "-s",
    "110",
    "-w",
    secondPath,
    "Thanks for joining us today, this is the second speaker.",
  ]);
  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    firstPath,
    "-i",
    secondPath,
    "-filter_complex",
    "[0:a]apad=pad_dur=1.0[a0];[a0][1:a]concat=n=2:v=0:a=1[out]",
    "-map",
    "[out]",
    sourcePath,
  ]);
  return sourcePath;
}

function withoutUploadingSource<T>(
  sourceBytes: Buffer,
  run: () => Promise<T>,
): Promise<T> {
  const marker = sourceBytes.subarray(44, Math.min(sourceBytes.length, 200));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = init?.body;
    const payload =
      body instanceof Buffer
        ? body
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : body instanceof Uint8Array
            ? Buffer.from(body)
            : typeof body === "string"
              ? Buffer.from(body)
              : undefined;
    if (payload !== undefined && marker.length > 0 && payload.includes(marker)) {
      throw new Error(`Source was uploaded to ${url}`);
    }
    if (!/huggingface\.co|hf\.co/i.test(url)) {
      throw new Error(`unexpected network request: ${url}`);
    }
    return originalFetch(input, init);
  };
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test(
  "on-device diarization attributes Words to Speakers named Speaker 1, Speaker 2, and so on",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "describer-diarize-"));
    const libraryDir = path.join(root, "library");
    try {
      const sourcePath = await twoSpeakerSource(root);
      const sourceBytes = await readFile(sourcePath);
      const describer = await openDescriber({ libraryDir });
      const project = await withoutUploadingSource(sourceBytes, () =>
        describer.importSource(sourcePath, "English"),
      );
      const opened = describer.openProject(project.id);
      const words = opened.transcript.utterances.flatMap((utterance) => [
        ...utterance.words,
      ]);
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) {
        expect(word.speakerId.length).toBeGreaterThan(0);
      }
      const speakers = [
        ...new Map(
          opened.transcript.utterances.map((utterance) => [
            utterance.speaker.id,
            utterance.speaker,
          ]),
        ).values(),
      ];
      expect(speakers[0]?.name).toBe("Speaker 1");
      expect(speakers[1]?.name).toBe("Speaker 2");
      expect(speakers.length).toBeGreaterThan(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  300_000,
);

test(
  "a new Utterance starts on Speaker change after on-device diarization",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "describer-diarize-utt-"));
    const libraryDir = path.join(root, "library");
    try {
      const sourcePath = await twoSpeakerSource(root);
      const describer = await openDescriber({ libraryDir });
      const project = await describer.importSource(sourcePath, "English");
      const opened = describer.openProject(project.id);
      const speakerIds = opened.transcript.utterances.map(
        (utterance) => utterance.speaker.id,
      );
      expect(new Set(speakerIds).size).toBeGreaterThan(1);
      expect(
        speakerIds.some(
          (id, index) => index > 0 && id !== speakerIds[index - 1],
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  300_000,
);
