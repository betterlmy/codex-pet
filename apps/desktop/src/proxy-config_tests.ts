import assert from "node:assert/strict";
import test from "node:test";

import {
  isLocalNetworkUrl,
  parseProxyUrl,
  proxyUrlWithPassword,
  validateProxySettings,
} from "./proxy-config";

test("支持 HTTP、HTTPS、SOCKS4、SOCKS5 和 SOCKS5 别名", () => {
  for (const protocol of ["http", "https", "socks4", "socks5"]) {
    assert.equal(parseProxyUrl(`${protocol}://127.0.0.1:7890`).protocol, `${protocol}:`);
  }
  assert.equal(parseProxyUrl("socks://127.0.0.1:1080").protocol, "socks5:");
});

test("代理密码从持久化地址中移除并可安全还原", () => {
  const parsed = parseProxyUrl("http://user:p%40ss@proxy.example:8080");
  assert.equal(parsed.sanitizedUrl, "http://user@proxy.example:8080");
  assert.equal(parsed.serverUrl, "http://proxy.example:8080");
  assert.equal(parsed.password, "p@ss");
  assert.equal(
    proxyUrlWithPassword(parsed.sanitizedUrl, parsed.password),
    "http://user:p%40ss@proxy.example:8080",
  );
});

test("启用代理时必须填写受支持的纯代理地址", () => {
  assert.throws(() => validateProxySettings({ enabled: true, url: "" }), /必须填写/);
  assert.throws(
    () => validateProxySettings({ enabled: true, url: "ftp://proxy.example:21" }),
    /仅支持/,
  );
  assert.throws(
    () => validateProxySettings({ enabled: true, url: "http://proxy.example:80/path" }),
    /只能包含/,
  );
});

test("识别需要绕过代理的本机地址", () => {
  assert.equal(isLocalNetworkUrl("http://localhost:11434/v1"), true);
  assert.equal(isLocalNetworkUrl("http://127.0.0.1:11434/v1"), true);
  assert.equal(isLocalNetworkUrl("http://[::1]:11434/v1"), true);
  assert.equal(isLocalNetworkUrl("https://api.example.com/v1"), false);
});
