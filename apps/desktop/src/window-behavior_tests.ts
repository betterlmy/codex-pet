import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_HOVER_OPACITY,
  applyAppearance,
  applyClickThrough,
  normalizeWindowBehavior,
} from "./window-behavior";

test("旧窗口配置迁移为默认关闭悬停半隐藏", () => {
  assert.deepEqual(normalizeWindowBehavior({ clickThrough: false }), {
    clickThrough: false,
    hoverFadeEnabled: false,
    hoverOpacity: DEFAULT_HOVER_OPACITY,
  });
});

test("悬停透明度限制在百分之十到九十", () => {
  assert.equal(normalizeWindowBehavior({ hoverOpacity: 0 }).hoverOpacity, 0.1);
  assert.equal(normalizeWindowBehavior({ hoverOpacity: 1 }).hoverOpacity, 0.9);
});

test("悬停半隐藏和点击穿透保持互斥", () => {
  const initial = normalizeWindowBehavior({ clickThrough: true });
  const hoverEnabled = applyAppearance(initial, { hoverFadeEnabled: true, hoverOpacity: 0.4 });
  assert.equal(hoverEnabled.clickThrough, false);
  assert.equal(hoverEnabled.hoverFadeEnabled, true);
  const clickThroughEnabled = applyClickThrough(hoverEnabled, true);
  assert.equal(clickThroughEnabled.clickThrough, true);
  assert.equal(clickThroughEnabled.hoverFadeEnabled, false);
});
