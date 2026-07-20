import { contextBridge, ipcRenderer } from "electron";

import { formatShortcut } from "./shortcut-display";
import type { DesktopSettingsUpdate, DesktopSettingsView } from "./types";

contextBridge.exposeInMainWorld("assistantSettings", {
  formatShortcut(accelerator: string): string {
    return formatShortcut(accelerator, process.platform);
  },
  get(): Promise<DesktopSettingsView> {
    return ipcRenderer.invoke("assistant:settings:get");
  },
  save(update: DesktopSettingsUpdate): Promise<DesktopSettingsView> {
    return ipcRenderer.invoke("assistant:settings:save", update);
  },
  test(): Promise<string> {
    return ipcRenderer.invoke("assistant:settings:test");
  },
});
