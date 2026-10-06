import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DeviceFact, MachineProbe } from "./index.js";

const EMPTY: MachineProbe = {
  devices: [],
  stack: {
    driver: { present: false, version: null },
    cuda13: false,
    cudnn9: false,
  },
};

const LIBRARY_DIRS = [
  "/usr/lib64",
  "/lib64",
  "/usr/lib/x86_64-linux-gnu",
  "/usr/lib",
  "/usr/local/cuda/lib64",
  "/usr/local/cuda-13/lib64",
  "/usr/local/cuda/targets/x86_64-linux/lib",
];

export function probeMachine(): MachineProbe {
  try {
    if (process.platform !== "linux" || process.arch !== "x64") {
      return EMPTY;
    }
    return {
      devices: listDevices(),
      stack: {
        driver: probeDriver(),
        cuda13: libraryPresent("libcudart.so.13"),
        cudnn9: libraryPresent("libcudnn.so.9"),
      },
    };
  } catch {
    return EMPTY;
  }
}

function listDevices(): readonly DeviceFact[] {
  const fromProc = devicesFromProc();
  if (fromProc !== undefined) {
    return fromProc;
  }
  return devicesFromNvidiaSmi();
}

function devicesFromProc(): readonly DeviceFact[] | undefined {
  const gpusDir = "/proc/driver/nvidia/gpus";
  if (!existsSync(gpusDir)) {
    return undefined;
  }
  const devices: DeviceFact[] = [];
  for (const entry of readdirSync(gpusDir)) {
    const infoPath = path.join(gpusDir, entry, "information");
    if (!existsSync(infoPath)) {
      continue;
    }
    const info = readFileSync(infoPath, "utf8");
    const model = /^Model:\s*(.+)$/m.exec(info)?.[1]?.trim();
    if (model !== undefined && model.length > 0) {
      devices.push({ name: model });
    }
  }
  return devices;
}

function devicesFromNvidiaSmi(): readonly DeviceFact[] {
  const listed = nvidiaSmi(["--query-gpu=name", "--format=csv,noheader"]);
  if (listed === undefined) {
    return [];
  }
  return listed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name }));
}

function probeDriver(): { readonly present: boolean; readonly version: string | null } {
  const fromProc = driverFromProc();
  if (fromProc.present) {
    return fromProc;
  }
  const fromSmi = nvidiaSmi([
    "--query-gpu=driver_version",
    "--format=csv,noheader",
  ]);
  if (fromSmi !== undefined) {
    const version = fromSmi.split(/\r?\n/)[0]?.trim();
    if (version !== undefined && version.length > 0) {
      return { present: true, version };
    }
  }
  if (libraryPresent("libcuda.so.1")) {
    return { present: true, version: null };
  }
  return { present: false, version: null };
}

function driverFromProc(): { readonly present: boolean; readonly version: string | null } {
  const versionPath = "/proc/driver/nvidia/version";
  if (!existsSync(versionPath)) {
    return { present: false, version: null };
  }
  const text = readFileSync(versionPath, "utf8");
  const match = /\s(\d+\.\d+\.\d+)\s/.exec(text);
  return { present: true, version: match?.[1] ?? null };
}

function libraryPresent(soname: string): boolean {
  const extras = (process.env.LD_LIBRARY_PATH ?? "")
    .split(":")
    .filter((dir) => dir.length > 0);
  for (const dir of [...LIBRARY_DIRS, ...extras]) {
    if (existsSync(path.join(dir, soname))) {
      return true;
    }
  }
  return false;
}

function nvidiaSmi(args: readonly string[]): string | undefined {
  const result = spawnSync("nvidia-smi", [...args], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || result.stdout === null) {
    return undefined;
  }
  return result.stdout;
}
