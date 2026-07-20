import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
  screen,
  session,
  Tray,
} from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AssistantController } from "./assistant-controller";
import { AssistantStore } from "./assistant-store";
import { ApplicationProxy } from "./application-proxy";
import { formatShortcut } from "./shortcut-display";
import type {
  AssistantSettingsUpdate,
  PetCommand,
  PetDefinition,
  PetPickerState,
  PetSummary,
  RuntimeEvent,
  RuntimeSnapshot,
  ShellState,
} from "./types";

const WINDOW_WIDTH = 292;
const WINDOW_HEIGHT = 344;
const BUBBLE_WIDTH = 430;
const BUBBLE_HEIGHT = 318;
const PICKER_WIDTH = 820;
const PICKER_HEIGHT = 640;

interface WindowSettings {
  x?: number;
  y?: number;
  clickThrough: boolean;
}

let petWindow: BrowserWindow | null = null;
let bubbleWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let pickerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: ChildProcessWithoutNullStreams | null = null;
let assistantController: AssistantController | null = null;
let catalog: PetSummary[] = [];
let snapshot: RuntimeSnapshot | null = null;
let lastEvent: RuntimeEvent | null = null;
let windowSettings: WindowSettings = { clickThrough: false };
let saveTimer: NodeJS.Timeout | null = null;
let previewCaptured = false;
let shutdownStarted = false;
let previewSequence = 0;
const pendingPreviews = new Map<
  number,
  { resolve: (pet: PetDefinition) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>();

function settingsPath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readSettings(): WindowSettings {
  try {
    const value = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<WindowSettings>;
    return {
      x: typeof value.x === "number" ? value.x : undefined,
      y: typeof value.y === "number" ? value.y : undefined,
      clickThrough: value.clickThrough === true,
    };
  } catch {
    return { clickThrough: false };
  }
}

function persistSettings(): void {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  windowSettings = { ...windowSettings, x, y };
  writeFileSync(settingsPath(), JSON.stringify(windowSettings, null, 2), "utf8");
}

function schedulePersistSettings(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSettings, 180);
}

function initialPosition(settings: WindowSettings): { x: number; y: number } {
  if (settings.x !== undefined && settings.y !== undefined) {
    const candidate = { x: settings.x, y: settings.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
    const display = screen.getDisplayMatching(candidate);
    const area = display.workArea;
    if (
      candidate.x + 48 >= area.x &&
      candidate.x <= area.x + area.width - 48 &&
      candidate.y + 48 >= area.y &&
      candidate.y <= area.y + area.height - 48
    ) {
      return { x: settings.x, y: settings.y };
    }
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - WINDOW_WIDTH - 28,
    y: area.y + area.height - WINDOW_HEIGHT - 20,
  };
}

function createWindow(): BrowserWindow {
  windowSettings = readSettings();
  const position = initialPosition(windowSettings);
  const window = new BrowserWindow({
    ...position,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(false);
  }
  window.setIgnoreMouseEvents(windowSettings.clickThrough, { forward: true });
  window.loadFile(path.join(__dirname, "..", "index.html"));
  window.once("ready-to-show", () => window.showInactive());
  window.on("moved", () => {
    schedulePersistSettings();
    positionBubbleWindow();
  });
  window.on("show", sendShellState);
  window.on("hide", sendShellState);
  window.on("closed", () => {
    petWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

function createBubbleWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    closable: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "bubble-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  window.loadFile(path.join(__dirname, "..", "bubble.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("closed", () => {
    bubbleWindow = null;
  });
  return window;
}

function showBubbleWindow(): BrowserWindow | null {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return null;
  positionBubbleWindow();
  if (!bubbleWindow.isVisible()) bubbleWindow.showInactive();
  return bubbleWindow;
}

function hideBubbleWindow(): void {
  bubbleWindow?.hide();
}

function positionBubbleWindow(): void {
  if (!petWindow || !bubbleWindow || petWindow.isDestroyed() || bubbleWindow.isDestroyed()) return;
  const petBounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const area = display.workArea;
  let x = petBounds.x + petBounds.width - BUBBLE_WIDTH - 34;
  let y = petBounds.y - BUBBLE_HEIGHT + 92;
  if (y < area.y + 8) y = petBounds.y + 54;
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - BUBBLE_WIDTH - 8);
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - BUBBLE_HEIGHT - 8);
  bubbleWindow.setPosition(Math.round(x), Math.round(y), false);
}

function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 700,
    height: 720,
    minWidth: 620,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202023" : "#f5f5f7",
    title: "codex-pet 设置",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow = window;
  window.loadFile(path.join(__dirname, "..", "settings.html"));
  window.once("ready-to-show", () => window.show());
  window.on("focus", () => assistantController?.setShortcutsSuspended(true));
  window.on("blur", () => assistantController?.setShortcutsSuspended(false));
  window.on("closed", () => {
    assistantController?.setShortcutsSuspended(false);
    settingsWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function showPetPickerWindow(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.show();
    pickerWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: PICKER_WIDTH,
    height: PICKER_HEIGHT,
    minWidth: 700,
    minHeight: 560,
    backgroundColor: "#17110c",
    title: "选择桌面宠物",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "picker-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pickerWindow = window;
  window.loadFile(path.join(__dirname, "..", "pet-picker.html"));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    pickerWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function runtimePath(): string {
  const executable = process.platform === "win32" ? "codex-pet-runtime.exe" : "codex-pet-runtime";
  const candidates = [
    process.env.CODEX_PET_RUNTIME,
    app.isPackaged ? path.join(process.resourcesPath, "bin", executable) : undefined,
    path.resolve(__dirname, "..", "..", "..", "target", "debug", executable),
    path.resolve(__dirname, "..", "..", "..", "target", "release", executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(`找不到 Rust sidecar。已检查：${candidates.join(", ")}`);
  }
  return found;
}

function startRuntime(proxyUrl: string | null): void {
  try {
    const environment = { ...process.env };
    if (proxyUrl) environment.CODEX_PET_PROXY_URL = proxyUrl;
    else delete environment.CODEX_PET_PROXY_URL;
    runtime = spawn(runtimePath(), [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: environment,
    });
  } catch (error) {
    publishError(error);
    return;
  }

  const lines = createInterface({ input: runtime.stdout });
  lines.on("line", (line) => {
    try {
      const event = normalizeEvent(JSON.parse(line) as RuntimeEvent);
      if (event.type === "petPreview" || event.type === "petPreviewFailed") {
        const pending = pendingPreviews.get(event.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingPreviews.delete(event.requestId);
          if (event.type === "petPreview") pending.resolve(event.pet);
          else pending.reject(new Error(event.message));
        }
        return;
      }
      if (assistantController?.handleRuntimeEvent(event)) return;
      lastEvent = event;
      if (event.type === "ready") {
        catalog = event.catalog;
        snapshot = event.snapshot;
      } else if (event.type === "snapshot") {
        snapshot = event.snapshot;
      }
      if (snapshot?.enabled === false) petWindow?.hide();
      else if (event.type === "snapshot") petWindow?.showInactive();
      petWindow?.webContents.send("pet:event", event);
      rebuildTrayMenu();
    } catch (error) {
      publishError(new Error(`无法解析 sidecar 输出：${String(error)}`));
    }
  });
  runtime.stderr.on("data", (chunk: Buffer) => {
    publishError(new Error(chunk.toString("utf8").trim()));
  });
  runtime.on("error", publishError);
  runtime.on("exit", (code) => {
    runtime = null;
    if (code && code !== 0) publishError(new Error(`Rust sidecar 已退出，代码 ${code}`));
  });
}

function normalizeEvent(event: RuntimeEvent): RuntimeEvent {
  const normalizeSnapshot = (value: RuntimeSnapshot): RuntimeSnapshot => ({
    ...value,
    pet: {
      ...value.pet,
      spritesheetPath: pathToFileURL(value.pet.spritesheetPath).href,
    },
  });
  if (event.type === "ready" && event.snapshot) {
    return { ...event, snapshot: normalizeSnapshot(event.snapshot) };
  }
  if (event.type === "snapshot") {
    return { ...event, snapshot: normalizeSnapshot(event.snapshot) };
  }
  if (event.type === "petPreview") {
    return {
      ...event,
      pet: {
        ...event.pet,
        spritesheetPath: pathToFileURL(event.pet.spritesheetPath).href,
      },
    };
  }
  return event;
}

function sendCommand(command: PetCommand): boolean {
  if (!runtime?.stdin.writable) {
    publishError(new Error("Rust sidecar 尚未就绪"));
    return false;
  }
  runtime.stdin.write(`${JSON.stringify(command)}\n`);
  return true;
}

function cleanupBeforeQuit(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    persistSettings();
  } catch (error) {
    console.error("无法在退出前保存窗口状态", error);
  }
  try {
    assistantController?.dispose();
  } catch (error) {
    console.error("无法在退出前释放 AI 助手资源", error);
  }
  for (const pending of pendingPreviews.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("应用正在退出"));
  }
  pendingPreviews.clear();
  if (runtime?.stdin.writable) {
    runtime.stdin.write(`${JSON.stringify({ type: "shutdown" } satisfies PetCommand)}\n`);
  }
  runtime?.kill();
}

function quitApplication(): void {
  cleanupBeforeQuit();
  const fallback = setTimeout(() => app.exit(0), 1_500);
  fallback.unref();
  app.quit();
}

function publishError(error: unknown): void {
  const event: RuntimeEvent = {
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  };
  lastEvent = event;
  petWindow?.webContents.send("pet:event", event);
}

function maybeCapturePreview(): void {
  const destination = process.env.CODEX_PET_SCREENSHOT;
  if (!destination || previewCaptured || !snapshot || !petWindow) return;
  previewCaptured = true;
  setTimeout(async () => {
    try {
      const image = await petWindow?.webContents.capturePage();
      if (!image) throw new Error("桌宠窗口已关闭，无法截图");
      writeFileSync(destination, image.toPNG());
      app.quit();
    } catch (error) {
      publishError(error);
      previewCaptured = false;
    }
  }, 900);
}

function setClickThrough(enabled: boolean): void {
  windowSettings.clickThrough = enabled;
  petWindow?.setIgnoreMouseEvents(enabled, { forward: true });
  schedulePersistSettings();
  sendShellState();
  rebuildTrayMenu();
}

function sendShellState(): void {
  const state: ShellState = {
    clickThrough: windowSettings.clickThrough,
    visible: petWindow?.isVisible() ?? false,
  };
  petWindow?.webContents.send("pet:shellState", state);
}

function createTray(): Tray {
  const iconName =
    process.platform === "darwin"
      ? "trayTemplate.png"
      : process.platform === "win32"
        ? "tray.ico"
        : "tray.png";
  const iconPath = path.join(__dirname, "..", "assets", iconName);
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    throw new Error(`无法加载托盘图标：${iconPath}`);
  }
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }
  const value = new Tray(icon);
  value.setToolTip("codex-pet");
  value.on("click", () => {
    if (petWindow?.isVisible()) petWindow.hide();
    else petWindow?.showInactive();
    rebuildTrayMenu();
  });
  return value;
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const assistant = assistantController?.settingsView();
  const actionItems: MenuItemConstructorOptions[] =
    assistant?.actions.map((action) => {
      const registration = assistant.shortcutRegistrations.find((value) => value.actionId === action.id);
      return {
        label: `${action.name}  [${formatShortcut(action.shortcut, process.platform)}]`,
        enabled: registration?.registered === true,
        click: () => assistantController?.triggerAction(action.id),
      };
    }) ?? [];
  const template: MenuItemConstructorOptions[] = [
    {
      label: petWindow?.isVisible() ? "隐藏桌宠" : "显示桌宠",
      click: () => {
        if (petWindow?.isVisible()) petWindow.hide();
        else petWindow?.showInactive();
      },
    },
    { type: "separator" },
    {
      label: "自动行为",
      type: "checkbox",
      checked: snapshot?.behaviorMode === "automatic",
      click: (item) =>
        sendCommand({
          type: "setBehaviorMode",
          mode: item.checked ? "automatic" : "manual",
        }),
    },
    {
      label: "暂停动画",
      type: "checkbox",
      checked: snapshot?.paused ?? false,
      click: (item) => sendCommand({ type: "setPaused", paused: item.checked }),
    },
    {
      label: "点击穿透",
      type: "checkbox",
      checked: windowSettings.clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    { label: "切换下一个行为", click: () => sendCommand({ type: "advance" }) },
    { type: "separator" },
    { label: "选择宠物…", enabled: catalog.length > 0, click: showPetPickerWindow },
    { type: "separator" },
    {
      label: "AI 动作",
      submenu: actionItems.length > 0 ? actionItems : [{ label: "尚未配置", enabled: false }],
    },
    { label: "AI 设置…", click: showSettingsWindow },
    { type: "separator" },
    {
      label: "退出",
      click: quitApplication,
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.on("pet:rendererReady", () => {
    if (lastEvent) petWindow?.webContents.send("pet:event", lastEvent);
    sendShellState();
  });
  ipcMain.on("pet:rendered", () => maybeCapturePreview());
  ipcMain.on("pet:command", (_event, command: PetCommand) => sendCommand(command));
  ipcMain.on("pet:setClickThrough", (_event, enabled: boolean) => {
    if (typeof enabled === "boolean") setClickThrough(enabled);
  });
  ipcMain.on("pet:hide", () => petWindow?.hide());
  ipcMain.handle("pet:picker:get", (): PetPickerState => ({
    catalog,
    selectedPetId: snapshot?.pet.id ?? null,
    enabled: snapshot?.enabled ?? true,
  }));
  ipcMain.handle("pet:picker:preview", (_event, petId: string) => previewPet(petId));
  ipcMain.handle("pet:picker:select", (_event, petId: string) => {
    assertKnownPet(petId);
    if (!sendCommand({ type: "selectPet", petId })) throw new Error("桌宠运行时尚未就绪");
    pickerWindow?.close();
  });
  ipcMain.on("assistant:bubble:ready", () => assistantController?.bubbleReady());
  ipcMain.handle("assistant:bubble:copy", () => assistantController?.copyResult());
  ipcMain.handle("assistant:bubble:retry", () => assistantController?.retry());
  ipcMain.handle("assistant:bubble:close", () => assistantController?.closeBubble());
  ipcMain.handle("assistant:settings:get", () => assistantController?.settingsView());
  ipcMain.handle("assistant:settings:save", (_event, update: AssistantSettingsUpdate) => {
    if (!assistantController) throw new Error("AI 助手尚未就绪");
    return assistantController.saveSettings(update);
  });
  ipcMain.handle("assistant:settings:test", async () => {
    if (!assistantController) throw new Error("AI 助手尚未就绪");
    return assistantController.testConnection();
  });
}

function assertKnownPet(petId: string): void {
  if (!catalog.some((pet) => pet.id === petId)) throw new Error(`未知宠物：${petId}`);
}

function previewPet(petId: string): Promise<PetDefinition> {
  assertKnownPet(petId);
  if (petId === "disabled") throw new Error("禁用状态没有预览动画");
  const requestId = ++previewSequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPreviews.delete(requestId);
      reject(new Error("加载宠物预览超时"));
    }, 60_000);
    pendingPreviews.set(requestId, { resolve, reject, timer });
    if (!sendCommand({ type: "previewPet", requestId, petId })) {
      clearTimeout(timer);
      pendingPreviews.delete(requestId);
      reject(new Error("桌宠运行时尚未就绪"));
    }
  });
}

app.whenReady().then(async () => {
  app.dock?.hide();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  petWindow = createWindow();
  bubbleWindow = createBubbleWindow();
  tray = createTray();
  const assistantStore = new AssistantStore(app.getPath("userData"));
  const applicationProxy = new ApplicationProxy();
  let initialProxyUrl = assistantStore.effectiveProxyUrl(assistantStore.loadSettings());
  try {
    await applicationProxy.apply(initialProxyUrl);
  } catch (error) {
    await applicationProxy.apply(null);
    initialProxyUrl = null;
    publishError(new Error(`无法应用已保存的代理配置：${String(error)}`));
  }
  assistantController = new AssistantController({
    store: assistantStore,
    proxy: applicationProxy,
    sendRuntimeCommand: sendCommand,
    showBubble: showBubbleWindow,
    hideBubble: hideBubbleWindow,
    onSettingsChanged: rebuildTrayMenu,
  });
  rebuildTrayMenu();
  startRuntime(initialProxyUrl);
});

app.on("window-all-closed", () => {
  // 托盘进程保持存活，显式选择“退出”时才结束应用。
});

app.on("before-quit", () => {
  cleanupBeforeQuit();
});
