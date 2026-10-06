import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type Processor,
  type ProcessorResult,
  type Word,
} from "../src/core/index.ts";

const execFileAsync = promisify(execFile);

const speaker1 = { id: "s1", name: "Speaker 1" };

async function withSource(
  run: (paths: { libraryDir: string; sourcePath: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "describer-stt-"));
  const libraryDir = path.join(root, "library");
  const sourcePath = path.join(root, "standup.wav");
  await writeFile(sourcePath, "");
  try {
    await run({ libraryDir, sourcePath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function timed(
  id: string,
  text: string,
  start: number,
  end: number,
): Word {
  return { id, text, start, end, speakerId: "s1", paragraphBreakBefore: false };
}

function wordsOf(describer: Awaited<ReturnType<typeof openDescriber>>, projectId: string): Word[] {
  return describer
    .openProject(projectId)
    .transcript.utterances.flatMap((utterance) => [...utterance.words]);
}

test("processing a Source produces timed Words in the Transcript", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const words = [
      timed("w1", "hello", 0, 0.4),
      timed("w2", "world", 0.4, 0.9),
    ];
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(words),
    });
    const project = await describer.importSource(sourcePath, "English");
    expect(wordsOf(describer, project.id)).toEqual(words);
  });
});

test("Words use the language chosen at import", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const processor: Processor = {
      async process(_sourcePath, language, _compute, controls) {
        controls?.onProgress(1);
        const words =
          language === "French"
            ? [timed("w1", "bonjour", 0, 0.5)]
            : [timed("w1", "hello", 0, 0.5)];
        return { speakers: [speaker1], words };
      },
    };
    const describer = await openDescriber({ libraryDir, processor });
    const project = await describer.importSource(sourcePath, "French");
    expect(project.language).toBe("French");
    expect(wordsOf(describer, project.id)).toEqual([
      timed("w1", "bonjour", 0, 0.5),
    ]);
  });
});

test("progress is visible while processing runs", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    let reportProgress: ((progress: number) => void) | undefined;
    let finish: ((result: ProcessorResult) => void) | undefined;
    const processor: Processor = {
      process(_sourcePath, _language, _compute, controls) {
        reportProgress = controls?.onProgress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    const describer = await openDescriber({ libraryDir, processor });
    const pending = describer.importSource(sourcePath, "English");
    await expect.poll(() => describer.processing != null).toBe(true);
    reportProgress?.(0.4);
    expect(describer.processing).toEqual({ progress: 0.4 });
    expect(describer.library.projects).toHaveLength(1);
    const queued = describer.library.projects[0];
    if (queued === undefined) {
      throw new Error("queued Project missing");
    }
    expect(describer.openProject(queued.id).transcript.editable).toBe(false);
    finish?.({ speakers: [], words: [] });
    const project = await pending;
    expect(wordsOf(describer, project.id)).toEqual([]);
    expect(describer.openProject(project.id).transcript.editable).toBe(true);
    expect(describer.processing).toBeNull();
  });
});

test("cancelling processing leaves no Project and does not touch the Source", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const processor: Processor = {
      process(_sourcePath, _language, _compute, controls) {
        return new Promise((_, reject) => {
          const fail = () => {
            reject(new Error("Processing cancelled"));
          };
          const signal = controls?.signal;
          if (signal === undefined || signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener("abort", fail, { once: true });
        });
      },
    };
    const describer = await openDescriber({ libraryDir, processor });
    const pending = describer.importSource(sourcePath, "English");
    await expect.poll(() => describer.processing != null).toBe(true);
    describer.cancelProcessing();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(describer.library.projects).toEqual([]);
    expect(describer.processing).toBeNull();
    await access(sourcePath, constants.F_OK);
    const reopened = await openDescriber({ libraryDir, processor });
    expect(reopened.library.projects).toEqual([]);
  });
});

test("a failed process leaves no Project and does not touch the Source", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const original = Buffer.from("source-bytes");
    await writeFile(sourcePath, original);
    const processor: Processor = {
      async process() {
        throw new Error("whisper failed");
      },
    };
    const describer = await openDescriber({ libraryDir, processor });
    await expect(describer.importSource(sourcePath, "English")).rejects.toThrow(
      /whisper failed/,
    );
    expect(describer.library.projects).toEqual([]);
    expect(describer.processing).toBeNull();
    expect(await readFile(sourcePath)).toEqual(original);
    const reopened = await openDescriber({ libraryDir, processor });
    expect(reopened.library.projects).toEqual([]);
  });
});

test("a successful process with no speech yields an empty Transcript", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([]),
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    expect(opened.transcript.utterances).toEqual([]);
    expect(describer.library.projects).toEqual([project]);
  });
});

test("a processed Transcript persists without an explicit Save", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const words = [timed("w1", "hello", 0, 0.4)];
    const describer = await openDescriber({
      libraryDir,
      processor: fixtureProcessor(words),
    });
    const project = await describer.importSource(sourcePath, "English");
    const reopened = await openDescriber({
      libraryDir,
      processor: fixtureProcessor([]),
    });
    expect(wordsOf(reopened, project.id)).toEqual(words);
  });
});

test(
  "on-device processing produces timed Words without uploading the Source",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "describer-stt-real-"));
    const libraryDir = path.join(root, "library");
    const sourcePath = path.join(root, "hello.wav");
    await execFileAsync("espeak-ng", [
      "-w",
      sourcePath,
      "-s",
      "120",
      "hello",
    ]);
    const sourceBytes = await readFile(sourcePath);
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
    try {
      const describer = await openDescriber({ libraryDir });
      const project = await describer.importSource(sourcePath, "English");
      const words = wordsOf(describer, project.id);
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) {
        expect(word.text.length).toBeGreaterThan(0);
        expect(typeof word.start).toBe("number");
        expect(typeof word.end).toBe("number");
        expect(word.end).toBeGreaterThanOrEqual(word.start);
      }
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);

test("on-device processing of invalid media leaves no Project", async () => {
  await withSource(async ({ libraryDir, sourcePath }) => {
    const describer = await openDescriber({ libraryDir });
    await expect(describer.importSource(sourcePath, "English")).rejects.toThrow(
      /Failed to read Source audio/,
    );
    expect(describer.library.projects).toEqual([]);
    await access(sourcePath, constants.F_OK);
  });
});
