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
  };
}

ipcMain.handle("describer:open", async () => {
  describer = await openDescriber();
  opened = undefined;
  return { library: describer.library };
});

ipcMain.handle(
  "describer:importSource",
  async (_event, language: Language) => {
    const current = requireDescriber();
    if (window === undefined) {
      throw new Error("Window is not ready");
    }
    const picked = await dialog.showOpenDialog(window, {
      title: "Import a Source",
      properties: ["openFile"],
      filters: [
        {
          name: "Source",
          extensions: [
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
          ],
        },
      ],
    });
    const sourcePath = picked.filePaths[0];
    if (picked.canceled || sourcePath === undefined) {
      return { library: current.library };
    }
    const target = window;
    const sendProgress = (): void => {
      target.webContents.send("describer:processing", current.processing);
    };
    const timer = setInterval(sendProgress, 100);
    sendProgress();
    try {
      await current.importSource(sourcePath, language);
    } catch {
      // Cancel or failure leaves no Project; the Library is returned as-is.
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
