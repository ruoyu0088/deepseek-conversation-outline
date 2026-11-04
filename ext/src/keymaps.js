/*
 * 输入框键盘行为：Enter 换行，Ctrl/Cmd + Enter 发送。
 *
 * 为什么单独一个文件、且在 document_start 加载：
 * DeepSeek 自己的 Enter 提交处理器在 React 的事件系统里（注册得比 content script 晚），
 * 只有比它更早注册、并在**捕获阶段**抢到事件，才能阻止它提交。
 *
 * DeepSeek 的输入框是一个受控 <textarea>（placeholder 随语言变化，class 是哈希值），
 * 发送按钮是它旁边那个 div[role="button"].ds-button--primary.ds-button--circle ——
 * 这里都用"结构性"选择器找，不依赖哈希类名。
 */
(() => {
  "use strict";
  if (window.__dsKeymapsInstalled) return;
  window.__dsKeymapsInstalled = true;

  const TOGGLE_KEY = "ds-outline:enter-newline";
  const PRIMARY_BTN = '[role="button"].ds-button--primary';

  const enabled = () => {
    try {
      return window.localStorage.getItem(TOGGLE_KEY) !== "0";
    } catch (e) {
      return true;   // 读不到存储时按"开启"处理（这是用户明确要求的行为）
    }
  };

  /** 从 textarea 往上找"发送按钮所在的那层"，确认这是聊天输入框而不是别的输入框。 */
  const sendButtonOf = (textarea) => {
    let el = textarea;
    for (let i = 0; i < 6 && el; i += 1) {
      el = el.parentElement;
      if (!el) return null;
      const buttons = el.querySelectorAll(PRIMARY_BTN);
      if (buttons.length) return buttons[buttons.length - 1];
    }
    return null;
  };

  /** 输入框：必须是 textarea，且同一容器里存在发送按钮。 */
  const composerOf = (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return null;
    const ta = t.closest("textarea");
    if (!ta || ta.readOnly || ta.disabled) return null;
    return sendButtonOf(ta) ? ta : null;
  };

  const isDisabled = (btn) => !btn || btn.classList.contains("ds-button--disabled") ||
    btn.getAttribute("aria-disabled") === "true";

  /** 换行：DeepSeek 的 textarea 是 React 受控组件，所以必须
   *  "用原型上的 value setter 改值 + 派发 input 事件"——直接改 .value 或派发合成的
   *  Shift+Enter 都进不了 React 的状态（实测：execCommand 改了 DOM，但发送时正文里没有换行）。
   *  兜底用 execCommand('insertText')，再不行就放弃（保持页面原行为不破坏）。 */
  const insertNewline = (textarea) => {
    const before = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, before.slice(0, start) + "\n" + before.slice(end));
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const caret = start + 1;
      textarea.selectionStart = caret;
      textarea.selectionEnd = caret;
      if (textarea.value !== before) {
        record("native-setter", before, textarea.value);
        return true;
      }
    } catch (e) { /* 走下面的兜底 */ }

    try {
      textarea.setSelectionRange(start, end);
      const ok = document.execCommand("insertText", false, "\n");
      record("execCommand", before, textarea.value);
      return !!ok && textarea.value !== before;
    } catch (e) {
      record("failed", before, textarea.value);
      return false;
    }
  };

  /** 发送：点页面自己的发送按钮，避免伪造事件被它忽略。 */
  const submit = (textarea) => {
    const btn = sendButtonOf(textarea);
    if (isDisabled(btn)) return false;
    btn.click();
    record("submit", textarea.value, textarea.value);
    return true;
  };

  const record = (last, before, after) => {
    try {
      window.__dsKeymapsState = { last, at: Date.now(), before: before.length, after: after.length };
    } catch (e) { /* ignore */ }
  };

  const handler = (ev) => {
    if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;   // 输入法组字中不干预
    if (!enabled()) return;
    const composer = composerOf(ev);
    if (!composer) return;

    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      submit(composer);
      return;
    }
    if (ev.shiftKey || ev.altKey) return;   // Shift/Alt + Enter 本来就换行，交给页面自己处理

    // 单独的 Enter → 换行（不让页面提交）
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    insertNewline(composer);
  };

  const PANEL_KEY = "ds-outline:panel-open";

  const panelOpen = () => {
    try {
      return window.localStorage.getItem(PANEL_KEY) === "1";
    } catch (e) {
      return false;
    }
  };

  /** 面板打开时，Ctrl/Cmd+K 交给对话大纲（聚焦搜索框），并阻止 DeepSeek 自带的搜索。 */
  const outlineShortcutHandler = (ev) => {
    if (ev.isComposing) return;
    if (!(ev.ctrlKey || ev.metaKey)) return;
    if (String(ev.key).toLowerCase() !== "k") return;
    if (!panelOpen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    try {
      window.postMessage({ __dsOutlineCmd: true, type: "focusSearch" }, "*");
    } catch (e) { /* ignore */ }
  };

  // window 捕获 + document 捕获都装：谁先到都拦得住，也不依赖注册顺序
  window.addEventListener("keydown", handler, true);
  document.addEventListener("keydown", handler, true);
  window.addEventListener("keydown", outlineShortcutHandler, true);
  document.addEventListener("keydown", outlineShortcutHandler, true);

  window.__dsKeymaps = { enabled, TOGGLE_KEY, sendButtonOf };
})();
