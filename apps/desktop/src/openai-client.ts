import { chatCompletionsUrl, renderUserPrompt } from "./assistant-config";
import type { FetchImplementation } from "./proxy-fetch";
import type { AssistantSettings, PromptAction } from "./types";

const MAX_MODEL_OUTPUT_CHARS = 100_000;

interface StreamOptions {
  settings: AssistantSettings;
  action: PromptAction;
  input: string;
  apiKey: string | null;
  signal: AbortSignal;
  fetchImpl?: FetchImplementation;
  onDelta(delta: string): void;
}

export async function streamChatCompletion(options: StreamOptions): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const response = await (options.fetchImpl ?? globalThis.fetch)(
    chatCompletionsUrl(options.settings.baseUrl),
    {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.settings.model,
      stream: true,
      messages: [
        { role: "system", content: options.action.systemPrompt },
        { role: "user", content: renderUserPrompt(options.action.userPrompt, options.input) },
      ],
    }),
    signal: options.signal,
    },
  );
  if (!response.ok) throw new Error(await responseError(response));

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const content = messageContent((await response.json()) as unknown);
    if (!content) throw new Error("模型响应中没有文本内容");
    options.onDelta(content);
    return content;
  }
  if (!response.body) throw new Error("模型服务没有返回响应体");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const delta = parseSseEvent(event);
      if (delta === null) continue;
      if (result.length + delta.length > MAX_MODEL_OUTPUT_CHARS) {
        throw new Error("模型输出超过 100000 个字符，已停止接收");
      }
      result += delta;
      options.onDelta(delta);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const delta = parseSseEvent(buffer);
    if (delta) {
      if (result.length + delta.length > MAX_MODEL_OUTPUT_CHARS) {
        throw new Error("模型输出超过 100000 个字符，已停止接收");
      }
      result += delta;
      options.onDelta(delta);
    }
  }
  if (!result) throw new Error("模型流式响应中没有文本内容");
  return result;
}

export function parseSseEvent(event: string): string | null {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("无法解析模型流式响应");
  }
  const streamError = (parsed as { error?: { message?: unknown } }).error?.message;
  if (typeof streamError === "string" && streamError.trim()) {
    throw new Error(streamError.trim().slice(0, 500));
  }
  const delta = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta
    ?.content;
  return typeof delta === "string" ? delta : null;
}

async function responseError(response: Response): Promise<string> {
  const fallback = `模型服务请求失败（HTTP ${response.status}）`;
  try {
    const raw = await response.text();
    const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === "string" && message.trim() ? message.trim().slice(0, 500) : fallback;
  } catch {
    return fallback;
  }
}

function messageContent(value: unknown): string | null {
  const content = (value as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
    ?.content;
  return typeof content === "string" && content ? content : null;
}
