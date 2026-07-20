const MACOS_TOKENS: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Cmd: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Option: "⌥",
};

const TEXT_TOKENS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Command: "Ctrl",
  Cmd: "Ctrl",
  Control: "Ctrl",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Option: "Alt",
};

export function formatShortcut(accelerator: string, platform: string): string {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (platform === "darwin") {
    return tokens.map((token) => MACOS_TOKENS[token] ?? token).join(" ");
  }
  return tokens.map((token) => TEXT_TOKENS[token] ?? token).join(" + ");
}
