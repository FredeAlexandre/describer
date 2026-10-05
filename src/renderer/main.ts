type Language = "French" | "English";
type PlaybackRate = 1 | 1.5 | 2;

type WordPlacement = "before" | "after";

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

type ProcessingView = {
  readonly progress: number;
};

type WordView = {
  readonly id: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly speakerId: string;
  readonly paragraphBreakBefore: boolean;
};

type SpeakerView = {
  readonly id: string;
  readonly name: string;
};

type UtteranceView = {
  readonly speaker: SpeakerView;
  readonly words: readonly WordView[];
};

type TranscriptView = {
  readonly utterances: readonly UtteranceView[];
  readonly editable: boolean;
  readonly speakers: readonly SpeakerView[];
};

type OpenedView = {
  readonly project: ProjectView;
  readonly hasPicture: boolean;
  readonly playback: PlaybackView;
  readonly sourceUrl: string | null;
  readonly transcript: TranscriptView;
  readonly currentWord: WordView | null;
};

type SearchHitView = {
  readonly project: ProjectView;
  readonly word: WordView | null;
};

declare global {
  interface Window {
    describer: {
      open: () => Promise<{ library: LibraryView }>;
      importSource: (language: Language) => Promise<{ library: LibraryView }>;
      cancelProcessing: () => Promise<void>;
      onProcessing: (
        listener: (processing: ProcessingView | null) => void,
      ) => () => void;
      onLibrary: (listener: (library: LibraryView) => void) => () => void;
      openProject: (projectId: string) => Promise<OpenedView>;
      getOpened: () => Promise<OpenedView | null>;
      reprocessProject: () => Promise<{
        library: LibraryView;
        opened: OpenedView;
        reprocessed: boolean;
      }>;
      play: () => Promise<boolean>;
      setRate: (rate: PlaybackRate) => Promise<PlaybackView>;
      seekToWord: (wordId: string) => Promise<OpenedView>;
      changeWordText: (wordId: string, text: string) => Promise<OpenedView>;
      deleteWord: (wordId: string) => Promise<OpenedView>;
      insertWord: (
        neighborId: string,
        text: string,
        placement: WordPlacement,
      ) => Promise<OpenedView & { inserted: WordView }>;
      insertParagraphBreak: (wordId: string) => Promise<OpenedView>;
      renameSpeaker: (speakerId: string, name: string) => Promise<OpenedView>;
      mergeSpeakers: (fromId: string, intoId: string) => Promise<OpenedView>;
      reassignWords: (
        wordIds: readonly string[],
        speaker: SpeakerView,
      ) => Promise<OpenedView>;
      undo: () => Promise<OpenedView>;
      redo: () => Promise<OpenedView>;
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
      exportSrt: () => Promise<{ library: LibraryView }>;
      exportVtt: () => Promise<{ library: LibraryView }>;
      importProject: () => Promise<{ library: LibraryView }>;
      searchLibrary: (query: string) => Promise<readonly SearchHitView[]>;
      findInTranscript: (query: string) => Promise<readonly WordView[]>;
    };
  }
}

const RATES: readonly PlaybackRate[] = [1, 1.5, 2];

let library: LibraryView;
let opened: OpenedView | undefined;
let importLanguage: Language = "English";
let processing: ProcessingView | null = null;
let libraryQuery = "";
let libraryHits: readonly SearchHitView[] = [];
let transcriptQuery = "";
let selectedWordIds: string[] = [];

const NEW_SPEAKER = "__new__";

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

async function reprocessProject(): Promise<void> {
  const result = await window.describer.reprocessProject();
  library = result.library;
  opened = result.opened;
  render();
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

async function exportSrt(): Promise<void> {
  const result = await window.describer.exportSrt();
  library = result.library;
}

async function exportVtt(): Promise<void> {
  const result = await window.describer.exportVtt();
  library = result.library;
}

async function openProject(projectId: string): Promise<void> {
  opened = await window.describer.openProject(projectId);
  render();
  const media = mediaElement();
  if (media !== null) {
    media.playbackRate = opened.playback.rate;
    void media.play();
    highlightCurrentWord(media.currentTime);
    media.addEventListener("timeupdate", () => {
      highlightCurrentWord(media.currentTime);
    });
  }
}

async function openHit(hit: SearchHitView): Promise<void> {
  await openProject(hit.project.id);
  if (hit.word !== null) {
    await seekToWord(hit.word.id);
  }
}

async function searchLibrary(query: string): Promise<void> {
  libraryQuery = query;
  if (query.trim() === "") {
    libraryHits = [];
  } else {
    libraryHits = await window.describer.searchLibrary(query);
  }
  render();
  const search = document.querySelector(
    'input[aria-label="Search the Library"]',
  );
  if (search instanceof HTMLInputElement) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

async function findInTranscript(query: string): Promise<void> {
  transcriptQuery = query;
  if (opened === undefined || query.trim() === "") {
    return;
  }
  const found = await window.describer.findInTranscript(query);
  const first = found[0];
  if (first !== undefined) {
    await seekToWord(first.id);
  }
}

async function seekToWord(wordId: string): Promise<void> {
  if (opened === undefined) {
    return;
  }
  opened = await window.describer.seekToWord(wordId);
  const word = wordById(opened.transcript, wordId);
  const media = mediaElement();
  if (media !== null && word !== undefined) {
    media.currentTime = word.start;
  }
  highlightCurrentWord(word?.start ?? opened.playback.currentTime);
}

function allWords(transcript: TranscriptView): WordView[] {
  return transcript.utterances.flatMap((utterance) => [...utterance.words]);
}

function selectedWords(transcript: TranscriptView): WordView[] {
  const ids = new Set(selectedWordIds);
  return allWords(transcript).filter((word) => ids.has(word.id));
}

function nextWordId(
  transcript: TranscriptView,
  wordId: string,
): string | undefined {
  const words = allWords(transcript);
  const index = words.findIndex((entry) => entry.id === wordId);
  return words[index + 1]?.id;
}

function tokensFrom(raw: string): string[] {
  return raw.trim().split(/\s+/).filter((token) => token.length > 0);
}

let rendering = false;

async function flushWord(wordId: string, raw: string): Promise<boolean> {
  if (opened === undefined) {
    return false;
  }
  const existing = wordById(opened.transcript, wordId);
  if (existing === undefined) {
    return false;
  }
  const tokens = tokensFrom(raw);
  if (tokens.length === 0) {
    opened = await window.describer.deleteWord(wordId);
    return true;
  }
  const first = tokens[0];
  if (first === undefined) {
    return false;
  }
  const extras = tokens.slice(1);
  if (extras.length === 0 && first === existing.text) {
    return false;
  }
  opened = await window.describer.changeWordText(wordId, first);
  let neighborId = wordId;
  for (const extra of extras) {
    const result = await window.describer.insertWord(
      neighborId,
      extra,
      "after",
    );
    opened = result;
    neighborId = result.inserted.id;
  }
  return true;
}

async function flushActiveWord(): Promise<void> {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return;
  }
  if (active.dataset.wordId !== undefined) {
    await flushWord(active.dataset.wordId, active.textContent ?? "");
    return;
  }
  if (active.dataset.speakerId !== undefined) {
    await renameIfChanged(active.dataset.speakerId, active.textContent ?? "");
  }
}

async function renameIfChanged(
  speakerId: string,
  name: string,
): Promise<boolean> {
  if (opened === undefined) {
    return false;
  }
  const trimmed = name.trim();
  const speaker = opened.transcript.speakers.find(
    (entry) => entry.id === speakerId,
  );
  if (speaker === undefined || trimmed.length === 0 || speaker.name === trimmed) {
    return false;
  }
  opened = await window.describer.renameSpeaker(speakerId, trimmed);
  return true;
}

async function commitSpeakerName(
  speakerId: string,
  name: string,
): Promise<void> {
  if (rendering) {
    return;
  }
  if (await renameIfChanged(speakerId, name)) {
    render();
  }
}

async function undoTranscript(): Promise<void> {
  if (opened === undefined) {
    return;
  }
  await flushActiveWord();
  opened = await window.describer.undo();
  render();
}

async function redoTranscript(): Promise<void> {
  if (opened === undefined) {
    return;
  }
  await flushActiveWord();
  opened = await window.describer.redo();
  render();
}

async function commitWord(wordId: string, raw: string): Promise<void> {
  if (rendering) {
    return;
  }
  if (await flushWord(wordId, raw)) {
    render();
  }
}

async function breakParagraph(wordId: string, raw: string): Promise<void> {
  await flushWord(wordId, raw);
  if (opened === undefined) {
    return;
  }
  if (wordById(opened.transcript, wordId) !== undefined) {
    const nextId = nextWordId(opened.transcript, wordId);
    if (nextId !== undefined) {
      opened = await window.describer.insertParagraphBreak(nextId);
    }
  }
  render();
}

async function mergeInto(fromId: string, intoId: string): Promise<void> {
  if (opened === undefined || fromId === intoId) {
    return;
  }
  opened = await window.describer.mergeSpeakers(fromId, intoId);
  render();
}

async function reassignSelection(speakerId: string): Promise<void> {
  if (opened === undefined) {
    return;
  }
  const words = selectedWords(opened.transcript);
  if (words.length === 0) {
    return;
  }
  let speaker: SpeakerView | undefined;
  if (speakerId === NEW_SPEAKER) {
    const typed = window.prompt("Speaker name");
    if (typed === null) {
      return;
    }
    const name = typed.trim();
    if (name.length === 0) {
      return;
    }
    speaker = { id: crypto.randomUUID(), name };
  } else {
    speaker = opened.transcript.speakers.find((entry) => entry.id === speakerId);
  }
  if (speaker === undefined) {
    return;
  }
  opened = await window.describer.reassignWords(
    words.map((word) => word.id),
    speaker,
  );
  selectedWordIds = [];
  render();
}

function wordById(
  transcript: TranscriptView,
  wordId: string,
): WordView | undefined {
  for (const utterance of transcript.utterances) {
    const word = utterance.words.find((entry) => entry.id === wordId);
    if (word !== undefined) {
      return word;
    }
  }
  return undefined;
}

function wordAtTime(
  transcript: TranscriptView,
  time: number,
): WordView | undefined {
  for (const utterance of transcript.utterances) {
    const word = utterance.words.find(
      (entry) => entry.start <= time && time < entry.end,
    );
    if (word !== undefined) {
      return word;
    }
  }
  return undefined;
}

function highlightCurrentWord(time: number): void {
  if (opened === undefined) {
    return;
  }
  const current = wordAtTime(opened.transcript, time);
  for (const element of document.querySelectorAll(".word")) {
    const isCurrent = element.getAttribute("data-word-id") === current?.id;
    element.classList.toggle("current", isCurrent);
    if (isCurrent) {
      element.setAttribute("aria-current", "true");
    } else {
      element.removeAttribute("aria-current");
    }
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

  if (processing != null) {
    const status = document.createElement("p");
    status.className = "processing";
    status.textContent = `Processing… ${Math.round(processing.progress * 100)}%`;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      void window.describer.cancelProcessing();
    });
    const row = document.createElement("div");
    row.className = "processing-row";
    row.append(status, cancel);
    root.append(row);
  }

  const search = document.createElement("input");
  search.type = "search";
  search.value = libraryQuery;
  search.placeholder = "Search the Library";
  search.setAttribute("aria-label", "Search the Library");
  search.addEventListener("input", () => {
    void searchLibrary(search.value);
  });
  root.append(search);

  if (libraryQuery.trim() !== "") {
    if (libraryHits.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No matching Projects.";
      root.append(empty);
      return;
    }
    const list = document.createElement("ul");
    list.className = "projects";
    for (const hit of libraryHits) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project";
      if (opened?.project.id === hit.project.id) {
        button.classList.add("selected");
      }
      button.textContent =
        hit.word === null
          ? hit.project.title
          : `${hit.project.title} — ${hit.word.text}`;
      button.addEventListener("click", () => {
        void openHit(hit);
      });
      item.append(button);
      list.append(item);
    }
    root.append(list);
    return;
  }

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

  const exportSrtButton = document.createElement("button");
  exportSrtButton.type = "button";
  exportSrtButton.textContent = "Export SRT";
  exportSrtButton.addEventListener("click", () => {
    void exportSrt();
  });

  const exportVttButton = document.createElement("button");
  exportVttButton.type = "button";
  exportVttButton.textContent = "Export VTT";
  exportVttButton.addEventListener("click", () => {
    void exportVtt();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    void deleteProject();
  });

  const reprocessButton = document.createElement("button");
  reprocessButton.type = "button";
  reprocessButton.textContent = "Re-process";
  reprocessButton.disabled = !opened.transcript.editable;
  reprocessButton.addEventListener("click", () => {
    void reprocessProject();
  });

  actions.append(
    locateButton,
    exportButton,
    exportSrtButton,
    exportVttButton,
    reprocessButton,
    deleteButton,
  );
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

function renderTranscript(root: HTMLElement): void {
  if (opened === undefined) {
    return;
  }

  const pane = document.createElement("section");
  pane.className = "transcript";
  pane.setAttribute("aria-label", "Transcript");
  if (!opened.transcript.editable) {
    pane.setAttribute("aria-readonly", "true");
  }

  const find = document.createElement("input");
  find.type = "search";
  find.value = transcriptQuery;
  find.placeholder = "Find in Transcript";
  find.setAttribute("aria-label", "Find in Transcript");
  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void findInTranscript(find.value);
    }
  });
  find.addEventListener("change", () => {
    transcriptQuery = find.value;
  });
  pane.append(find);

  if (opened.transcript.editable) {
    const reassign = document.createElement("select");
    reassign.setAttribute("aria-label", "Reassign selected Words");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Reassign selection to…";
    reassign.append(placeholder);
    for (const speaker of opened.transcript.speakers) {
      const option = document.createElement("option");
      option.value = speaker.id;
      option.textContent = speaker.name;
      reassign.append(option);
    }
    const create = document.createElement("option");
    create.value = NEW_SPEAKER;
    create.textContent = "New Speaker…";
    reassign.append(create);
    reassign.addEventListener("change", () => {
      const speakerId = reassign.value;
      reassign.value = "";
      if (speakerId.length > 0) {
        void reassignSelection(speakerId);
      }
    });
    pane.append(reassign);
  }

  if (opened.transcript.utterances.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No Words.";
    pane.append(empty);
    root.append(pane);
    return;
  }

  for (const utterance of opened.transcript.utterances) {
    const block = document.createElement("article");
    block.className = "utterance";
    const heading = document.createElement("div");
    heading.className = "speaker-row";
    const speaker = document.createElement("span");
    speaker.className = "speaker";
    speaker.dataset.speakerId = utterance.speaker.id;
    speaker.textContent = utterance.speaker.name;
    if (opened.transcript.editable) {
      speaker.contentEditable = "true";
      speaker.spellcheck = false;
      speaker.addEventListener("blur", () => {
        void commitSpeakerName(
          utterance.speaker.id,
          speaker.textContent ?? "",
        );
      });
    }
    heading.append(speaker);
    if (
      opened.transcript.editable &&
      opened.transcript.speakers.length > 1
    ) {
      const merge = document.createElement("select");
      merge.setAttribute(
        "aria-label",
        `Merge ${utterance.speaker.name} into`,
      );
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Merge into…";
      merge.append(placeholder);
      for (const other of opened.transcript.speakers) {
        if (other.id === utterance.speaker.id) {
          continue;
        }
        const option = document.createElement("option");
        option.value = other.id;
        option.textContent = other.name;
        merge.append(option);
      }
      merge.addEventListener("change", () => {
        const intoId = merge.value;
        merge.value = "";
        if (intoId.length > 0) {
          void mergeInto(utterance.speaker.id, intoId);
        }
      });
      heading.append(merge);
    }
    const text = document.createElement("p");
    text.className = "utterance-text";
    for (const [index, word] of utterance.words.entries()) {
      if (index > 0) {
        text.append(" ");
      }
      const token = document.createElement("span");
      token.className = "word";
      token.dataset.wordId = word.id;
      token.textContent = word.text;
      if (opened.transcript.editable) {
        token.contentEditable = "true";
        token.spellcheck = false;
        token.addEventListener("blur", () => {
          void commitWord(word.id, token.textContent ?? "");
        });
        token.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void breakParagraph(word.id, token.textContent ?? "");
          }
        });
      }
      text.append(token);
    }
    block.append(heading, text);
    pane.append(block);
  }

  pane.addEventListener("mouseup", (event) => {
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) {
      selectedWordIds = [];
      for (const element of pane.querySelectorAll(".word")) {
        if (selection.containsNode(element, true)) {
          const wordId = element.getAttribute("data-word-id");
          if (wordId !== null) {
            selectedWordIds.push(wordId);
          }
        }
      }
      const first = selectedWordIds[0];
      if (first !== undefined) {
        void seekToWord(first);
      }
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.wordId !== undefined) {
      selectedWordIds = [target.dataset.wordId];
      void seekToWord(target.dataset.wordId);
    }
  });

  root.append(pane);
}

function render(): void {
  const root = document.getElementById("app");
  if (root === null) {
    return;
  }
  rendering = true;
  try {
    root.replaceChildren();
    renderLibraryList(root);
    if (opened === undefined) {
      return;
    }
    const editor = document.createElement("div");
    editor.className = "editor";
    editor.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key !== "z" && event.key !== "y") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === "y" || event.shiftKey) {
        void redoTranscript();
      } else {
        void undoTranscript();
      }
    });
    renderPlayer(editor);
    renderTranscript(editor);
    root.append(editor);
    highlightCurrentWord(opened.playback.currentTime);
  } finally {
    rendering = false;
  }
}

const started = await window.describer.open();
library = started.library;
importLanguage = library.lastUsedLanguage;
window.describer.onProcessing((next) => {
  processing = next;
  if (opened !== undefined) {
    void window.describer.getOpened().then((snapshot) => {
      if (snapshot !== null) {
        opened = snapshot;
      }
      render();
    });
    return;
  }
  render();
});
window.describer.onLibrary((next) => {
  library = next;
  importLanguage = library.lastUsedLanguage;
  render();
});
render();

export {};
