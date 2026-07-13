import {
  app,
  session,
  type AuthenticationResponseDetails,
  type AuthInfo,
  type Event,
  type ProxyConfig,
  type WebContents,
} from "electron";
import { ProxyAgent } from "proxy-agent";

import { isLocalNetworkUrl, parseProxyUrl, type ParsedProxyUrl } from "./proxy-config";
import { fetchWithAgent, type FetchImplementation } from "./proxy-fetch";

type LoginListener = (
  event: Event,
  webContents: WebContents,
  details: AuthenticationResponseDetails,
  authInfo: AuthInfo,
  callback: (username?: string, password?: string) => void,
) => void;

export class ApplicationProxy {
  #agent: ProxyAgent | null = null;
  #parsed: ParsedProxyUrl | null = null;
  readonly #loginListener: LoginListener;

  constructor() {
    this.#loginListener = (event, _webContents, _details, authInfo, callback) => {
      const parsed = this.#parsed;
      if (
        !parsed?.username ||
        !authInfo.isProxy ||
        normalizeHostname(authInfo.host) !== normalizeHostname(parsed.hostname) ||
        authInfo.port !== parsed.port
      ) {
        return;
      }
      event.preventDefault();
      callback(parsed.username, parsed.password);
    };
    app.on("login", this.#loginListener);
  }

  readonly fetch: FetchImplementation = (input, init) => {
    if (!this.#agent || isLocalNetworkUrl(input)) return globalThis.fetch(input, init);
    return fetchWithAgent(input, init, this.#agent);
  };

  async apply(proxyUrl: string | null): Promise<void> {
    this.#agent?.destroy();
    this.#agent = null;
    this.#parsed = proxyUrl ? parseProxyUrl(proxyUrl) : null;
    if (this.#parsed) {
      const connectionUrl = this.#parsed.connectionUrl;
      this.#agent = new ProxyAgent({
        keepAlive: true,
        getProxyForUrl: (requestUrl) =>
          isLocalNetworkUrl(requestUrl) ? "" : connectionUrl,
      });
    }

    const config: ProxyConfig = this.#parsed
      ? {
          mode: "fixed_servers",
          proxyRules: this.#parsed.serverUrl,
          proxyBypassRules: "<local>",
        }
      : { mode: "direct" };
    await Promise.all([session.defaultSession.setProxy(config), app.setProxy(config)]);
    await session.defaultSession.closeAllConnections();
  }

  dispose(): void {
    app.off("login", this.#loginListener);
    this.#agent?.destroy();
    this.#agent = null;
    this.#parsed = null;
  }
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/^\[(.*)]$/, "$1");
}
