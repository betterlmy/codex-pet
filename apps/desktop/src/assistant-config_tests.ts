import assert from "node:assert/strict";
import test from "node:test";

import {
  chatCompletionsUrl,
  defaultAssistantSettings,
  normalizeStoredSettings,
  renderUserPrompt,
  validateAssistantSettings,
} from "./assistant-config";

test("默认翻译动作使用简体中文 Prompt 和独立快捷键", () => {
  const settings = defaultAssistantSettings();
  assert.equal(settings.actions.length, 1);
  assert.match(settings.actions[0].systemPrompt, /简体中文/);
  assert.equal(settings.actions[0].shortcut, "CommandOrControl+Shift+Space");
  assert.deepEqual(settings.proxy, { enabled: false, url: "" });
  assert.equal(settings.version, 2);
});

test("旧版配置迁移为默认关闭代理", () => {
  const current = defaultAssistantSettings();
  const migrated = normalizeStoredSettings({
    version: 1,
    baseUrl: current.baseUrl,
    model: current.model,
    actions: current.actions,
  });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.proxy, { enabled: false, url: "" });
});

test("远程 HTTP 地址被拒绝，本机 HTTP 地址被允许", () => {
  const settings = defaultAssistantSettings();
  assert.throws(
    () => validateAssistantSettings({ ...settings, baseUrl: "http://example.com/v1" }),
    /HTTPS/,
  );
  assert.equal(
    validateAssistantSettings({ ...settings, baseUrl: "http://localhost:11434/v1" }).baseUrl,
    "http://localhost:11434/v1",
  );
});

test("重复快捷键被拒绝", () => {
  const settings = defaultAssistantSettings();
  assert.throws(
    () =>
      validateAssistantSettings({
        ...settings,
        actions: [
          settings.actions[0],
          { ...settings.actions[0], id: "another-action", name: "另一个动作" },
        ],
      }),
    /快捷键重复/,
  );
});

test("Prompt 只替换 input 占位符", () => {
  assert.equal(renderUserPrompt("翻译：{{input}}", "hello"), "翻译：hello");
  assert.throws(() => renderUserPrompt("缺少占位符", "hello"), /必须包含/);
});

test("Chat Completions 地址只追加一次", () => {
  assert.equal(
    chatCompletionsUrl("https://api.example.com/v1"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("https://api.example.com/v1/chat/completions"),
    "https://api.example.com/v1/chat/completions",
  );
});
