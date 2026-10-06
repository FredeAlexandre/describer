import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  fixtureProcessor,
  openDescriber,
  type ComputePreference,
  type StackFacts,
} from "../src/core/index.ts";

const MISSING_STACK: StackFacts = {
  driver: { present: false, version: null },
  cuda13: false,
  cudnn9: false,
};

const READY_STACK: StackFacts = {
  driver: { present: true, version: "580.95.05" },
  cuda13: true,
  cudnn9: true,
};

const RTX = { name: "NVIDIA GeForce RTX 3060" };
const T1200 = { name: "NVIDIA T1200 Laptop GPU" };

async function withPrefs(
  run: (paths: {
    libraryDir: string;
    configDir: string;
    sourcePath: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "describer-prefs-"));
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

test("factory Preference GPU survives relaunch from configDir and is not stored in the Library", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const first = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [], stack: MISSING_STACK },
      processor: fixtureProcessor(),
    });
    expect(first.preferences.compute).toBe("GPU");
    const project = await first.importSource(sourcePath, "English");
    const reopened = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [], stack: MISSING_STACK },
      processor: fixtureProcessor(),
    });
    expect(reopened.preferences.compute).toBe("GPU");
    expect(reopened.library.projects).toEqual([project]);
    const libraryJson = JSON.parse(
      await readFile(path.join(libraryDir, "library.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(libraryJson).not.toHaveProperty("compute");
    expect(libraryJson).not.toHaveProperty("preferences");
  });
});

test("two Devices are listed and CPU is not a Device", async () => {
  await withPrefs(async ({ libraryDir, configDir }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX, T1200], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    expect(describer.machine.devices).toEqual([RTX, T1200]);
    expect(
      describer.machine.devices.some((device) => /cpu/i.test(device.name)),
    ).toBe(false);
  });
});

test("ready machine with Preference GPU tells the Processor GPU", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
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
    await describer.importSource(sourcePath, "English");
    expect(told).toEqual(["GPU"]);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("picking CPU stays CPU after a Device appears", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const machine = {
      devices: [] as { readonly name: string }[],
      stack: MISSING_STACK,
    };
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine,
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    await describer.setComputePreference("CPU");
    expect(describer.preferences.compute).toBe("CPU");
    machine.devices = [RTX];
    machine.stack = READY_STACK;
    await describer.importSource(sourcePath, "English");
    expect(told).toEqual(["CPU"]);
    expect(describer.preferences.compute).toBe("CPU");
  });
});

test("CPU Preference persists under configDir and is shared by two Libraries", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const first = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    await first.setComputePreference("CPU");
    const otherLibrary = path.join(path.dirname(libraryDir), "library-b");
    const second = await openDescriber({
      libraryDir: otherLibrary,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    expect(second.preferences.compute).toBe("CPU");
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
    expect(relaunched.preferences.compute).toBe("CPU");
    await relaunched.importSource(sourcePath, "English");
    expect(told).toEqual(["CPU"]);
    const libraryJson = JSON.parse(
      await readFile(path.join(libraryDir, "library.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(libraryJson).not.toHaveProperty("compute");
    expect(libraryJson).not.toHaveProperty("preferences");
  });
});

test("picking GPU restores the factory Preference", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const first = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    await first.setComputePreference("CPU");
    await first.setComputePreference("GPU");
    const relaunched = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    expect(relaunched.preferences.compute).toBe("GPU");
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
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
    await describer.importSource(sourcePath, "English");
    expect(told).toEqual(["GPU"]);
  });
});

test("a running job keeps the compute it started with and queued jobs bind at start", async () => {
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
          return new Promise((resolve) => {
            gates.push(() => {
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
    await describer.setComputePreference("CPU");
    gates[0]?.();
    await pendingFirst;
    await expect.poll(() => told.length).toBe(2);
    expect(told).toEqual(["GPU", "CPU"]);
    gates[1]?.();
    await pendingSecond;
  });
});

test("GPU is not ready when CUDA 13 is missing and the driver version is listed when present", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: {
        devices: [RTX],
        stack: {
          driver: { present: true, version: "580.95.05" },
          cuda13: false,
          cudnn9: true,
        },
      },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    expect(describer.machine.gpuReady).toBe(false);
    expect(describer.machine.stack.driver).toEqual({
      present: true,
      version: "580.95.05",
    });
    expect(describer.machine.stack.cuda13).toBe(false);
    expect(describer.machine.stack.cudnn9).toBe(true);
    expect(describer.machine.latch).toBe(false);
    await describer.importSource(sourcePath, "English");
    expect(told).toEqual(["CPU"]);
    expect(describer.preferences.compute).toBe("GPU");
  });
});

test("next job is CPU with a reason when there is no Device", async () => {
  await withPrefs(async ({ libraryDir, configDir }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [], stack: MISSING_STACK },
      processor: fixtureProcessor(),
    });
    expect(describer.nextJob.compute).toBe("CPU");
    expect(describer.nextJob.whyCpu).toBe(
      "No NVIDIA GPU on this machine. Preference is still GPU; this job uses CPU, silently.",
    );
  });
});

test("next job is GPU when Preference is GPU and GPU is ready", async () => {
  await withPrefs(async ({ libraryDir, configDir }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    expect(describer.nextJob.compute).toBe("GPU");
    expect(describer.nextJob.whyCpu).toBeNull();
  });
});

test("next job is CPU because the owner chose CPU", async () => {
  await withPrefs(async ({ libraryDir, configDir }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [RTX], stack: READY_STACK },
      processor: fixtureProcessor(),
    });
    await describer.setComputePreference("CPU");
    expect(describer.nextJob.compute).toBe("CPU");
    expect(describer.nextJob.whyCpu).toBe("You chose CPU.");
  });
});

test("next job is CPU with a stack reason when CUDA 13 is missing", async () => {
  await withPrefs(async ({ libraryDir, configDir }) => {
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: {
        devices: [RTX],
        stack: {
          driver: { present: true, version: "580.95.05" },
          cuda13: false,
          cudnn9: true,
        },
      },
      processor: fixtureProcessor(),
    });
    expect(describer.nextJob.compute).toBe("CPU");
    expect(describer.nextJob.whyCpu).toBe(
      "GPU is not ready (driver, CUDA 13, or cuDNN 9). Preference is still GPU; this job uses CPU, silently.",
    );
  });
});

test("Preference GPU, no Device, import succeeds, Processor was told CPU, Preference still GPU", async () => {
  await withPrefs(async ({ libraryDir, configDir, sourcePath }) => {
    const told: ComputePreference[] = [];
    const describer = await openDescriber({
      libraryDir,
      configDir,
      machine: { devices: [], stack: MISSING_STACK },
      processor: {
        async process(src, language, compute, controls) {
          told.push(compute);
          return fixtureProcessor().process(src, language, compute, controls);
        },
      },
    });
    const project = await describer.importSource(sourcePath, "English");
    expect(project.title).toBe("standup.mp4");
    expect(told).toEqual(["CPU"]);
    expect(describer.preferences.compute).toBe("GPU");
  });
});
