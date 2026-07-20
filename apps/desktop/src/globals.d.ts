import type {
  AssistantBubbleEvent,
  DesktopSettingsUpdate,
  DesktopSettingsView,
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
      setHovering(hovering: boolean): void;
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
      get(): Promise<DesktopSettingsView>;
      save(update: DesktopSettingsUpdate): Promise<DesktopSettingsView>;
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
