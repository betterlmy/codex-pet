import type { PetCommand, RuntimeEvent, ShellState } from "./types";

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
  }
}

export {};
