import { BrowserWindow, clipboard, globalShortcut } from "electron";

import {
  MAX_SELECTION_CHARS,
  isLocalModelUrl,
  validateAssistantSettings,
} from "./assistant-config";
import { AssistantStore } from "./assistant-store";
import { ApplicationProxy } from "./application-proxy";
import { streamChatCompletion } from "./openai-client";
import { parseProxyUrl } from "./proxy-config";
import type {
  AssistantBubbleEvent,
  AssistantSettings,
  AssistantSettingsUpdate,
  AssistantSettingsView,
  PetCommand,
  PetNotificationKind,
  PromptAction,
  RuntimeEvent,
  SelectionMethod,
  ShortcutRegistration,
} from "./types";

interface ControllerOptions {
  store: AssistantStore;
  proxy: ApplicationProxy;
  sendRuntimeCommand(command: PetCommand): boolean;
  showBubble(): BrowserWindow | null;
  hideBubble(): void;
  onSettingsChanged(): void;
}

interface PendingSelection {
  requestId: number;
  actionId: string;
}

interface ActiveRequest {
  requestId: number;
  controller: AbortController;
  timeout: NodeJS.Timeout;
}

interface LastRequest {
  actionId: string;
  input: string;
  result: string;
  selectionMethod: SelectionMethod;
}

export class AssistantController {
  readonly #store: AssistantStore;
  readonly #proxy: ApplicationProxy;
  readonly #sendRuntimeCommand: ControllerOptions["sendRuntimeCommand"];
  readonly #showBubble: ControllerOptions["showBubble"];
  readonly #hideBubble: ControllerOptions["hideBubble"];
  readonly #onSettingsChanged: ControllerOptions["onSettingsChanged"];
  #settings: AssistantSettings;
  #shortcutRegistrations: ShortcutRegistration[] = [];
  #requestSequence = 0;
  #pendingSelection: PendingSelection | null = null;
  #activeRequest: ActiveRequest | null = null;
  #lastRequest: LastRequest | null = null;
  #lastBubbleEvent: AssistantBubbleEvent | null = null;
  #shortcutsSuspended = false;

  constructor(options: ControllerOptions) {
    this.#store = options.store;
    this.#proxy = options.proxy;
    this.#sendRuntimeCommand = options.sendRuntimeCommand;
    this.#showBubble = options.showBubble;
    this.#hideBubble = options.hideBubble;
    this.#onSettingsChanged = options.onSettingsChanged;
    this.#settings = this.#store.loadSettings();
    this.#shortcutRegistrations = this.#registerActions(this.#settings.actions);
  }

  settingsView(): AssistantSettingsView {
    return {
      ...this.#settings,
      proxy: { ...this.#settings.proxy },
      actions: this.#settings.actions.map((action) => ({ ...action })),
      hasApiKey: this.#store.hasApiKey(),
      hasProxyPassword: this.#store.hasProxyPassword(this.#settings.proxy.url),
      encryptionAvailable: this.#store.encryptionAvailable(),
      shortcutRegistrations: this.#shortcutRegistrations.map((value) => ({ ...value })),
    };
  }

  async saveSettings(update: AssistantSettingsUpdate): Promise<AssistantSettingsView> {
    const next = validateAssistantSettings(update);
    if (typeof update.apiKey === "string" && update.apiKey.trim() && !this.#store.encryptionAvailable()) {
      throw new Error("当前系统无法安全加密 API Key，因此没有保存配置");
    }
    const submittedProxy = update.proxy.url.trim() ? parseProxyUrl(update.proxy.url) : null;
    if (submittedProxy?.password && !this.#store.encryptionAvailable()) {
      throw new Error("当前系统无法安全加密代理密码，因此没有保存配置");
    }

    const previous = this.#settings;
    const wasSuspended = this.#shortcutsSuspended;
    if (wasSuspended) globalShortcut.setSuspended(false);
    globalShortcut.unregisterAll();
    const registrations = this.#registerActions(next.actions);
    const failed = registrations.find((value) => !value.registered);
    if (failed) {
      globalShortcut.unregisterAll();
      this.#shortcutRegistrations = this.#registerActions(previous.actions);
      if (wasSuspended) globalShortcut.setSuspended(true);
      throw new Error(failed.error ?? "快捷键注册失败");
    }

    try {
      this.#settings = this.#store.saveSettings(update);
      this.#shortcutRegistrations = registrations;
    } catch (error) {
      globalShortcut.unregisterAll();
      this.#shortcutRegistrations = this.#registerActions(previous.actions);
      if (wasSuspended) globalShortcut.setSuspended(true);
      throw error;
    }
    if (wasSuspended) globalShortcut.setSuspended(true);
    this.#cancelActiveRequest();
    try {
      const proxyUrl = this.#store.effectiveProxyUrl(this.#settings);
      await this.#proxy.apply(proxyUrl);
      this.#sendRuntimeCommand({ type: "setProxy", proxyUrl });
    } catch (error) {
      this.#onSettingsChanged();
      throw new Error(`配置已保存，但代理应用失败：${errorMessage(error)}`);
    }
    this.#onSettingsChanged();
    return this.settingsView();
  }

  async testConnection(): Promise<string> {
    const apiKey = this.#apiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("连接测试超时")), 30_000);
    const action: PromptAction = {
      id: "connection-test",
      name: "连接测试",
      systemPrompt: "你正在执行连接测试。",
      userPrompt: "请只回复 OK。测试内容：{{input}}",
      shortcut: "F24",
      autoCopy: false,
    };
    try {
      const result = await streamChatCompletion({
        settings: this.#settings,
        action,
        input: "codex-pet",
        apiKey,
        signal: controller.signal,
        fetchImpl: this.#proxy.fetch,
        onDelta: () => undefined,
      });
      return result.slice(0, 200);
    } finally {
      clearTimeout(timeout);
    }
  }

  triggerAction(actionId: string): void {
    const action = this.#settings.actions.find((value) => value.id === actionId);
    if (!action) {
      this.#publish({ type: "error", requestId: null, message: "找不到对应的 Prompt 动作" });
      return;
    }
    if (this.#pendingSelection || this.#activeRequest) {
      this.#publish({ type: "error", requestId: null, message: "已有请求正在处理中，请稍后再试" });
      return;
    }

    const requestId = (this.#requestSequence += 1);
    this.#pendingSelection = { requestId, actionId };
    this.#lastRequest = null;
    this.#publish({ type: "capturing", requestId, actionName: action.name });
    this.#setPetNotification("running", action.name);

    if (process.platform === "linux") {
      queueMicrotask(() => {
        try {
          this.#acceptSelection(requestId, clipboard.readText("selection"), "primarySelection");
        } catch (error) {
          this.#selectionFailed(requestId, errorMessage(error));
        }
      });
      return;
    }
    if (process.platform === "win32") {
      if (!this.#sendRuntimeCommand({ type: "captureSelection", requestId })) {
        this.#selectionFailed(requestId, "宠物运行时尚未就绪");
      }
      return;
    }
    this.#selectionFailed(requestId, "当前平台暂不支持直接读取选中文本");
  }

  handleRuntimeEvent(event: RuntimeEvent): boolean {
    if (event.type === "selectionCaptured") {
      this.#acceptSelection(event.requestId, event.text, event.method);
      return true;
    }
    if (event.type === "selectionFailed") {
      this.#selectionFailed(event.requestId, event.message);
      return true;
    }
    return false;
  }

  bubbleReady(): void {
    if (this.#lastBubbleEvent) this.#sendBubbleEvent(this.#lastBubbleEvent);
  }

  copyResult(): void {
    if (!this.#lastRequest?.result) throw new Error("当前没有可复制的模型结果");
    clipboard.writeText(this.#lastRequest.result);
  }

  retry(): void {
    if (this.#pendingSelection || this.#activeRequest) throw new Error("已有请求正在处理中");
    const previous = this.#lastRequest;
    if (!previous) throw new Error("当前没有可重试的请求");
    const requestId = (this.#requestSequence += 1);
    void this.#startModelRequest(
      requestId,
      previous.actionId,
      previous.input,
      previous.selectionMethod,
    );
  }

  closeBubble(): void {
    this.#pendingSelection = null;
    this.#cancelActiveRequest();
    this.#lastRequest = null;
    this.#lastBubbleEvent = null;
    this.#hideBubble();
  }

  setShortcutsSuspended(suspended: boolean): void {
    if (this.#shortcutsSuspended === suspended) return;
    this.#shortcutsSuspended = suspended;
    globalShortcut.setSuspended(suspended);
  }

  dispose(): void {
    this.#cancelActiveRequest();
    globalShortcut.unregisterAll();
    this.#proxy.dispose();
  }

  #registerActions(actions: PromptAction[]): ShortcutRegistration[] {
    return actions.map((action) => {
      try {
        const registered = globalShortcut.register(action.shortcut, () => this.triggerAction(action.id));
        return registered
          ? { actionId: action.id, registered: true }
          : {
              actionId: action.id,
              registered: false,
              error: `快捷键 ${action.shortcut} 已被系统或其他应用占用`,
            };
      } catch {
        return {
          actionId: action.id,
          registered: false,
          error: `快捷键格式无效：${action.shortcut}`,
        };
      }
    });
  }

  #acceptSelection(requestId: number, value: string, method: SelectionMethod): void {
    const pending = this.#pendingSelection;
    if (!pending || pending.requestId !== requestId) return;
    const input = value.trim();
    if (!input) {
      this.#selectionFailed(requestId, "没有检测到选中的文本");
      return;
    }
    if (input.length > MAX_SELECTION_CHARS) {
      this.#selectionFailed(requestId, `选中文本超过 ${MAX_SELECTION_CHARS} 个字符`);
      return;
    }
    this.#pendingSelection = null;
    void this.#startModelRequest(requestId, pending.actionId, input, method);
  }

  #selectionFailed(requestId: number, message: string): void {
    if (this.#pendingSelection?.requestId !== requestId) return;
    this.#pendingSelection = null;
    this.#setPetNotification("failed", message);
    this.#publish({ type: "error", requestId, message });
  }

  async #startModelRequest(
    requestId: number,
    actionId: string,
    input: string,
    selectionMethod: SelectionMethod,
  ): Promise<void> {
    const action = this.#settings.actions.find((value) => value.id === actionId);
    if (!action) {
      this.#publish({ type: "error", requestId, message: "Prompt 动作已不存在" });
      return;
    }
    let apiKey: string | null;
    try {
      apiKey = this.#apiKey();
    } catch (error) {
      this.#lastRequest = { actionId, input, result: "", selectionMethod };
      this.#publish({ type: "error", requestId, message: errorMessage(error) });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("模型请求超过 60 秒")), 60_000);
    this.#activeRequest = { requestId, controller, timeout };
    this.#lastRequest = { actionId, input, result: "", selectionMethod };
    this.#publish({
      type: "streaming",
      requestId,
      actionName: action.name,
      selectionMethod,
    });
    this.#setPetNotification("running", action.name);

    try {
      const result = await streamChatCompletion({
        settings: this.#settings,
        action,
        input,
        apiKey,
        signal: controller.signal,
        fetchImpl: this.#proxy.fetch,
        onDelta: (delta) => {
          if (this.#activeRequest?.requestId !== requestId) return;
          this.#publish({ type: "delta", requestId, delta });
        },
      });
      if (this.#activeRequest?.requestId !== requestId) return;
      if (action.autoCopy) clipboard.writeText(result);
      this.#lastRequest = { actionId, input, result, selectionMethod };
      this.#setPetNotification("review", result);
      this.#publish({ type: "complete", requestId, result, autoCopied: action.autoCopy });
    } catch (error) {
      if (this.#activeRequest?.requestId !== requestId) return;
      const message = errorMessage(error);
      this.#setPetNotification("failed", message);
      this.#publish({ type: "error", requestId, message });
    } finally {
      if (this.#activeRequest?.requestId === requestId) {
        clearTimeout(this.#activeRequest.timeout);
        this.#activeRequest = null;
      }
    }
  }

  #apiKey(): string | null {
    const apiKey = this.#store.loadApiKey();
    if (!apiKey && !isLocalModelUrl(this.#settings.baseUrl)) {
      throw new Error("尚未配置 API Key，请先打开 AI 设置");
    }
    return apiKey;
  }

  #setPetNotification(kind: PetNotificationKind, body: string): void {
    const summary = body.trim().replaceAll(/\s+/g, " ").slice(0, 160);
    this.#sendRuntimeCommand({
      type: "setPetNotification",
      kind,
      body: summary || undefined,
    });
  }

  #publish(event: AssistantBubbleEvent): void {
    this.#lastBubbleEvent = event;
    const window = this.#showBubble();
    if (window && !window.webContents.isLoadingMainFrame()) this.#sendBubbleEvent(event);
  }

  #sendBubbleEvent(event: AssistantBubbleEvent): void {
    const window = this.#showBubble();
    window?.webContents.send("assistant:bubble:event", event);
  }

  #cancelActiveRequest(): void {
    if (!this.#activeRequest) return;
    clearTimeout(this.#activeRequest.timeout);
    this.#activeRequest.controller.abort();
    this.#activeRequest = null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "模型请求已取消或超时";
    return error.message;
  }
  return String(error);
}
