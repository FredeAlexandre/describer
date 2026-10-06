import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  BindTimeGpuFailure,
  MidJobGpuFailure,
  fixtureProcessor,
  openDescriber,
  type ComputePreference,
  type StackFacts,
  type Word,
} from "../src/core/index.ts";

const READY_STACK: StackFacts = {
  driver: { present: true, version: "580.95.05" },
  cuda13: true,
  cudnn9: true,
};

const RTX = { name: "NVIDIA GeForce RTX 3060" };

async function withPrefs(
  run: (paths: {
    libraryDir: string;
    configDir: string;
    sourcePath: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "describer-latch-"));
  const libraryDir = path.join(root, "library");
  const configDir = path.join(root, "config");
  const sourcePath = path.join(root, "standup.mp4");
  await writeFile(sourcePath, "media-bytes");
  try {
    await run({ libraryDir, configDir, sourcePath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Preference GPU, bind-time CUDA failure, import succeeds, Processor was told GPU then CPU, latch set, Preference still GPU", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          if (compute === "GPU") {
            throw new BindTimeGpuFailure();
          }
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    expect(project.title).toBe("standup.mp4");
    expect(told).toEqual(["GPU", "CPU"]);
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("later jobs in this process run on CPU silently while latched", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const secondPath = path.join(path.dirname(sourcePath), "retro.wav");
    await writeFile(secondPath, "media-bytes");
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          if (compute === "GPU") {
            throw new BindTimeGpuFailure();
          }
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    await describer.importSource(sourcePath, "English");
    await describer.importSource(secondPath, "French");
    expect(told).toEqual(["GPU", "CPU", "CPU"]);
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
    expect(describer.nextJob.compute).toBe("CPU");
    expect(describer.nextJob.whyCpu).toBe(
      "GPU failed in this process. Later jobs use CPU until you pick CPU, then GPU, or quit Describer.",
    );
  });
});

test("bind-time CUDA failure still drops the import if the CPU Processor throws", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(_src, _language, compute) {
          told.push(compute);
          if (compute === "GPU") {
            throw new BindTimeGpuFailure();
          }
          throw new Error("CPU Processor failed");
        },
      },
    });
    await expect(describer.importSource(sourcePath, "English")).rejects.toThrow(
      /CPU Processor failed/,
    );
    expect(told).toEqual(["GPU", "CPU"]);
    expect(describer.library.projects).toEqual([]);
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("mid-job GPU death drops the import, does not retry on CPU, then latches", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(_src, _language, compute) {
          told.push(compute);
          throw new MidJobGpuFailure();
        },
      },
    });
    await expect(describer.importSource(sourcePath, "English")).rejects.toThrow(
      MidJobGpuFailure,
    );
    expect(told).toEqual(["GPU"]);
    expect(describer.library.projects).toEqual([]);
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("mid-job GPU death on re-process keeps the old Transcript and latches", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const speaker1 = { id: "s1", name: "Speaker 1" };
    const hello: Word = {
      id: "w1",
      text: "Hello",
      start: 0,
      end: 0.4,
      speakerId: "s1",
      paragraphBreakBefore: false,
    };
    let pass = 0;
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          pass += 1;
          if (pass === 2) {
            throw new MidJobGpuFailure();
          }
          return fixtureProcessor([hello]).process(
            src,
            language,
            compute,
            controls,
          );
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    const opened = describer.openProject(project.id);
    await expect(describer.reprocessProject(project.id, true)).rejects.toThrow(
      MidJobGpuFailure,
    );
    expect(told).toEqual(["GPU", "GPU"]);
    expect(opened.transcript.utterances).toEqual([
      { speaker: speaker1, words: [hello] },
    ]);
    expect(describer.library.projects).toEqual([project]);
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("latch is not persisted and a new Describer process tries GPU again", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const first = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          if (compute === "GPU") {
            throw new BindTimeGpuFailure();
          }
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    await first.importSource(sourcePath, "English");
    expect(first.machine.latch).toBe(true);
    const libraryJson = JSON.parse(
      await readFile(path.join(libraryDir, "library.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(libraryJson).not.toHaveProperty("latch");
    const told: ComputePreference[] = [];
    const relaunched = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    expect(relaunched.machine.latch).toBe(false);
    expect(relaunched.preferences.compute).toBe("GPU");
    await relaunched.importSource(sourcePath, "English");
    expect(told).toEqual(["GPU"]);
  });
});

test("a CPU pick while latched is stored CPU until Preference CPU then GPU clears the latch", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const extraPath = path.join(path.dirname(sourcePath), "retro.wav");
    const thirdPath = path.join(path.dirname(sourcePath), "planning.wav");
    await writeFile(extraPath, "media-bytes");
    await writeFile(thirdPath, "media-bytes");
    let gpuCalls = 0;
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          if (compute === "GPU") {
            gpuCalls += 1;
            if (gpuCalls === 1) {
              throw new BindTimeGpuFailure();
            }
          }
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    await describer.importSource(sourcePath, "English");
    expect(describer.machine.latch).toBe(true);
    await describer.setComputePreference("CPU");
    expect(describer.preferences.compute).toBe("CPU");
    expect(describer.machine.latch).toBe(true);
    expect(
      JSON.parse(
        await readFile(path.join(configDir, "preferences.json"), "utf8"),
      ),
    ).toEqual({ compute: "CPU" });
    await describer.importSource(extraPath, "English");
    expect(told).toEqual(["GPU", "CPU", "CPU"]);
    await describer.setComputePreference("GPU");
    expect(describer.preferences.compute).toBe("GPU");
    expect(describer.machine.latch).toBe(false);
    await describer.importSource(thirdPath, "English");
    expect(told).toEqual(["GPU", "CPU", "CPU", "GPU"]);
    expect(describer.machine.latch).toBe(false);
  });
});

test("queued jobs bind at start so a mid-job GPU death latches later jobs to CPU", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const secondPath = path.join(path.dirname(sourcePath), "retro.wav");
    await writeFile(secondPath, "media-bytes");
    const told: ComputePreference[] = [];
    const gates: Array<() => void> = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        process(src, language, compute, controls) {
          told.push(compute);
          return new Promise((resolve, reject) => {
            gates.push(() => {
              if (compute === "GPU") {
                reject(new MidJobGpuFailure());
                return;
              }
              void resolve(
                fixtureProcessor().process(src, language, compute, controls),
              );
            });
          });
        },
      },
    });
    const pendingFirst = describer.importSource(sourcePath, "English");
    const pendingSecond = describer.importSource(secondPath, "French");
    await expect.poll(() => told.length).toBe(1);
    expect(told).toEqual(["GPU"]);
    gates[0]?.();
    await expect(pendingFirst).rejects.toThrow(MidJobGpuFailure);
    await expect.poll(() => told.length).toBe(2);
    expect(told).toEqual(["GPU", "CPU"]);
    gates[1]?.();
    await pendingSecond;
    expect(describer.machine.latch).toBe(true);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("a Processor failure that is not a GPU death drops the import and does not latch", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: {
        async process() {
          throw new Error("whisper failed");
        },
      },
    });
    await expect(describer.importSource(sourcePath, "English")).rejects.toThrow(
      /whisper failed/,
    );
    expect(describer.library.projects).toEqual([]);
    expect(describer.machine.latch).toBe(false);
    expect(describer.preferences.compute).toBe("GPU");
  });
});
