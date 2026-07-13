import type { ProxySettings } from "./types";

const ALLOWED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

export interface ParsedProxyUrl {
  sanitizedUrl: string;
  connectionUrl: string;
  serverUrl: string;
  credentialKey: string;
  protocol: "http:" | "https:" | "socks4:" | "socks5:";
  hostname: string;
  port: number;
  username: string;
  password: string;
}

export function validateProxySettings(value: ProxySettings): ProxySettings {
  const enabled = value?.enabled === true;
  const rawUrl = typeof value?.url === "string" ? value.url.trim() : "";
  if (!rawUrl) {
    if (enabled) throw new Error("启用代理后必须填写代理地址");
    return { enabled: false, url: "" };
  }
  return { enabled, url: parseProxyUrl(rawUrl).sanitizedUrl };
}

export function parseProxyUrl(value: string): ParsedProxyUrl {
  const normalizedAlias = value.trim().replace(/^socks:\/\//i, "socks5://");
  let url: URL;
  try {
    url = new URL(normalizedAlias);
  } catch {
    throw new Error("代理地址格式无效");
  }
  url.protocol = url.protocol.toLowerCase();
  if (!ALLOWED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error("代理协议仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5");
  }
  if (
    !url.hostname ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("代理地址只能包含协议、账号、主机和端口");
  }

  const username = decodeUrlComponent(url.username, "代理用户名编码无效");
  const password = decodeUrlComponent(url.password, "代理密码编码无效");
  if (password && !username) throw new Error("代理密码必须与用户名一起填写");
  const protocol = url.protocol as ParsedProxyUrl["protocol"];
  const port = url.port ? Number(url.port) : defaultProxyPort(protocol);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("代理端口无效");

  const sanitized = new URL(url);
  sanitized.password = "";
  const server = new URL(url);
  server.username = "";
  server.password = "";
  const sanitizedUrl = compactProxyUrl(sanitized);
  return {
    sanitizedUrl,
    connectionUrl: compactProxyUrl(url),
    serverUrl: compactProxyUrl(server),
    credentialKey: `${protocol}//${url.username}@${url.hostname.toLowerCase()}:${port}`,
    protocol,
    hostname: url.hostname.toLowerCase(),
    port,
    username,
    password,
  };
}

export function proxyUrlWithPassword(sanitizedUrl: string, password: string | null): string {
  const parsed = parseProxyUrl(sanitizedUrl);
  if (!password) return parsed.connectionUrl;
  const url = new URL(parsed.sanitizedUrl);
  url.password = password;
  return compactProxyUrl(url);
}

export function isLocalNetworkUrl(value: string | URL): boolean {
  const hostname = (value instanceof URL ? value : new URL(value)).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function compactProxyUrl(url: URL): string {
  return url.toString().replace(/\/$/, "");
}

function defaultProxyPort(protocol: ParsedProxyUrl["protocol"]): number {
  if (protocol === "http:") return 80;
  if (protocol === "https:") return 443;
  return 1080;
}

function decodeUrlComponent(value: string, message: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(message);
  }
}
