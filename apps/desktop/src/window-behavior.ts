import type { PetAppearanceSettings } from "./types";

export const DEFAULT_HOVER_OPACITY = 0.35;

export interface WindowBehaviorSettings extends PetAppearanceSettings {
  clickThrough: boolean;
}

export function normalizeWindowBehavior(value: unknown): WindowBehaviorSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const hoverOpacity =
    typeof candidate.hoverOpacity === "number" && Number.isFinite(candidate.hoverOpacity)
      ? Math.min(0.9, Math.max(0.1, candidate.hoverOpacity))
      : DEFAULT_HOVER_OPACITY;
  const hoverFadeEnabled = candidate.hoverFadeEnabled === true;
  return {
    clickThrough: candidate.clickThrough === true && !hoverFadeEnabled,
    hoverFadeEnabled,
    hoverOpacity,
  };
}

export function applyAppearance(
  current: WindowBehaviorSettings,
  appearance: PetAppearanceSettings,
): WindowBehaviorSettings {
  const normalized = normalizeWindowBehavior({ ...current, ...appearance });
  return {
    ...normalized,
    clickThrough: normalized.hoverFadeEnabled ? false : current.clickThrough,
  };
}

export function applyClickThrough(
  current: WindowBehaviorSettings,
  clickThrough: boolean,
): WindowBehaviorSettings {
  return {
    ...current,
    clickThrough,
    hoverFadeEnabled: clickThrough ? false : current.hoverFadeEnabled,
  };
}
