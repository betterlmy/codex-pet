import assert from "node:assert/strict";
import test from "node:test";

import { formatShortcut } from "./shortcut-display";

test("macOS 快捷键使用系统符号", () => {
  assert.equal(formatShortcut("CommandOrControl+Shift+Space", "darwin"), "⌘ ⇧ Space");
  assert.equal(formatShortcut("CommandOrControl+Alt+P", "darwin"), "⌘ ⌥ P");
});

test("Windows 和 Linux 快捷键使用文字组合", () => {
  assert.equal(formatShortcut("CommandOrControl+Shift+Space", "win32"), "Ctrl + Shift + Space");
  assert.equal(formatShortcut("CommandOrControl+Alt+P", "linux"), "Ctrl + Alt + P");
});
