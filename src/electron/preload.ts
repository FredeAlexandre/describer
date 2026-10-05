import { contextBridge, ipcRenderer } from "electron";
import type { Describer } from "../core/index.js";

contextBridge.exposeInMainWorld("describer", {
  open: (): Promise<Describer> => ipcRenderer.invoke("describer:open"),
});
