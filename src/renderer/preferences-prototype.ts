/*
  Three variants of the Preferences surface, switchable via ?variant=,
  mounted in the existing Library page (editor pane). Stub machine facts;
  mutations stay in memory.
*/

import { attachPrototypeSwitcher } from "./prototype-switcher";

type ComputePreference = "GPU" | "CPU";

type DeviceFact = {
  readonly name: string;
};

type StackFacts = {
  readonly driver: { readonly present: boolean; readonly version: string | null };
  readonly cuda13: boolean;
  readonly cudnn9: boolean;
};

type MachineFacts = {
  readonly devices: readonly DeviceFact[];
  readonly stack: StackFacts;
  readonly latch: boolean;
};

type PrototypeState = {
  preference: ComputePreference;
  machine: MachineFacts;
};

type Scene = {
  readonly key: string;
  readonly name: string;
  readonly preference: ComputePreference;
  readonly machine: MachineFacts;
};

const VARIANTS = [
  { key: "A", name: "Choice first" },
  { key: "B", name: "Machine first" },
  { key: "C", name: "GPU or CPU cards" },
] as const;

const RTX = { name: "NVIDIA GeForce RTX 3060" };
const T1200 = { name: "NVIDIA T1200 Laptop GPU" };

const READY_STACK: StackFacts = {
  driver: { present: true, version: "580.95.05" },
  cuda13: true,
  cudnn9: true,
};

const MISSING_STACK: StackFacts = {
  driver: { present: false, version: null },
  cuda13: false,
  cudnn9: false,
};

const SCENES: readonly Scene[] = [
  {
    key: "ready",
    name: "GPU ready",
    preference: "GPU",
    machine: { devices: [RTX], stack: READY_STACK, latch: false },
  },
  {
    key: "no-device",
    name: "No Device",
    preference: "GPU",
    machine: { devices: [], stack: MISSING_STACK, latch: false },
  },
  {
    key: "stack-missing",
    name: "Stack missing",
    preference: "GPU",
    machine: {
      devices: [RTX],
      stack: {
        driver: { present: true, version: "580.95.05" },
        cuda13: false,
        cudnn9: false,
      },
      latch: false,
    },
  },
  {
    key: "two-devices",
    name: "Two Devices",
    preference: "GPU",
    machine: { devices: [RTX, T1200], stack: READY_STACK, latch: false },
  },
  {
    key: "latched",
    name: "GPU failed",
    preference: "GPU",
    machine: { devices: [RTX], stack: READY_STACK, latch: true },
  },
  {
    key: "cpu",
    name: "CPU chosen",
    preference: "CPU",
    machine: { devices: [RTX], stack: READY_STACK, latch: false },
  },
];

const STUB_PROJECTS = ["Standup 6 Oct", "Interview — Marie", "Weekly"] as const;

function gpuReady(machine: MachineFacts): boolean {
  return (
    machine.devices.length > 0 &&
    machine.stack.driver.present &&
    machine.stack.cuda13 &&
    machine.stack.cudnn9
  );
}

function jobWouldUseGpu(state: PrototypeState): boolean {
  return (
    state.preference === "GPU" && gpuReady(state.machine) && !state.machine.latch
  );
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function readSearch(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function writeSearch(patch: { variant?: string; scene?: string }): void {
  const url = new URL(window.location.href);
  if (patch.variant !== undefined) {
    url.searchParams.set("variant", patch.variant);
  }
  if (patch.scene !== undefined) {
    url.searchParams.set("scene", patch.scene);
  }
  history.replaceState(null, "", url);
}

function sceneByKey(key: string): Scene {
  return SCENES.find((scene) => scene.key === key) ?? SCENES[0]!;
}

function variantKey(raw: string | null): string {
  const found = VARIANTS.find((variant) => variant.key === raw);
  return found?.key ?? "A";
}

function nextJobLabel(state: PrototypeState): string {
  if (jobWouldUseGpu(state)) {
    return "GPU";
  }
  return "CPU";
}

function whyCpu(state: PrototypeState): string | null {
  if (jobWouldUseGpu(state)) {
    return null;
  }
  if (state.preference === "CPU") {
    return "You chose CPU.";
  }
  if (state.machine.latch) {
    return "GPU failed in this process. Later jobs use CPU until you pick CPU, then GPU, or quit Describer.";
  }
  if (state.machine.devices.length === 0) {
    return "No NVIDIA GPU on this machine. Preference is still GPU; this job uses CPU, silently.";
  }
  return "GPU is not ready (driver, CUDA 13, or cuDNN 9). Preference is still GPU; this job uses CPU, silently.";
}

function mark(ok: boolean): string {
  return ok ? "Yes" : "No";
}

function driverLabel(stack: StackFacts): string {
  if (stack.driver.present && stack.driver.version !== null) {
    return stack.driver.version;
  }
  return "Missing";
}

function pickGpu(state: PrototypeState): void {
  const wasCpu = state.preference === "CPU";
  state.preference = "GPU";
  if (wasCpu) {
    state.machine = { ...state.machine, latch: false };
  }
}

function pickCpu(state: PrototypeState): void {
  state.preference = "CPU";
}

function renderLibrary(root: HTMLElement): void {
  const heading = el("h1", undefined, "Library");
  root.append(heading);

  const importRow = el("div", "import");
  const language = el("select");
  language.setAttribute("aria-label", "Language");
  const english = el("option", undefined, "English");
  english.selected = true;
  language.append(english, el("option", undefined, "French"));
  importRow.append(
    language,
    el("button", undefined, "Import Source"),
    el("button", undefined, "Open Project file"),
  );
  root.append(importRow);

  const prefs = el("button", "project selected", "Preferences");
  prefs.type = "button";
  prefs.setAttribute("aria-current", "page");
  const prefsWrap = el("p", "proto-nav");
  prefsWrap.append(prefs);
  root.append(prefsWrap);

  const list = el("ul", "projects");
  for (const [index, title] of STUB_PROJECTS.entries()) {
    const item = el("li");
    const button = el("button", "project", title);
    button.type = "button";
    if (index === 0) {
      button.classList.add("proto-inert");
    }
    item.append(button);
    list.append(item);
  }
  root.append(list);
}

function renderStateStrip(state: PrototypeState): HTMLElement {
  const strip = el("aside", "proto-facts");
  strip.setAttribute("aria-label", "Prototype facts");
  const bits: Array<[string, string]> = [
    ["Preference", state.preference],
    ["GPU is ready", mark(gpuReady(state.machine))],
    ["Latch", state.machine.latch ? "Set" : "Clear"],
    [
      "Devices",
      state.machine.devices.length === 0
        ? "None"
        : state.machine.devices.map((device) => device.name).join(" · "),
    ],
    ["NVIDIA driver", driverLabel(state.machine.stack)],
    ["CUDA 13", mark(state.machine.stack.cuda13)],
    ["cuDNN 9", mark(state.machine.stack.cudnn9)],
    ["Next job", nextJobLabel(state)],
  ];
  for (const [label, value] of bits) {
    const row = el("div", "proto-facts-row");
    row.append(el("dt", undefined, label), el("dd", undefined, value));
    strip.append(row);
  }
  return strip;
}

function renderScenes(
  current: string,
  onPick: (key: string) => void,
): HTMLElement {
  const bar = el("div", "proto-scenes");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Machine fixtures");
  const caption = el("span", "proto-scenes-label", "Machine");
  bar.append(caption);
  for (const scene of SCENES) {
    const button = el("button", undefined, scene.name);
    button.type = "button";
    if (scene.key === current) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      onPick(scene.key);
    });
    bar.append(button);
  }
  return bar;
}

function renderVariantA(
  state: PrototypeState,
  redraw: () => void,
): HTMLElement {
  const pane = el("section", "proto-a");

  pane.append(el("h2", undefined, "Preferences"));
  pane.append(
    el(
      "p",
      "proto-lede",
      "App-wide. The only choice is whether the Processor runs on GPU or CPU.",
    ),
  );

  const field = el("div", "proto-a-choice");
  field.append(el("p", "proto-label", "The Processor runs on"));
  const row = el("div", "rates proto-a-toggle");
  for (const value of ["GPU", "CPU"] as const) {
    const button = el("button", undefined, value);
    button.type = "button";
    if (state.preference === value) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      if (value === "GPU") {
        pickGpu(state);
      } else {
        pickCpu(state);
      }
      redraw();
    });
    row.append(button);
  }
  field.append(row);

  const next = el("p", "proto-a-next");
  const reason = whyCpu(state);
  next.append(
    el("strong", undefined, `Next job: ${nextJobLabel(state)}`),
  );
  if (reason !== null) {
    next.append(document.createTextNode(` — ${reason}`));
  }
  field.append(next);
  pane.append(field);

  pane.append(el("h3", undefined, "Devices"));
  if (state.machine.devices.length === 0) {
    pane.append(el("p", "empty", "No NVIDIA GPU on this machine."));
  } else {
    const list = el("ul", "proto-a-devices");
    for (const device of state.machine.devices) {
      list.append(el("li", undefined, device.name));
    }
    pane.append(list);
    pane.append(
      el("p", "proto-hint", "Detected on this machine. You do not pick a card."),
    );
  }

  pane.append(el("h3", undefined, "GPU is ready"));
  pane.append(
    el(
      "p",
      gpuReady(state.machine) ? "proto-ready" : "proto-unready",
      mark(gpuReady(state.machine)),
    ),
  );

  const facts = el("dl", "proto-a-facts");
  const rows: Array<[string, string]> = [
    ["NVIDIA driver", driverLabel(state.machine.stack)],
    ["CUDA 13", mark(state.machine.stack.cuda13)],
    ["cuDNN 9", mark(state.machine.stack.cudnn9)],
  ];
  for (const [label, value] of rows) {
    facts.append(el("dt", undefined, label), el("dd", undefined, value));
  }
  pane.append(facts);
  return pane;
}

function renderVariantB(
  state: PrototypeState,
  redraw: () => void,
): HTMLElement {
  const pane = el("section", "proto-b");
  pane.append(el("h2", undefined, "This machine"));

  const devices = el("div", "proto-b-devices");
  if (state.machine.devices.length === 0) {
    const empty = el("div", "proto-b-empty");
    empty.append(
      el("p", "proto-b-empty-title", "No NVIDIA GPU"),
      el(
        "p",
        "empty",
        "CPU is not a Device. The Processor still runs; next job uses CPU.",
      ),
    );
    devices.append(empty);
  } else {
    for (const device of state.machine.devices) {
      const card = el("article", "proto-b-device");
      card.append(el("p", "proto-b-device-kicker", "Device"));
      card.append(el("h3", undefined, device.name));
      devices.append(card);
    }
    devices.append(
      el("p", "proto-hint", "The Processor does not pick a Device."),
    );
  }
  pane.append(devices);

  const ready = gpuReady(state.machine);
  const report = el("div", "proto-b-report");
  const heading = el("div", "proto-b-ready-row");
  heading.append(el("h3", undefined, "GPU is ready"));
  heading.append(
    el("span", ready ? "proto-ready" : "proto-unready", mark(ready)),
  );
  report.append(heading);

  const checks = el("ul", "proto-b-checks");
  const items: Array<[string, boolean, string]> = [
    [
      "NVIDIA GPU present",
      state.machine.devices.length > 0,
      state.machine.devices.length === 0
        ? "None"
        : `${state.machine.devices.length} detected`,
    ],
    [
      "NVIDIA driver",
      state.machine.stack.driver.present,
      driverLabel(state.machine.stack),
    ],
    ["CUDA 13", state.machine.stack.cuda13, mark(state.machine.stack.cuda13)],
    ["cuDNN 9", state.machine.stack.cudnn9, mark(state.machine.stack.cudnn9)],
  ];
  if (state.machine.latch) {
    items.push(["This process", false, "GPU failed"]);
  }
  for (const [label, ok, detail] of items) {
    const item = el("li", ok ? "ok" : "fail");
    item.append(
      el("span", "proto-b-check-mark", ok ? "●" : "○"),
      el("span", "proto-b-check-label", label),
      el("span", "proto-b-check-detail", detail),
    );
    checks.append(item);
  }
  report.append(checks);
  pane.append(report);

  const choice = el("div", "proto-b-choice");
  choice.append(el("h3", undefined, "Processor"));
  choice.append(
    el("p", "proto-hint", "Jobs use GPU only when it is ready and this process has not failed."),
  );
  const radios = el("div", "proto-b-radios");
  for (const value of ["GPU", "CPU"] as const) {
    const label = el("label", "proto-b-radio");
    const input = el("input");
    input.type = "radio";
    input.name = "processor-preference";
    input.value = value;
    input.checked = state.preference === value;
    input.addEventListener("change", () => {
      if (value === "GPU") {
        pickGpu(state);
      } else {
        pickCpu(state);
      }
      redraw();
    });
    label.append(input, document.createTextNode(value));
    radios.append(label);
  }
  choice.append(radios);
  const reason = whyCpu(state);
  choice.append(
    el(
      "p",
      "proto-b-next",
      reason === null
        ? "Next job: GPU"
        : `Next job: CPU — ${reason}`,
    ),
  );
  pane.append(choice);
  return pane;
}

function renderVariantC(
  state: PrototypeState,
  redraw: () => void,
): HTMLElement {
  const overlay = el("div", "proto-c-overlay");
  const sheet = el("div", "proto-c-sheet");
  sheet.append(el("h2", undefined, "Preferences"));
  sheet.append(
    el("p", "proto-lede", "How should the Processor run on this machine?"),
  );

  const grid = el("div", "proto-c-grid");

  const gpu = el("article", "proto-c-card");
  if (state.preference === "GPU") {
    gpu.classList.add("selected");
  }
  gpu.append(el("h3", undefined, "GPU"));
  if (state.machine.devices.length === 0) {
    gpu.append(el("p", "empty", "No NVIDIA GPU on this machine."));
  } else {
    const list = el("ul", "proto-c-devices");
    for (const device of state.machine.devices) {
      list.append(el("li", undefined, device.name));
    }
    gpu.append(list);
  }
  gpu.append(
    el(
      "p",
      gpuReady(state.machine) ? "proto-ready" : "proto-unready",
      `GPU is ready: ${mark(gpuReady(state.machine))}`,
    ),
  );
  const diag = el("p", "proto-c-diag");
  diag.textContent = [
    `Driver ${driverLabel(state.machine.stack)}`,
    `CUDA 13 ${mark(state.machine.stack.cuda13)}`,
    `cuDNN 9 ${mark(state.machine.stack.cudnn9)}`,
  ].join(" · ");
  gpu.append(diag);
  if (state.machine.latch) {
    gpu.append(
      el(
        "p",
        "proto-c-latch",
        "GPU failed in this process. Pick CPU, then GPU, to try again.",
      ),
    );
  }
  const useGpu = el("button", undefined, "Use GPU");
  useGpu.type = "button";
  if (state.preference === "GPU") {
    useGpu.classList.add("selected");
  }
  useGpu.addEventListener("click", () => {
    pickGpu(state);
    redraw();
  });
  gpu.append(useGpu);

  const cpu = el("article", "proto-c-card");
  if (state.preference === "CPU") {
    cpu.classList.add("selected");
  }
  cpu.append(el("h3", undefined, "CPU"));
  cpu.append(
    el(
      "p",
      "proto-c-cpu-copy",
      "Always available. Stored only if you pick it. A later Device does not switch this back.",
    ),
  );
  const useCpu = el("button", undefined, "Use CPU");
  useCpu.type = "button";
  if (state.preference === "CPU") {
    useCpu.classList.add("selected");
  }
  useCpu.addEventListener("click", () => {
    pickCpu(state);
    redraw();
  });
  cpu.append(useCpu);

  grid.append(gpu, cpu);
  sheet.append(grid);

  const reason = whyCpu(state);
  sheet.append(
    el(
      "p",
      "proto-c-next",
      reason === null
        ? "Next job: GPU"
        : `Next job: CPU — ${reason}`,
    ),
  );
  overlay.append(sheet);
  return overlay;
}

export function mountPreferencesPrototype(): void {
  let variant = variantKey(readSearch().get("variant"));
  let sceneKey = sceneByKey(readSearch().get("scene") ?? "ready").key;
  let state: PrototypeState = {
    preference: sceneByKey(sceneKey).preference,
    machine: sceneByKey(sceneKey).machine,
  };

  const chrome = el("div", "proto-chrome");
  const banner = el("div", "proto-banner");
  banner.textContent =
    "Throwaway prototype — what does the owner see on Preferences? Not production. #25";
  chrome.append(banner);
  document.body.prepend(chrome);

  const switcher = attachPrototypeSwitcher({
    variants: VARIANTS,
    currentKey: variant,
    onChange: (key) => {
      variant = key;
      writeSearch({ variant: key });
      switcher.setCurrent(key);
      render();
    },
  });

  const render = (): void => {
    const root = document.getElementById("app");
    if (root === null) {
      return;
    }
    document.querySelector(".proto-c-overlay")?.remove();
    document.querySelector(".proto-facts")?.remove();
    document.querySelector(".proto-scenes")?.remove();

    root.replaceChildren();
    renderLibrary(root);
    const host = el("div", "editor proto-host");
    if (variant === "B") {
      host.append(renderVariantB(state, render));
    } else if (variant === "C") {
      host.append(
        el(
          "p",
          "empty proto-c-ghost",
          "Library stays put. Preferences is the overlay.",
        ),
      );
      document.body.append(renderVariantC(state, render));
    } else {
      host.append(renderVariantA(state, render));
    }
    root.append(host);
    chrome.append(renderStateStrip(state));
    document.body.append(
      renderScenes(sceneKey, (key) => {
        sceneKey = key;
        const scene = sceneByKey(key);
        state = { preference: scene.preference, machine: scene.machine };
        writeSearch({ scene: key });
        render();
      }),
    );
  };

  writeSearch({ variant, scene: sceneKey });
  render();
}
