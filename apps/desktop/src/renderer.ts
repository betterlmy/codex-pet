type BehaviorMode = "automatic" | "manual";

interface PetAnimation {
  frames: Array<{ spriteIndex: number; durationMs: number }>;
  loopStart: number | null;
  fallback: string;
}

interface RendererSnapshot {
  revision: number;
  pet: {
    id: string;
    displayName: string;
    spritesheetPath: string;
    frameWidth: number;
    frameHeight: number;
    columns: number;
    rows: number;
    animations: Record<string, PetAnimation>;
  };
  behaviorMode: BehaviorMode;
  stateLabel: string;
  animation: string;
  paused: boolean;
}

type RendererRuntimeEvent =
  | { type: "ready"; snapshot: RendererSnapshot | null }
  | { type: "snapshot"; snapshot: RendererSnapshot }
  | { type: "error"; message: string }
  | { type: "selectionCaptured"; requestId: number; text: string; method: string }
  | { type: "selectionFailed"; requestId: number; message: string }
  | { type: "bye" };

interface RendererShellState {
  clickThrough: boolean;
  visible: boolean;
}

const sprite = requiredElement<HTMLDivElement>("sprite");
const petName = requiredElement<HTMLSpanElement>("pet-name");
const stateLabel = requiredElement<HTMLSpanElement>("state-label");
const modeButton = requiredElement<HTMLButtonElement>("mode-button");
const pauseButton = requiredElement<HTMLButtonElement>("pause-button");
const nextButton = requiredElement<HTMLButtonElement>("next-button");
const passButton = requiredElement<HTMLButtonElement>("pass-button");
const hideButton = requiredElement<HTMLButtonElement>("hide-button");
const errorPanel = requiredElement<HTMLDivElement>("error-panel");

let snapshot: RendererSnapshot | null = null;
let animationStartedAt = performance.now();
let animationFrame = 0;
let shellState: RendererShellState = { clickThrough: false, visible: true };

window.codexPet.onEvent(handleEvent);
window.codexPet.onShellState((state) => {
  shellState = state;
  passButton.dataset.active = String(state.clickThrough);
});

modeButton.addEventListener("click", () => {
  const nextMode: BehaviorMode = snapshot?.behaviorMode === "automatic" ? "manual" : "automatic";
  window.codexPet.command({ type: "setBehaviorMode", mode: nextMode });
});
pauseButton.addEventListener("click", () => {
  window.codexPet.command({ type: "setPaused", paused: !(snapshot?.paused ?? false) });
});
nextButton.addEventListener("click", () => window.codexPet.command({ type: "advance" }));
passButton.addEventListener("click", () => window.codexPet.setClickThrough(!shellState.clickThrough));
hideButton.addEventListener("click", () => window.codexPet.hide());

window.codexPet.ready();
animationFrame = requestAnimationFrame(render);

function handleEvent(event: RendererRuntimeEvent): void {
  if (event.type === "ready") {
    if (event.snapshot) applySnapshot(event.snapshot);
    else showError("宠物资源尚未就绪。请检查网络连接和托盘菜单。");
    return;
  }
  if (event.type === "snapshot") {
    applySnapshot(event.snapshot);
    return;
  }
  if (event.type === "error") {
    showError(event.message);
  }
}

function applySnapshot(value: RendererSnapshot): void {
  snapshot = value;
  animationStartedAt = performance.now();
  errorPanel.hidden = true;
  sprite.classList.remove("is-missing");
  sprite.style.backgroundImage = `url("${value.pet.spritesheetPath.replaceAll('"', "%22")}")`;
  const scale = 0.92;
  sprite.style.width = `${value.pet.frameWidth * scale}px`;
  sprite.style.height = `${value.pet.frameHeight * scale}px`;
  sprite.style.backgroundSize = `${value.pet.frameWidth * value.pet.columns * scale}px ${value.pet.frameHeight * value.pet.rows * scale}px`;
  petName.textContent = value.pet.displayName;
  stateLabel.textContent = value.paused ? "已暂停" : value.stateLabel;
  modeButton.textContent = value.behaviorMode === "automatic" ? "AUTO" : "HOLD";
  modeButton.dataset.active = String(value.behaviorMode === "automatic");
  pauseButton.textContent = value.paused ? "PLAY" : "PAUSE";
  pauseButton.dataset.active = String(value.paused);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.codexPet.rendered(value.revision));
  });
}

function render(now: number): void {
  if (snapshot) {
    const elapsed = snapshot.paused ? 0 : now - animationStartedAt;
    const index = frameAt(snapshot.pet.animations, snapshot.animation, elapsed);
    const scale = 0.92;
    const column = index % snapshot.pet.columns;
    const row = Math.floor(index / snapshot.pet.columns);
    sprite.style.backgroundPosition = `${-column * snapshot.pet.frameWidth * scale}px ${-row * snapshot.pet.frameHeight * scale}px`;
  }
  animationFrame = requestAnimationFrame(render);
}

function frameAt(
  animations: Record<string, PetAnimation>,
  requestedName: string,
  elapsedMs: number,
): number {
  let name = requestedName;
  let remainingElapsed = Math.max(0, elapsedMs);
  for (let depth = 0; depth < 8; depth += 1) {
    const animation = animations[name] ?? animations.idle;
    if (!animation || animation.frames.length === 0) return 0;
    const total = animation.frames.reduce((sum, frame) => sum + Math.max(1, frame.durationMs), 0);
    if (animation.loopStart === null && remainingElapsed >= total) {
      remainingElapsed -= total;
      name = animation.fallback;
      continue;
    }
    let effective = remainingElapsed;
    if (animation.loopStart !== null && animation.loopStart < animation.frames.length) {
      const prefix = animation.frames
        .slice(0, animation.loopStart)
        .reduce((sum, frame) => sum + Math.max(1, frame.durationMs), 0);
      const loop = total - prefix;
      if (effective >= total && loop > 0) effective = prefix + ((effective - prefix) % loop);
    }
    for (const frame of animation.frames) {
      const duration = Math.max(1, frame.durationMs);
      if (effective < duration) return frame.spriteIndex;
      effective -= duration;
    }
    return animation.frames.at(-1)?.spriteIndex ?? 0;
  }
  return 0;
}

function showError(message: string): void {
  errorPanel.textContent = message;
  errorPanel.hidden = false;
  sprite.classList.add("is-missing");
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素 #${id}`);
  return element as T;
}

window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));
