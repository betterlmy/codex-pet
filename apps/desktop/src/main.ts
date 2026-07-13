import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  screen,
  session,
  Tray,
} from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  PetCommand,
  PetSummary,
  RuntimeEvent,
  RuntimeSnapshot,
  ShellState,
} from "./types";

const WINDOW_WIDTH = 292;
const WINDOW_HEIGHT = 344;

interface WindowSettings {
  x?: number;
  y?: number;
  clickThrough: boolean;
}

let petWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: ChildProcessWithoutNullStreams | null = null;
let catalog: PetSummary[] = [];
let snapshot: RuntimeSnapshot | null = null;
let lastEvent: RuntimeEvent | null = null;
let windowSettings: WindowSettings = { clickThrough: false };
let saveTimer: NodeJS.Timeout | null = null;
let previewCaptured = false;

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
  window.on("moved", schedulePersistSettings);
  window.on("show", sendShellState);
  window.on("hide", sendShellState);
  window.on("closed", () => {
    petWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
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

function startRuntime(): void {
  try {
    runtime = spawn(runtimePath(), [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
  } catch (error) {
    publishError(error);
    return;
  }

  const lines = createInterface({ input: runtime.stdout });
  lines.on("line", (line) => {
    try {
      const event = normalizeEvent(JSON.parse(line) as RuntimeEvent);
      lastEvent = event;
      if (event.type === "ready") {
        catalog = event.catalog;
        snapshot = event.snapshot;
      } else if (event.type === "snapshot") {
        snapshot = event.snapshot;
      }
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
  return event;
}

function sendCommand(command: PetCommand): void {
  if (!runtime?.stdin.writable) {
    publishError(new Error("Rust sidecar 尚未就绪"));
    return;
  }
  runtime.stdin.write(`${JSON.stringify(command)}\n`);
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
  const iconPath = path.join(__dirname, "..", "assets", "tray-icon.svg");
  const icon = nativeImage.createFromPath(iconPath);
  const value = new Tray(icon.resize({ width: 18, height: 18 }));
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
  const petItems: MenuItemConstructorOptions[] = catalog.map((pet) => ({
    label: pet.displayName,
    type: "radio",
    checked: snapshot?.pet.id === pet.id,
    click: () => sendCommand({ type: "selectPet", petId: pet.id }),
  }));
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
    { label: "选择宠物", submenu: petItems.length > 0 ? petItems : [{ label: "正在加载", enabled: false }] },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
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
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  petWindow = createWindow();
  tray = createTray();
  rebuildTrayMenu();
  startRuntime();
});

app.on("window-all-closed", () => {
  // 托盘进程保持存活，显式选择“退出”时才结束应用。
});

app.on("before-quit", () => {
  sendCommand({ type: "shutdown" });
  runtime?.kill();
  persistSettings();
});
