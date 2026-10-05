import { contextBridge, ipcRenderer } from "electron";
import type {
  Language,
  Library,
  Playback,
  PlaybackRate,
  Project,
  Transcript,
  Word,
} from "../core/index.js";

export type OpenedView = {
  readonly project: Project;
  readonly hasPicture: boolean;
  readonly playback: Playback;
  readonly sourceUrl: string | null;
  readonly transcript: Transcript;
  readonly currentWord: Word | null;
};

contextBridge.exposeInMainWorld("describer", {
  open: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:open"),
  importSource: (language: Language): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:importSource", language),
  openProject: (projectId: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:openProject", projectId),
  play: (): Promise<boolean> => ipcRenderer.invoke("describer:play"),
  setRate: (rate: PlaybackRate): Promise<Playback> =>
    ipcRenderer.invoke("describer:setRate", rate),
  seekToWord: (wordId: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:seekToWord", wordId),
  updateProject: (
    projectId: string,
    patch: {
      readonly title?: string;
      readonly recordedAt?: string;
      readonly language?: Language;
    },
  ): Promise<{ project: Project; library: Library }> =>
    ipcRenderer.invoke("describer:updateProject", projectId, patch),
  locateSource: (): Promise<{ library: Library; opened: OpenedView }> =>
    ipcRenderer.invoke("describer:locateSource"),
  deleteProject: (): Promise<{ library: Library; deleted: boolean }> =>
    ipcRenderer.invoke("describer:deleteProject"),
  exportProject: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:exportProject"),
  importProject: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:importProject"),
});
