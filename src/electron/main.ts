import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  openDescriber,
  type Describer,
  type Language,
  type OpenedProject,
  type PlaybackRate,
  type Speaker,
  type Word,
  type WordPlacement,
} from "../core/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let describer: Describer | undefined;
let opened: OpenedProject | undefined;
let window: BrowserWindow | undefined;

function requireDescriber(): Describer {
  if (describer === undefined) {
    throw new Error("Describer is not open");
  }
  return describer;
}

function openedSnapshot(): {
  project: OpenedProject["project"];
  hasPicture: boolean;
  playback: OpenedProject["playback"];
  sourceUrl: string | null;
  transcript: OpenedProject["transcript"];
  currentWord: OpenedProject["currentWord"] | null;
} {
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const sourcePresent = existsSync(opened.project.sourcePath);
  return {
    project: opened.project,
    hasPicture: opened.hasPicture,
    playback: opened.playback,
    sourceUrl: sourcePresent
      ? pathToFileURL(opened.project.sourcePath).href
      : null,
    transcript: opened.transcript,
    currentWord: opened.currentWord ?? null,
  };
}

ipcMain.handle("describer:open", async () => {
  describer = await openDescriber();
  opened = undefined;
  return { library: describer.library };
});

const SOURCE_EXTENSIONS = [
  "mp4",
  "webm",
  "mkv",
  "mov",
  "avi",
  "wav",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "opus",
];

function requireWindow(): BrowserWindow {
  if (window === undefined) {
    throw new Error("Window is not ready");
  }
  return window;
}

ipcMain.handle(
  "describer:importSource",
  async (_event, language: Language) => {
    const current = requireDescriber();
    const picked = await dialog.showOpenDialog(requireWindow(), {
      title: "Import a Source",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Source", extensions: SOURCE_EXTENSIONS }],
    });
    const sourcePaths = picked.filePaths;
    if (picked.canceled || sourcePaths.length === 0) {
      return { library: current.library };
    }
    const target = requireWindow();
    const sendProgress = (): void => {
      target.webContents.send("describer:processing", current.processing);
      target.webContents.send("describer:library", current.library);
    };
    const timer = setInterval(sendProgress, 100);
    sendProgress();
    try {
      await Promise.all(
        sourcePaths.map(async (sourcePath) => {
          try {
            await current.importSource(sourcePath, language);
          } catch {
            // Cancel or failure leaves no Project; the Library is returned as-is.
          }
        }),
      );
    } finally {
      clearInterval(timer);
      sendProgress();
    }
    return { library: current.library };
  },
);

ipcMain.handle("describer:cancelProcessing", () => {
  requireDescriber().cancelProcessing();
});

ipcMain.handle("describer:locateSource", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const picked = await dialog.showOpenDialog(requireWindow(), {
    title: "Locate Source",
    properties: ["openFile"],
    filters: [{ name: "Source", extensions: SOURCE_EXTENSIONS }],
  });
  const sourcePath = picked.filePaths[0];
  if (picked.canceled || sourcePath === undefined) {
    return { library: current.library, opened: openedSnapshot() };
  }
  await current.locateSource(opened.project.id, sourcePath);
  return { library: current.library, opened: openedSnapshot() };
});

ipcMain.handle("describer:getOpened", () => {
  if (opened === undefined) {
    return null;
  }
  return openedSnapshot();
});

ipcMain.handle("describer:reprocessProject", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const confirmed = await dialog.showMessageBox(requireWindow(), {
    type: "warning",
    title: "Re-process Project",
    message: "Replace this Transcript?",
    detail:
      "Edits and Speaker names from the old pass are gone. The Source is not changed. Duplicate the Project file first to keep the current Transcript.",
    buttons: ["Cancel", "Re-process"],
    defaultId: 0,
    cancelId: 0,
  });
  if (confirmed.response !== 1) {
    return {
      library: current.library,
      opened: openedSnapshot(),
      reprocessed: false,
    };
  }
  const projectId = opened.project.id;
  const target = requireWindow();
  const sendProgress = (): void => {
    target.webContents.send("describer:processing", current.processing);
    target.webContents.send("describer:library", current.library);
  };
  const timer = setInterval(sendProgress, 100);
  sendProgress();
  try {
    await current.reprocessProject(projectId, true);
  } catch {
    // Failure leaves the Project; the Transcript stays until a later pass.
  } finally {
    opened = current.openProject(projectId);
    clearInterval(timer);
    sendProgress();
  }
  return {
    library: current.library,
    opened: openedSnapshot(),
    reprocessed: true,
  };
});

ipcMain.handle("describer:deleteProject", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const confirmed = await dialog.showMessageBox(requireWindow(), {
    type: "warning",
    title: "Delete Project",
    message: "Delete this Project from the Library?",
    detail: "The Source file is not deleted.",
    buttons: ["Cancel", "Delete"],
    defaultId: 0,
    cancelId: 0,
  });
  if (confirmed.response !== 1) {
    return { library: current.library, deleted: false };
  }
  await current.deleteProject(opened.project.id);
  opened = undefined;
  return { library: current.library, deleted: true };
});

ipcMain.handle("describer:exportProject", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const picked = await dialog.showSaveDialog(requireWindow(), {
    title: "Export Project",
    defaultPath: `${opened.project.title}.json`,
    filters: [{ name: "Project", extensions: ["json"] }],
  });
  if (picked.canceled || picked.filePath === undefined) {
    return { library: current.library };
  }
  await current.exportProject(opened.project.id, picked.filePath);
  return { library: current.library };
});

ipcMain.handle("describer:exportSrt", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const picked = await dialog.showSaveDialog(requireWindow(), {
    title: "Export SRT",
    defaultPath: `${opened.project.title}.srt`,
    filters: [{ name: "SRT", extensions: ["srt"] }],
  });
  if (picked.canceled || picked.filePath === undefined) {
    return { library: current.library };
  }
  await current.exportSrt(opened.project.id, picked.filePath);
  return { library: current.library };
});

ipcMain.handle("describer:exportVtt", async () => {
  const current = requireDescriber();
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  const picked = await dialog.showSaveDialog(requireWindow(), {
    title: "Export VTT",
    defaultPath: `${opened.project.title}.vtt`,
    filters: [{ name: "VTT", extensions: ["vtt"] }],
  });
  if (picked.canceled || picked.filePath === undefined) {
    return { library: current.library };
  }
  await current.exportVtt(opened.project.id, picked.filePath);
  return { library: current.library };
});

ipcMain.handle("describer:importProject", async () => {
  const current = requireDescriber();
  const picked = await dialog.showOpenDialog(requireWindow(), {
    title: "Open Project file",
    properties: ["openFile"],
    filters: [{ name: "Project", extensions: ["json"] }],
  });
  const projectFilePath = picked.filePaths[0];
  if (picked.canceled || projectFilePath === undefined) {
    return { library: current.library };
  }
  await current.importProject(projectFilePath);
  return { library: current.library };
});

ipcMain.handle("describer:searchLibrary", (_event, query: string) => {
  return requireDescriber().searchLibrary(query).map((hit) => ({
    project: hit.project,
    word: hit.word ?? null,
  }));
});

ipcMain.handle("describer:findInTranscript", (_event, query: string) => {
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  return opened.findInTranscript(query);
});

function requireOpened(): OpenedProject {
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  return opened;
}

function wordById(openedProject: OpenedProject, wordId: string): Word {
  for (const utterance of openedProject.transcript.utterances) {
    const word = utterance.words.find((entry) => entry.id === wordId);
    if (word !== undefined) {
      return word;
    }
  }
  throw new Error(`Word not found: ${wordId}`);
}

function speakerById(openedProject: OpenedProject, speakerId: string): Speaker {
  const speaker = openedProject.transcript.speakers.find(
    (entry) => entry.id === speakerId,
  );
  if (speaker === undefined) {
    throw new Error(`Speaker not found: ${speakerId}`);
  }
  return speaker;
}

ipcMain.handle("describer:openProject", (_event, projectId: string) => {
  opened = requireDescriber().openProject(projectId);
  return openedSnapshot();
});

ipcMain.handle("describer:play", () => {
  if (opened === undefined) {
    return false;
  }
  return opened.play();
});

ipcMain.handle("describer:setRate", (_event, rate: PlaybackRate) => {
  if (opened === undefined) {
    throw new Error("No Project is open");
  }
  opened.setRate(rate);
  return opened.playback;
});

ipcMain.handle("describer:seekToWord", (_event, wordId: string) => {
  const current = requireOpened();
  current.seekToWord(wordById(current, wordId));
  return openedSnapshot();
});

ipcMain.handle(
  "describer:changeWordText",
  async (_event, wordId: string, text: string) => {
    const current = requireOpened();
    await current.changeWordText(wordById(current, wordId), text);
    return openedSnapshot();
  },
);

ipcMain.handle("describer:deleteWord", async (_event, wordId: string) => {
  const current = requireOpened();
  await current.deleteWord(wordById(current, wordId));
  return openedSnapshot();
});

ipcMain.handle(
  "describer:insertWord",
  async (
    _event,
    neighborId: string,
    text: string,
    placement: WordPlacement,
  ) => {
    const current = requireOpened();
    const inserted = await current.insertWord(
      wordById(current, neighborId),
      text,
      placement,
    );
    return { ...openedSnapshot(), inserted };
  },
);

ipcMain.handle(
  "describer:insertParagraphBreak",
  async (_event, wordId: string) => {
    const current = requireOpened();
    await current.insertParagraphBreak(wordById(current, wordId));
    return openedSnapshot();
  },
);

ipcMain.handle(
  "describer:renameSpeaker",
  async (_event, speakerId: string, name: string) => {
    const current = requireOpened();
    await current.renameSpeaker(speakerById(current, speakerId), name);
    return openedSnapshot();
  },
);

ipcMain.handle(
  "describer:mergeSpeakers",
  async (_event, fromId: string, intoId: string) => {
    const current = requireOpened();
    await current.mergeSpeakers(
      speakerById(current, fromId),
      speakerById(current, intoId),
    );
    return openedSnapshot();
  },
);

ipcMain.handle(
  "describer:reassignWords",
  async (_event, wordIds: readonly string[], speaker: Speaker) => {
    const current = requireOpened();
    await current.reassignWords(
      wordIds.map((wordId) => wordById(current, wordId)),
      speaker,
    );
    return openedSnapshot();
  },
);

ipcMain.handle("describer:undo", async () => {
  await requireOpened().undo();
  return openedSnapshot();
});

ipcMain.handle("describer:redo", async () => {
  await requireOpened().redo();
  return openedSnapshot();
});

ipcMain.handle(
  "describer:updateProject",
  async (
    _event,
    projectId: string,
    patch: {
      readonly title?: string;
      readonly recordedAt?: string;
      readonly language?: Language;
    },
  ) => {
    const current = requireDescriber();
    const project = await current.updateProject(projectId, {
      title: patch.title,
      recordedAt:
        patch.recordedAt === undefined ? undefined : new Date(patch.recordedAt),
      language: patch.language,
    });
    return { project, library: current.library };
  },
);

function createWindow(): void {
  window = new BrowserWindow({
    width: 1024,
    height: 768,
    title: "Describer",
    webPreferences: {
      preload: path.join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void window.loadFile(path.join(here, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
