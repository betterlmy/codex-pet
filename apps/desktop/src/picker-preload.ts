import { contextBridge, ipcRenderer } from "electron";

import type { PetDefinition, PetPickerState } from "./types";

contextBridge.exposeInMainWorld("petPicker", {
  get(): Promise<PetPickerState> {
    return ipcRenderer.invoke("pet:picker:get") as Promise<PetPickerState>;
  },
  preview(petId: string): Promise<PetDefinition> {
    return ipcRenderer.invoke("pet:picker:preview", petId) as Promise<PetDefinition>;
  },
  select(petId: string): Promise<void> {
    return ipcRenderer.invoke("pet:picker:select", petId) as Promise<void>;
  },
});
