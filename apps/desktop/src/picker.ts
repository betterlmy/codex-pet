import type { PetDefinition, PetPickerState, PetSummary } from "./types";

const list = document.querySelector<HTMLDivElement>("#pet-list");
const title = document.querySelector<HTMLHeadingElement>("#preview-title");
const description = document.querySelector<HTMLParagraphElement>("#preview-description");
const sprite = document.querySelector<HTMLDivElement>("#preview-sprite");
const status = document.querySelector<HTMLParagraphElement>("#preview-status");
const confirm = document.querySelector<HTMLButtonElement>("#confirm");

let state: PetPickerState;
let selected: PetSummary | null = null;
let loadRevision = 0;

function required<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`缺少界面元素：${name}`);
  return value;
}

const petList = required(list, "pet-list");
const previewTitle = required(title, "preview-title");
const previewDescription = required(description, "preview-description");
const previewSprite = required(sprite, "preview-sprite");
const previewStatus = required(status, "preview-status");
const confirmButton = required(confirm, "confirm");

function showFrame(pet: PetDefinition): void {
  const frame = pet.animations.idle?.frames[0] ?? Object.values(pet.animations)[0]?.frames[0];
  if (!frame) throw new Error("宠物没有可预览的动画帧");
  const column = frame.spriteIndex % pet.columns;
  const row = Math.floor(frame.spriteIndex / pet.columns);
  previewSprite.style.backgroundImage = `url("${pet.spritesheetPath}")`;
  previewSprite.style.backgroundSize = `${pet.columns * 100}% ${pet.rows * 100}%`;
  previewSprite.style.backgroundPosition = `${pet.columns > 1 ? (column / (pet.columns - 1)) * 100 : 0}% ${pet.rows > 1 ? (row / (pet.rows - 1)) * 100 : 0}%`;
}

async function choose(pet: PetSummary): Promise<void> {
  selected = pet;
  const revision = ++loadRevision;
  petList.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.petId === pet.id);
  });
  previewTitle.textContent = pet.displayName;
  previewDescription.textContent = pet.description;
  confirmButton.disabled = false;
  previewSprite.style.backgroundImage = "none";
  if (pet.id === "disabled") {
    previewStatus.textContent = "选择后隐藏桌面宠物，状态栏入口仍会保留。";
    previewSprite.textContent = "已禁用";
    return;
  }
  previewSprite.textContent = "";
  previewStatus.textContent = pet.builtin ? "正在准备内置宠物预览…" : "正在加载自定义宠物预览…";
  try {
    const definition = await window.petPicker.preview(pet.id);
    if (revision !== loadRevision) return;
    showFrame(definition);
    previewStatus.textContent = `${definition.frameCount} 帧 · ${definition.frameWidth}×${definition.frameHeight}`;
  } catch (error) {
    if (revision !== loadRevision) return;
    previewStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

function render(): void {
  petList.replaceChildren();
  for (const pet of state.catalog) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.petId = pet.id;
    const name = document.createElement("strong");
    name.textContent = pet.displayName;
    const detail = document.createElement("span");
    detail.textContent = pet.description;
    button.append(name, detail);
    button.addEventListener("click", () => void choose(pet));
    petList.append(button);
  }
  const selectedId = state.enabled ? state.selectedPetId : "disabled";
  const initial = state.catalog.find((pet) => pet.id === selectedId) ?? state.catalog[0];
  if (initial) void choose(initial);
}

confirmButton.addEventListener("click", async () => {
  if (!selected) return;
  confirmButton.disabled = true;
  previewStatus.textContent = "正在应用…";
  try {
    await window.petPicker.select(selected.id);
  } catch (error) {
    previewStatus.textContent = error instanceof Error ? error.message : String(error);
    confirmButton.disabled = false;
  }
});

void window.petPicker.get().then((value) => {
  state = value;
  render();
});
