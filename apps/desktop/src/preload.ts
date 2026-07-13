import { contextBridge, ipcRenderer } from "electron";

import type { PetCommand, RuntimeEvent, ShellState } from "./types";

contextBridge.exposeInMainWorld("codexPet", {
  ready(): void {
    ipcRenderer.send("pet:rendererReady");
  },
  rendered(revision: number): void {
    ipcRenderer.send("pet:rendered", revision);
  },
  command(command: PetCommand): void {
    ipcRenderer.send("pet:command", command);
  },
  setClickThrough(enabled: boolean): void {
    ipcRenderer.send("pet:setClickThrough", enabled);
  },
  hide(): void {
    ipcRenderer.send("pet:hide");
  },
  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RuntimeEvent) => listener(value);
    ipcRenderer.on("pet:event", wrapped);
    return () => ipcRenderer.removeListener("pet:event", wrapped);
  },
  onShellState(listener: (state: ShellState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ShellState) => listener(value);
    ipcRenderer.on("pet:shellState", wrapped);
    return () => ipcRenderer.removeListener("pet:shellState", wrapped);
  },
});
