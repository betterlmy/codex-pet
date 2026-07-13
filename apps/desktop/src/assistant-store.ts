import { safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeStoredSettings, validateAssistantSettings } from "./assistant-config";
import { parseProxyUrl, proxyUrlWithPassword } from "./proxy-config";
import type { AssistantSettings, AssistantSettingsUpdate } from "./types";

interface StoredProxyPassword {
  credentialKey: string;
  password: string;
}

export class AssistantStore {
  readonly #settingsPath: string;
  readonly #secretPath: string;
  readonly #proxySecretPath: string;

  constructor(userDataPath: string) {
    this.#settingsPath = path.join(userDataPath, "assistant-settings.json");
    this.#secretPath = path.join(userDataPath, "assistant-secret.bin");
    this.#proxySecretPath = path.join(userDataPath, "assistant-proxy-secret.bin");
  }

  loadSettings(): AssistantSettings {
    try {
      return normalizeStoredSettings(JSON.parse(readFileSync(this.#settingsPath, "utf8")));
    } catch {
      return normalizeStoredSettings(null);
    }
  }

  saveSettings(update: AssistantSettingsUpdate): AssistantSettings {
    const settings = validateAssistantSettings(update);
    this.#writeAtomic(this.#settingsPath, Buffer.from(JSON.stringify(settings, null, 2), "utf8"));
    if (update.clearApiKey === true) this.clearApiKey();
    else if (typeof update.apiKey === "string" && update.apiKey.trim()) this.saveApiKey(update.apiKey.trim());
    this.#updateProxyPassword(update.proxy.url, settings.proxy.url);
    return settings;
  }

  encryptionAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform !== "linux") return true;
    return ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
      safeStorage.getSelectedStorageBackend(),
    );
  }

  hasApiKey(): boolean {
    return existsSync(this.#secretPath) && this.loadApiKey() !== null;
  }

  loadApiKey(): string | null {
    if (!existsSync(this.#secretPath) || !this.encryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(readFileSync(this.#secretPath));
    } catch {
      return null;
    }
  }

  saveApiKey(apiKey: string): void {
    if (!this.encryptionAvailable()) {
      throw new Error("当前系统无法安全加密 API Key，因此没有保存密钥");
    }
    this.#writeAtomic(this.#secretPath, safeStorage.encryptString(apiKey));
  }

  clearApiKey(): void {
    rmSync(this.#secretPath, { force: true });
  }

  hasProxyPassword(proxyUrl: string): boolean {
    return this.loadProxyPassword(proxyUrl) !== null;
  }

  effectiveProxyUrl(settings: AssistantSettings): string | null {
    if (!settings.proxy.enabled) return null;
    return proxyUrlWithPassword(settings.proxy.url, this.loadProxyPassword(settings.proxy.url));
  }

  loadProxyPassword(proxyUrl: string): string | null {
    if (!proxyUrl || !existsSync(this.#proxySecretPath) || !this.encryptionAvailable()) return null;
    try {
      const stored = JSON.parse(
        safeStorage.decryptString(readFileSync(this.#proxySecretPath)),
      ) as Partial<StoredProxyPassword>;
      const parsed = parseProxyUrl(proxyUrl);
      return stored.credentialKey === parsed.credentialKey && typeof stored.password === "string"
        ? stored.password
        : null;
    } catch {
      return null;
    }
  }

  clearProxyPassword(): void {
    rmSync(this.#proxySecretPath, { force: true });
  }

  #updateProxyPassword(submittedUrl: string, sanitizedUrl: string): void {
    if (!sanitizedUrl) {
      this.clearProxyPassword();
      return;
    }
    const submitted = parseProxyUrl(submittedUrl);
    if (submitted.password) {
      if (!this.encryptionAvailable()) {
        throw new Error("当前系统无法安全加密代理密码，因此没有保存代理凭据");
      }
      const stored: StoredProxyPassword = {
        credentialKey: submitted.credentialKey,
        password: submitted.password,
      };
      this.#writeAtomic(
        this.#proxySecretPath,
        safeStorage.encryptString(JSON.stringify(stored)),
      );
      return;
    }
    if (!this.hasProxyPassword(sanitizedUrl)) this.clearProxyPassword();
  }

  #writeAtomic(destination: string, content: Buffer): void {
    const temporary = `${destination}.tmp`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, destination);
  }
}
