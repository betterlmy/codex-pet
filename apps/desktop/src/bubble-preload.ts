import { contextBridge, ipcRenderer } from "electron";

import type { AssistantBubbleEvent } from "./types";

contextBridge.exposeInMainWorld("assistantBubble", {
  ready(): void {
    ipcRenderer.send("assistant:bubble:ready");
  },
  copy(): Promise<void> {
    return ipcRenderer.invoke("assistant:bubble:copy");
  },
  retry(): Promise<void> {
    return ipcRenderer.invoke("assistant:bubble:retry");
  },
  close(): Promise<void> {
    return ipcRenderer.invoke("assistant:bubble:close");
  },
  onEvent(listener: (event: AssistantBubbleEvent) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: AssistantBubbleEvent) => listener(value);
    ipcRenderer.on("assistant:bubble:event", wrapped);
    return () => ipcRenderer.removeListener("assistant:bubble:event", wrapped);
  },
});
