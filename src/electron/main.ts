import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDescriber } from "../core/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

ipcMain.handle("describer:open", () => openDescriber());

function createWindow(): void {
  const window = new BrowserWindow({
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
