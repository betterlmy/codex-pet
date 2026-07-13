import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export function fetchWithAgent(
  input: string | URL,
  init: RequestInit | undefined,
  agent: http.Agent,
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error("模型地址仅支持 HTTP 或 HTTPS"));
  }
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: init?.method ?? "GET",
        headers,
        agent,
        signal: init?.signal ?? undefined,
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.once("error", reject);
    writeRequestBody(request, init?.body);
  });
}

function writeRequestBody(request: http.ClientRequest, body: BodyInit | null | undefined): void {
  if (body === null || body === undefined) {
    request.end();
    return;
  }
  if (typeof body === "string" || body instanceof Uint8Array) {
    request.end(body);
    return;
  }
  if (body instanceof URLSearchParams) {
    request.end(body.toString());
    return;
  }
  request.destroy(new Error("当前请求体类型不受代理客户端支持"));
}
