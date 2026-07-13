import assert from "node:assert/strict";
import test from "node:test";

import { parseSseEvent, streamChatCompletion } from "./openai-client";
import { defaultAssistantSettings } from "./assistant-config";

test("解析 OpenAI 兼容流式增量", () => {
  assert.equal(
    parseSseEvent('data: {"choices":[{"delta":{"content":"你好"}}]}'),
    "你好",
  );
});

test("忽略流结束标记和无文本增量", () => {
  assert.equal(parseSseEvent("data: [DONE]"), null);
  assert.equal(parseSseEvent('data: {"choices":[{"delta":{}}]}'), null);
});

test("拒绝损坏的流式事件", () => {
  assert.throws(() => parseSseEvent("data: not-json"), /无法解析/);
});

test("发送 OpenAI 兼容请求并拼接流式结果", async () => {
  let requestBody: unknown;
  const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      [
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const deltas: string[] = [];
  const settings = defaultAssistantSettings();
  const result = await streamChatCompletion({
    settings,
    action: settings.actions[0],
    input: "hello",
    apiKey: "secret",
    signal: new AbortController().signal,
    fetchImpl,
    onDelta: (delta) => deltas.push(delta),
  });
  assert.equal(result, "你好");
  assert.deepEqual(deltas, ["你", "好"]);
  assert.match(JSON.stringify(requestBody), /hello/);
});
