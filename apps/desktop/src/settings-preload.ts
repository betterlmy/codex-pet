import { contextBridge, ipcRenderer } from "electron";

import type { AssistantSettingsUpdate, AssistantSettingsView } from "./types";

contextBridge.exposeInMainWorld("assistantSettings", {
  get(): Promise<AssistantSettingsView> {
    return ipcRenderer.invoke("assistant:settings:get");
  },
  save(update: AssistantSettingsUpdate): Promise<AssistantSettingsView> {
    return ipcRenderer.invoke("assistant:settings:save", update);
  },
  test(): Promise<string> {
    return ipcRenderer.invoke("assistant:settings:test");
  },
});
