import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { ProxyAgent } from "proxy-agent";

import { fetchWithAgent } from "./proxy-fetch";

test("认证 HTTP 代理接收模型请求和代理授权头", async () => {
  let requestUrl = "";
  let proxyAuthorization = "";
  const proxyServer = http.createServer((request, response) => {
    requestUrl = request.url ?? "";
    proxyAuthorization = request.headers["proxy-authorization"] ?? "";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
  const address = proxyServer.address();
  assert.ok(address && typeof address === "object");
  const proxyUrl = `http://user:secret@127.0.0.1:${address.port}`;
  const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });

  try {
    const response = await fetchWithAgent(
      "http://model.example/v1/chat/completions",
      { method: "POST", body: "{}" },
      agent,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(requestUrl, "http://model.example/v1/chat/completions");
    assert.equal(proxyAuthorization, `Basic ${Buffer.from("user:secret").toString("base64")}`);
  } finally {
    agent.destroy();
    await new Promise<void>((resolve, reject) =>
      proxyServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
