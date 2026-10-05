import { contextBridge, ipcRenderer } from "electron";
import type {
  Language,
  Library,
  Playback,
  PlaybackRate,
  Processing,
  Project,
  Transcript,
  Word,
} from "../core/index.js";

export type SearchHitView = {
  readonly project: Project;
  readonly word: Word | null;
};

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
  cancelProcessing: (): Promise<void> =>
    ipcRenderer.invoke("describer:cancelProcessing"),
  onProcessing: (listener: (processing: Processing | null) => void): (() => void) => {
    const handler = (_event: unknown, processing: Processing | null): void => {
      listener(processing);
    };
    ipcRenderer.on("describer:processing", handler);
    return () => {
      ipcRenderer.removeListener("describer:processing", handler);
    };
  },
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
  exportSrt: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:exportSrt"),
  exportVtt: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:exportVtt"),
  importProject: (): Promise<{ library: Library }> =>
    ipcRenderer.invoke("describer:importProject"),
  searchLibrary: (query: string): Promise<readonly SearchHitView[]> =>
    ipcRenderer.invoke("describer:searchLibrary", query),
  findInTranscript: (query: string): Promise<readonly Word[]> =>
    ipcRenderer.invoke("describer:findInTranscript", query),
});
