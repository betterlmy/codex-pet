export type BehaviorMode = "automatic" | "manual";
export type BehaviorState =
  | "idle"
  | "move-right"
  | "wave"
  | "bounce"
  | "move-left"
  | "rest";

export interface AnimationFrame {
  spriteIndex: number;
  durationMs: number;
}

export interface Animation {
  frames: AnimationFrame[];
  loopStart: number | null;
  fallback: string;
}

export interface PetDefinition {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  animations: Record<string, Animation>;
}

export interface PetSummary {
  id: string;
  displayName: string;
  description: string;
  builtin: boolean;
}

export interface RuntimeSnapshot {
  revision: number;
  pet: PetDefinition;
  behaviorMode: BehaviorMode;
  state: BehaviorState;
  stateLabel: string;
  animation: string;
  paused: boolean;
}

export type RuntimeEvent =
  | {
      type: "ready";
      home: string;
      catalog: PetSummary[];
      snapshot: RuntimeSnapshot | null;
    }
  | { type: "snapshot"; snapshot: RuntimeSnapshot }
  | { type: "error"; message: string }
  | { type: "bye" };

export type PetCommand =
  | { type: "hello" }
  | { type: "selectPet"; petId: string }
  | { type: "setBehaviorMode"; mode: BehaviorMode }
  | { type: "setState"; state: BehaviorState }
  | { type: "setPaused"; paused: boolean }
  | { type: "advance" }
  | { type: "shutdown" };

export interface ShellState {
  clickThrough: boolean;
  visible: boolean;
}

