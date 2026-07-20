import type {
  AssistantBubbleEvent,
  AssistantSettingsUpdate,
  AssistantSettingsView,
  PetCommand,
  PetDefinition,
  PetPickerState,
  RuntimeEvent,
  ShellState,
} from "./types";

declare global {
  interface Window {
    codexPet: {
      ready(): void;
      rendered(revision: number): void;
      command(command: PetCommand): void;
      setClickThrough(enabled: boolean): void;
      hide(): void;
      onEvent(listener: (event: RuntimeEvent) => void): () => void;
      onShellState(listener: (state: ShellState) => void): () => void;
    };
    assistantBubble: {
      ready(): void;
      copy(): Promise<void>;
      retry(): Promise<void>;
      close(): Promise<void>;
      onEvent(listener: (event: AssistantBubbleEvent) => void): () => void;
    };
    assistantSettings: {
      formatShortcut(accelerator: string): string;
      get(): Promise<AssistantSettingsView>;
      save(update: AssistantSettingsUpdate): Promise<AssistantSettingsView>;
      test(): Promise<string>;
    };
    petPicker: {
      get(): Promise<PetPickerState>;
      preview(petId: string): Promise<PetDefinition>;
      select(petId: string): Promise<void>;
    };
  }
}

export {};
