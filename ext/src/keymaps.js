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

  /** Alt+H：切换面板显示；Alt+Up：扩大；Alt+Down：恢复。仅面板已打开时才处理 Alt+Up/Down。 */
  const outlineHotkeyHandler = (ev) => {
    if (ev.isComposing) return;
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const key = String(ev.key || "");
    const lower = key.toLowerCase();
    let type = "";
    if (lower === "h") type = "togglePanel";
    else if (key === "ArrowUp") type = "expandPanel";
    else if (key === "ArrowDown") type = "collapsePanel";
    if (!type) return;
    if (type !== "togglePanel" && !panelOpen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    try {
      window.postMessage({ __dsOutlineCmd: true, type }, "*");
    } catch (e) { /* ignore */ }
  };

  /** 找到聊天输入框：优先找同一容器里有发送按钮的那个 textarea。 */
  const findComposer = () => {
    const textareas = document.querySelectorAll("textarea");
    for (const ta of textareas) {
      if (ta.readOnly || ta.disabled) continue;
      if (sendButtonOf(ta)) return ta;
    }
    for (const ta of textareas) {
      if (ta.readOnly || ta.disabled) continue;
      if (ta.offsetParent !== null) return ta;
    }
    return null;
  };

  /** Ctrl+/：把焦点移到聊天输入框，光标放到末尾。 */
  const focusComposer = () => {
    const ta = findComposer();
    if (!ta) return false;
    try {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    } catch (e) { /* ignore */ }
    return true;
  };

  /** Ctrl+Alt+U：打开上传文件对话框。
   *  优先触发聊天输入区附近的隐藏 <input type="file">；找不到再按 aria-label/title 找上传按钮。 */
  const openUploadDialog = () => {
    const composer = findComposer();
    let inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((i) => !i.disabled);
    if (inputs.length) {
      if (composer) {
        let el = composer;
        for (let i = 0; i < 8 && el; i += 1) {
          const found = inputs.filter((inp) => el.contains(inp));
          if (found.length) { inputs = found; break; }
          el = el.parentElement;
        }
      }
      try { inputs[0].click(); return true; } catch (e) { /* 走下面的兜底 */ }
    }
    const keywords = /上传|附件|文件|attach|upload|file/i;
    const candidates = document.querySelectorAll('[role="button"], button');
    for (const btn of candidates) {
      const label = (btn.getAttribute("aria-label") || "") + " " +
        (btn.getAttribute("title") || "") + " " + (btn.textContent || "");
      if (!keywords.test(label)) continue;
      if (/发送|send/i.test(label)) continue;
      try { btn.click(); return true; } catch (e) { /* ignore */ }
    }
    return false;
  };

  /** 「朗读 / 停止朗读」按钮：页面用 aria-label 标注（同时 role="button"）。
   *  优先点"停止朗读"（正在播放时出现），没有则点最后一个"朗读"。
   *  这样一次调用就能开启 / 关闭语音播报。 */
  const VOICE_STOP_SELECTOR = '[role="button"][aria-label="停止朗读"]';
  const VOICE_START_SELECTOR = '[role="button"][aria-label="朗读"]';
  const VOICE_START_FALLBACK = '[role="button"][aria-label*="朗读"]';

  /** 有"停止朗读"就点它，否则点页面上最后一个"朗读"按钮。
   *  都找不到返回 false，交给页面自己处理。 */
  const triggerLastVoicePlayback = () => {
    const stops = document.querySelectorAll(VOICE_STOP_SELECTOR);
    if (stops.length) {
      stops[stops.length - 1].click();
      return true;
    }
    let list = Array.from(document.querySelectorAll(VOICE_START_SELECTOR));
    if (!list.length) list = Array.from(document.querySelectorAll(VOICE_START_FALLBACK));
    if (!list.length) return false;
    const target = list[list.length - 1];
    if (!target) return false;
    target.click();
    return true;
  };

  /** Ctrl+/ 聚焦输入框；Ctrl+Alt+U 打开上传文件对话框。 */
  const composerShortcutHandler = (ev) => {
    if (ev.isComposing) return;
    if (ev.key === "/" || ev.code === "Slash") {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      if (!focusComposer()) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      return;
    }
    if (ev.ctrlKey && ev.altKey && !ev.shiftKey && String(ev.key).toLowerCase() === "u") {
      if (!openUploadDialog()) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      return;
    }
    if (ev.ctrlKey && ev.altKey && !ev.shiftKey &&
        (ev.code === "KeyP" || String(ev.key).toLowerCase() === "p")) {
      if (ev.repeat) return;
      if (!triggerLastVoicePlayback()) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }
  };

  // window 捕获 + document 捕获都装：谁先到都拦得住，也不依赖注册顺序
  window.addEventListener("keydown", handler, true);
  document.addEventListener("keydown", handler, true);
  window.addEventListener("keydown", outlineShortcutHandler, true);
  document.addEventListener("keydown", outlineShortcutHandler, true);
  window.addEventListener("keydown", outlineHotkeyHandler, true);
  document.addEventListener("keydown", outlineHotkeyHandler, true);
  window.addEventListener("keydown", composerShortcutHandler, true);
  document.addEventListener("keydown", composerShortcutHandler, true);

  window.__dsKeymaps = { enabled, TOGGLE_KEY, sendButtonOf };
})();
