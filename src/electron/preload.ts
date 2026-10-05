import { contextBridge, ipcRenderer } from "electron";
import type {
  Language,
  Library,
  Playback,
  PlaybackRate,
  Processing,
  Project,
  Speaker,
  Transcript,
  Word,
  WordPlacement,
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

export type InsertedWordView = OpenedView & {
  readonly inserted: Word;
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
  changeWordText: (wordId: string, text: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:changeWordText", wordId, text),
  deleteWord: (wordId: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:deleteWord", wordId),
  insertWord: (
    neighborId: string,
    text: string,
    placement: WordPlacement,
  ): Promise<InsertedWordView> =>
    ipcRenderer.invoke("describer:insertWord", neighborId, text, placement),
  insertParagraphBreak: (wordId: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:insertParagraphBreak", wordId),
  renameSpeaker: (speakerId: string, name: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:renameSpeaker", speakerId, name),
  mergeSpeakers: (fromId: string, intoId: string): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:mergeSpeakers", fromId, intoId),
  reassignWords: (
    wordIds: readonly string[],
    speaker: Speaker,
  ): Promise<OpenedView> =>
    ipcRenderer.invoke("describer:reassignWords", wordIds, speaker),
  undo: (): Promise<OpenedView> => ipcRenderer.invoke("describer:undo"),
  redo: (): Promise<OpenedView> => ipcRenderer.invoke("describer:redo"),
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
