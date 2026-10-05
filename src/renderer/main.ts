type Language = "French" | "English";
type PlaybackRate = 1 | 1.5 | 2;

type ProjectView = {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: Date | string;
  readonly language: Language;
  readonly sourcePath: string;
};

type LibraryView = {
  readonly path: string;
  readonly projects: readonly ProjectView[];
  readonly lastUsedLanguage: Language;
};

type PlaybackView = {
  readonly playing: boolean;
  readonly currentTime: number;
  readonly rate: PlaybackRate;
};

type OpenedView = {
  readonly project: ProjectView;
  readonly hasPicture: boolean;
  readonly playback: PlaybackView;
  readonly sourceUrl: string | null;
};

declare global {
  interface Window {
    describer: {
      open: () => Promise<{ library: LibraryView }>;
      importSource: (language: Language) => Promise<{ library: LibraryView }>;
      openProject: (projectId: string) => Promise<OpenedView>;
      play: () => Promise<boolean>;
      setRate: (rate: PlaybackRate) => Promise<PlaybackView>;
      updateProject: (
        projectId: string,
        patch: {
          readonly title?: string;
          readonly recordedAt?: string;
          readonly language?: Language;
        },
      ) => Promise<{ project: ProjectView; library: LibraryView }>;
      locateSource: () => Promise<{ library: LibraryView; opened: OpenedView }>;
      deleteProject: () => Promise<{ library: LibraryView; deleted: boolean }>;
      exportProject: () => Promise<{ library: LibraryView }>;
      importProject: () => Promise<{ library: LibraryView }>;
    };
  }
}

const RATES: readonly PlaybackRate[] = [1, 1.5, 2];

let library: LibraryView;
let opened: OpenedView | undefined;
let importLanguage: Language = "English";

function recordedAtDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateTimeLocal(value: Date | string): string {
  const date = recordedAtDate(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(rest)}`;
  }
  return `${minutes}:${pad(rest)}`;
}

function mediaElement(): HTMLMediaElement | null {
  return document.querySelector("video, audio");
}

async function importSource(): Promise<void> {
  const result = await window.describer.importSource(importLanguage);
  library = result.library;
  importLanguage = library.lastUsedLanguage;
  render();
}

async function importProject(): Promise<void> {
  const result = await window.describer.importProject();
  library = result.library;
  render();
}

async function locateSource(): Promise<void> {
  const result = await window.describer.locateSource();
  library = result.library;
  opened = result.opened;
  render();
  const media = mediaElement();
  if (media !== null && opened.sourceUrl !== null) {
    media.playbackRate = opened.playback.rate;
    void media.play();
  }
}

async function deleteProject(): Promise<void> {
  const result = await window.describer.deleteProject();
  library = result.library;
  if (result.deleted) {
    opened = undefined;
  }
  render();
}

async function exportProject(): Promise<void> {
  const result = await window.describer.exportProject();
  library = result.library;
}

async function openProject(projectId: string): Promise<void> {
  opened = await window.describer.openProject(projectId);
  render();
  const media = mediaElement();
  if (media !== null) {
    media.playbackRate = opened.playback.rate;
    void media.play();
  }
}

async function setRate(rate: PlaybackRate): Promise<void> {
  if (opened === undefined) {
    return;
  }
  opened = { ...opened, playback: await window.describer.setRate(rate) };
  const media = mediaElement();
  if (media !== null) {
    media.playbackRate = rate;
  }
  for (const button of document.querySelectorAll(".rates button")) {
    button.classList.toggle("selected", button.textContent === `${rate}×`);
  }
}

async function saveProject(patch: {
  readonly title?: string;
  readonly recordedAt?: string;
  readonly language?: Language;
}): Promise<void> {
  if (opened === undefined) {
    return;
  }
  const result = await window.describer.updateProject(opened.project.id, patch);
  library = result.library;
  opened = { ...opened, project: result.project };
  const selected = document.querySelector(".project.selected");
  if (selected !== null) {
    selected.textContent = result.project.title;
  }
}

function renderLibraryList(root: HTMLElement): void {
  const heading = document.createElement("h1");
  heading.textContent = "Library";
  root.append(heading);

  const importRow = document.createElement("div");
  importRow.className = "import";

  const language = document.createElement("select");
  language.setAttribute("aria-label", "Language");
  for (const option of ["English", "French"] as const) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    if (option === importLanguage) {
      item.selected = true;
    }
    language.append(item);
  }
  language.addEventListener("change", () => {
    importLanguage = language.value as Language;
  });

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "Import Source";
  importButton.addEventListener("click", () => {
    void importSource();
  });

  const openProjectFile = document.createElement("button");
  openProjectFile.type = "button";
  openProjectFile.textContent = "Open Project file";
  openProjectFile.addEventListener("click", () => {
    void importProject();
  });

  importRow.append(language, importButton, openProjectFile);
  root.append(importRow);

  if (library.projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No Projects yet.";
    root.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "projects";
  for (const project of library.projects) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project";
    if (opened?.project.id === project.id) {
      button.classList.add("selected");
    }
    button.textContent = project.title;
    button.addEventListener("click", () => {
      void openProject(project.id);
    });
    item.append(button);
    list.append(item);
  }
  root.append(list);
}

function renderPlayer(root: HTMLElement): void {
  if (opened === undefined) {
    return;
  }

  const pane = document.createElement("section");
  pane.className = "player";

  const title = document.createElement("input");
  title.type = "text";
  title.value = opened.project.title;
  title.setAttribute("aria-label", "Title");
  title.addEventListener("change", () => {
    void saveProject({ title: title.value });
  });

  const recordedAt = document.createElement("input");
  recordedAt.type = "datetime-local";
  recordedAt.value = toDateTimeLocal(opened.project.recordedAt);
  recordedAt.setAttribute("aria-label", "recorded-at");
  recordedAt.addEventListener("change", () => {
    void saveProject({ recordedAt: new Date(recordedAt.value).toISOString() });
  });

  const language = document.createElement("select");
  language.setAttribute("aria-label", "Project language");
  for (const option of ["English", "French"] as const) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    if (option === opened.project.language) {
      item.selected = true;
    }
    language.append(item);
  }
  language.addEventListener("change", () => {
    void saveProject({ language: language.value as Language });
  });

  pane.append(title, recordedAt, language);

  const actions = document.createElement("div");
  actions.className = "import";

  const locateButton = document.createElement("button");
  locateButton.type = "button";
  locateButton.textContent = "Locate Source";
  locateButton.addEventListener("click", () => {
    void locateSource();
  });

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export Project";
  exportButton.addEventListener("click", () => {
    void exportProject();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    void deleteProject();
  });

  actions.append(locateButton, exportButton, deleteButton);
  pane.append(actions);

  if (opened.sourceUrl === null) {
    const missing = document.createElement("p");
    missing.className = "missing";
    missing.textContent = "Source is missing. Playback cannot start.";
    pane.append(missing);
  } else if (opened.hasPicture) {
    const video = document.createElement("video");
    video.src = opened.sourceUrl;
    video.controls = true;
    video.autoplay = true;
    video.playbackRate = opened.playback.rate;
    pane.append(video);
  } else {
    const clock = document.createElement("p");
    clock.className = "clock";
    clock.textContent = formatClock(opened.playback.currentTime);
    const audio = document.createElement("audio");
    audio.src = opened.sourceUrl;
    audio.controls = true;
    audio.autoplay = true;
    audio.playbackRate = opened.playback.rate;
    audio.addEventListener("timeupdate", () => {
      clock.textContent = formatClock(audio.currentTime);
    });
    pane.append(clock, audio);
  }

  const rates = document.createElement("div");
  rates.className = "rates";
  for (const rate of RATES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${rate}×`;
    if (opened.playback.rate === rate) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      void setRate(rate);
    });
    rates.append(button);
  }
  pane.append(rates);
  root.append(pane);
}

function render(): void {
  const root = document.getElementById("app");
  if (root === null) {
    return;
  }
  root.replaceChildren();
  renderLibraryList(root);
  renderPlayer(root);
}

const started = await window.describer.open();
library = started.library;
importLanguage = library.lastUsedLanguage;
render();

export {};
