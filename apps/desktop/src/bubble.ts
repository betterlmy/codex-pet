(() => {
type SelectionMethod = "uiAutomation" | "clipboardCopy" | "primarySelection";

type AssistantBubbleEvent =
  | { type: "capturing"; requestId: number; actionName: string }
  | {
      type: "streaming";
      requestId: number;
      actionName: string;
      selectionMethod: SelectionMethod;
    }
  | { type: "delta"; requestId: number; delta: string }
  | { type: "complete"; requestId: number; result: string; autoCopied: boolean }
  | { type: "error"; requestId: number | null; message: string };

const bubble = requiredElement<HTMLElement>("bubble");
const actionName = requiredElement<HTMLElement>("action-name");
const status = requiredElement<HTMLElement>("status");
const output = requiredElement<HTMLElement>("output");
const methodLabel = requiredElement<HTMLElement>("method-label");
const retryButton = requiredElement<HTMLButtonElement>("retry-button");
const copyButton = requiredElement<HTMLButtonElement>("copy-button");
const closeButton = requiredElement<HTMLButtonElement>("close-button");

let requestId: number | null = null;
let canRetry = false;

const dispose = window.assistantBubble.onEvent(handleEvent);
window.assistantBubble.ready();

copyButton.addEventListener("click", async () => {
  try {
    await window.assistantBubble.copy();
    methodLabel.textContent = "结果已复制";
    copyButton.textContent = "COPIED";
  } catch (error) {
    showLocalError(error);
  }
});

retryButton.addEventListener("click", async () => {
  try {
    await window.assistantBubble.retry();
  } catch (error) {
    showLocalError(error);
  }
});

closeButton.addEventListener("click", () => void window.assistantBubble.close());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void window.assistantBubble.close();
});
window.addEventListener("beforeunload", dispose);

function handleEvent(event: AssistantBubbleEvent): void {
  if (event.type === "capturing") {
    requestId = event.requestId;
    canRetry = false;
    bubble.dataset.state = "capturing";
    actionName.textContent = event.actionName;
    status.textContent = "CAPTURING / 获取选中文本";
    output.textContent = "正在从当前页面读取选中的文本…";
    methodLabel.textContent = "等待信号";
    setButtons(false, false);
    return;
  }
  if (event.type === "streaming") {
    requestId = event.requestId;
    canRetry = true;
    bubble.dataset.state = "streaming";
    actionName.textContent = event.actionName;
    status.textContent = "STREAMING / 模型生成中";
    output.textContent = "";
    methodLabel.textContent = methodName(event.selectionMethod);
    setButtons(false, false);
    return;
  }
  if (event.type === "delta") {
    if (event.requestId !== requestId) return;
    output.textContent += event.delta;
    output.scrollTop = output.scrollHeight;
    return;
  }
  if (event.type === "complete") {
    if (event.requestId !== requestId) return;
    bubble.dataset.state = "complete";
    status.textContent = "COMPLETE / 信号接收完成";
    output.textContent = event.result;
    methodLabel.textContent = event.autoCopied ? "结果已自动复制" : "结果仅保存在当前气泡";
    setButtons(true, true);
    return;
  }
  if (event.requestId !== null && requestId !== null && event.requestId !== requestId) return;
  bubble.dataset.state = "error";
  status.textContent = "ERROR / 请求中断";
  output.textContent = event.message;
  methodLabel.textContent = "未发送或请求失败";
  setButtons(canRetry, false);
}

function setButtons(retry: boolean, copy: boolean): void {
  retryButton.disabled = !retry;
  copyButton.disabled = !copy;
  retryButton.textContent = "RETRY";
  copyButton.textContent = "COPY";
}

function methodName(method: SelectionMethod): string {
  if (method === "uiAutomation") return "选区来源 / WINDOWS UIA";
  if (method === "clipboardCopy") return "选区来源 / CTRL+C FALLBACK";
  return "选区来源 / LINUX SELECTION";
}

function showLocalError(error: unknown): void {
  bubble.dataset.state = "error";
  status.textContent = "ERROR / 操作失败";
  output.textContent = error instanceof Error ? error.message : String(error);
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素 #${id}`);
  return element as T;
}
})();
