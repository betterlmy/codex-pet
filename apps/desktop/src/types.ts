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
  | {
      type: "selectionCaptured";
      requestId: number;
      text: string;
      method: SelectionMethod;
    }
  | { type: "selectionFailed"; requestId: number; message: string }
  | { type: "bye" };

export type PetCommand =
  | { type: "hello" }
  | { type: "selectPet"; petId: string }
  | { type: "setBehaviorMode"; mode: BehaviorMode }
  | { type: "setState"; state: BehaviorState }
  | { type: "setPaused"; paused: boolean }
  | { type: "advance" }
  | { type: "captureSelection"; requestId: number }
  | { type: "setProxy"; proxyUrl: string | null }
  | { type: "shutdown" };

export interface ShellState {
  clickThrough: boolean;
  visible: boolean;
}

export type SelectionMethod = "uiAutomation" | "clipboardCopy" | "primarySelection";

export interface PromptAction {
  id: string;
  name: string;
  systemPrompt: string;
  userPrompt: string;
  shortcut: string;
  autoCopy: boolean;
}

export interface ProxySettings {
  enabled: boolean;
  url: string;
}

export interface AssistantSettings {
  version: 2;
  baseUrl: string;
  model: string;
  proxy: ProxySettings;
  actions: PromptAction[];
}

export interface ShortcutRegistration {
  actionId: string;
  registered: boolean;
  error?: string;
}

export interface AssistantSettingsView extends AssistantSettings {
  hasApiKey: boolean;
  hasProxyPassword: boolean;
  encryptionAvailable: boolean;
  shortcutRegistrations: ShortcutRegistration[];
}

export interface AssistantSettingsUpdate {
  baseUrl: string;
  model: string;
  proxy: ProxySettings;
  actions: PromptAction[];
  apiKey?: string;
  clearApiKey?: boolean;
}

export type AssistantBubbleEvent =
  | {
      type: "capturing";
      requestId: number;
      actionName: string;
    }
  | {
      type: "streaming";
      requestId: number;
      actionName: string;
      selectionMethod: SelectionMethod;
    }
  | { type: "delta"; requestId: number; delta: string }
  | {
      type: "complete";
      requestId: number;
      result: string;
      autoCopied: boolean;
    }
  | { type: "error"; requestId: number | null; message: string };
