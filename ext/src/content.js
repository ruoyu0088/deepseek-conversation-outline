/*
 * DeepSeek 对话大纲 — 界面与逻辑（隔离世界）
 *
 * 数据来源两条：
 *   a) hook.js 截获的前端 JSON（打开会话时它自己请求到的那份）
 *   b) 打开面板时按需重取一次完整历史（同一接口，只读 GET），用于"页面用了 IndexedDB 缓存、
 *      没再发请求"的情况
 * 之后把消息整理成「提问 → 回答」的轮次，渲染可搜索的大纲，并可导出单文件 HTML。
 */
(() => {
  "use strict";
  if (window.__dsOutlineUI) return;
  window.__dsOutlineUI = true;

  const MD = window.__dsMarkdown;
  const STYLES = window.__dsStyles;
  const P = window.__dsParse;
  const I18N = window.__dsI18n;
  const t = I18N.t;

  const state = {
    sessionId: null,
    byConv: new Map(),      // sessionId -> Map(message_id -> message)
    titles: new Map(),      // sessionId -> title
    turns: [],
    visible: [],
    selected: 0,
    query: "",
    currentMatch: 0,
    matchMarks: [],
    includeThinking: true,  // 搜索是否覆盖"深度思考"
    loading: false,
    error: "",
    pending: null
  };

  /** 附件内容缓存：key 为 fileId（优先）或完整 URL 或文件名。 */
  const fileCache = new Map();
  /** 正在进行的附件请求：requestId -> {resolve, reject, timer}。 */
  const filePending = new Map();
  /** 页面自己请求过的附件 URL：fileId -> 带签名的完整 URL。 */
  const fileUrlCache = new Map();
  let fileReqSeq = 0;

  /** 通过 MAIN-world 的 hook 请求附件内容（避开隔离世界的跨域限制）。 */
  function requestFileContent(opt) {
    return new Promise((resolve, reject) => {
      const requestId = "f" + (++fileReqSeq).toString(36) + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        filePending.delete(requestId);
        reject(new Error(t("requestTimeout")));
      }, 30000);
      filePending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        __dsOutlineReq: true, action: "fetchFile",
        requestId, url: opt && opt.url, fileId: opt && opt.fileId
      }, "*");
    });
  }

  const sessionIdFromPath = () => {
    const m = /^\/a\/chat\/s\/([0-9a-fA-F-]{36})/.exec(location.pathname);
    return m ? m[1] : null;
  };

  const truncate = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text);

  /** 把 parse.js 生成的中文占位标记换成当前语言的文案（只在显示层用，搜索索引保持原样）。 */
  const displayQ = (text) => String(text == null ? "" : text)
    .replace(/\[附件\]/g, t("attachment"))
    .replace(/\[图片\]/g, t("image"))
    .replace(/（无文字提问）/g, t("noTextQuestion"))
    .replace(/（对话开始）/g, t("conversationStart"));

  /** 复制用的 Markdown：去掉联网检索的 `[reference:N]` 角标（那是渲染用的记号，纯文本里只是噪音）。 */
  const copyableMd = (s) => String(s == null ? "" : s).replace(/\[reference:\d+\]/g, "").replace(/[ \t]+$/gm, "");

  /** 提问框里显示的文字。带附件的提问：消息里的 "[附件] xxx" 行不重复显示（附件有单独的可点文件名），
   *  只有附件没有文字时返回空串（面板里连框一起隐藏）。 */
  const qTextOf = (turn) => {
    const qt = turn.qText != null ? turn.qText : "";
    if (qt) return qt;
    return turn.attachments && turn.attachments.length ? "" : turn.q;
  };

  /* ------------------------------------------------------------ 代码高亮 */
  const PRISM = window.Prism;
  const LANG_ALIAS = window.__dsLangAlias || {};
  const SKIP_LANGS = window.__dsSkipLangs || {};

  /** 把围栏上写的语言名规整成 Prism 已注册的名字；返回 "" 表示不高亮。 */
  function normalizeLang(raw) {
    const first = String(raw || "").trim().toLowerCase().split(/[\s:,]+/)[0];
    if (!first) return "";
    const mapped = LANG_ALIAS[first] || first;
    if (SKIP_LANGS[mapped]) return "";
    return PRISM && PRISM.languages[mapped] ? mapped : "";
  }

  function highlightCode(root) {
    if (!PRISM || typeof PRISM.highlight !== "function" || !root) return 0;
    const blocks = root.querySelectorAll("pre > code");
    let done = 0;
    for (const block of blocks) {
      try {
        const pre = block.parentNode;
        const raw = (pre && pre.getAttribute("data-lang")) ||
          ((/language-([\w+#.-]+)/.exec(block.className || "") || [])[1] || "");
        const lang = normalizeLang(raw);
        if (lang) {
          block.innerHTML = PRISM.highlight(block.textContent, PRISM.languages[lang], lang);
          block.setAttribute("data-lang", lang);
          done += 1;
        }
      } catch (e) { /* 高亮失败就保持原始文本 */ }
    }
    return done;
  }

  /** 把文本写进剪贴板；失败时退化为"选中 fallbackEl（默认该代码块）的文本"，让用户按 Ctrl+C。
   *  按钮文案会短暂变成"已复制"，1.6 秒后恢复成 btn.__label（默认"复制"）。 */
  function copyText(text, btn, fallbackEl) {
    const label = (btn && btn.__label) || t("copy");
    const flash = (msg, ok) => {
      if (!btn) return;
      btn.textContent = msg;
      btn.classList.toggle("ok", !!ok);
      clearTimeout(btn.__dsTimer);
      btn.__dsTimer = setTimeout(() => { btn.textContent = label; btn.classList.remove("ok"); }, 1600);
    };
    const legacy = () => {
      try {
        const el = fallbackEl || (btn && btn.closest(".ho-code") && btn.closest(".ho-code").querySelector("pre"));
        if (!el) { flash(t("copyFailed"), false); return; }
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand("copy");
        flash(ok ? t("copied") : t("selectCopy"), ok);
      } catch (e) {
        flash(t("copyFailed"), false);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash(t("copied"), true)).catch(legacy);
    } else {
      legacy();
    }
  }

  /** 给每个代码块套上"语言名 + 复制按钮"的头部。 */
  function decorateCodeBlocks(root) {
    if (!root) return 0;
    let n = 0;
    for (const pre of root.querySelectorAll("pre")) {
      if (pre.parentElement && pre.parentElement.classList.contains("ho-code")) continue;
      if (!pre.querySelector("code")) continue;
      const wrap = document.createElement("div");
      wrap.className = "ho-code";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const head = document.createElement("div");
      head.className = "ho-code-head";
      const lang = document.createElement("span");
      lang.className = "ho-code-lang";
      lang.textContent = pre.getAttribute("data-lang") || t("codeFallback");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ho-code-copy";
      btn.textContent = t("copy");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        copyText(pre.innerText || pre.textContent || "", btn);
      });
      head.appendChild(lang);
      head.appendChild(btn);
      wrap.insertBefore(head, pre);
      n += 1;
    }
    return n;
  }

  /* ------------------------------------------------------------- 数据整理 */
  function rebuildTurns() {
    const bucket = state.byConv.get(state.sessionId);
    state.turns = P.buildTurns(bucket ? Array.from(bucket.values()) : []);
    if (state.selected >= state.turns.length) state.selected = Math.max(0, state.turns.length - 1);
  }

  function mergeMessages(sessionId, messages, title) {
    if (!sessionId || !Array.isArray(messages)) return;
    let bucket = state.byConv.get(sessionId);
    if (!bucket) { bucket = new Map(); state.byConv.set(sessionId, bucket); }
    for (const m of messages) {
      if (m && m.message_id != null) bucket.set(m.message_id, m);
    }
    if (title && !state.titles.get(sessionId)) state.titles.set(sessionId, title);
    if (sessionId === state.sessionId) rebuildTurns();
  }

  const currentTitle = () => state.titles.get(state.sessionId) ||
    (document.title || "").replace(/\s*[-|]\s*DeepSeek\s*$/i, "").trim() || t("conversationFallback");

  /* ---------------------------------------------------------------- 样式 */
  function pageIsLight() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "";
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
      if (!m) return false;
      const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
      return lum > 160;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ UI */
  let ui = null;
  let expanded = false;

  function mount() {
    try { localStorage.setItem("ds-outline:panel-open", "0"); } catch (e) { /* ignore */ }
    const host = document.createElement("div");
    host.id = "ds-outline-host";
    host.style.cssText = "all:initial;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES.base;
    const root = document.createElement("div");
    root.className = "ho-root" + (pageIsLight() ? " ho-light" : "");
    root.innerHTML = `
      <button class="ho-fab" type="button" title="${t("fabTitle")}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h9"></path>
        </svg>
      </button>
      <div class="ho-panel" hidden>
        <div class="ho-head">
          <div class="ho-title"><span class="ho-title-text"></span> <span class="ho-count"></span></div>
          <input class="ho-search" type="search" autocomplete="off">
          <label class="ho-toggle">
            <input type="checkbox" class="ho-enter-toggle"> <span class="ho-enter-text"></span>
          </label>
          <label class="ho-toggle">
            <input type="checkbox" class="ho-think-toggle"> <span class="ho-think-text"></span>
          </label>
          <select class="ho-lang">
            <option value="auto"></option>
            <option value="zh"></option>
            <option value="en"></option>
          </select>
          <button class="ho-btn primary ho-download" type="button"></button>
          <button class="ho-btn ho-close" type="button"></button>
        </div>
        <div class="ho-body">
          <ul class="ho-list"></ul>
          <div class="ho-detail"></div>
        </div>
      </div>`;
    shadow.append(style, root);
    document.documentElement.appendChild(host);

    const $ = (sel) => root.querySelector(sel);
    ui = {
      host, root, shadow,
      fab: $(".ho-fab"), panel: $(".ho-panel"), list: $(".ho-list"), detail: $(".ho-detail"),
      search: $(".ho-search"), count: $(".ho-count"), close: $(".ho-close"), download: $(".ho-download"),
      enterToggle: $(".ho-enter-toggle"), thinkToggle: $(".ho-think-toggle"),
      titleText: $(".ho-title-text"), enterText: $(".ho-enter-text"), thinkText: $(".ho-think-text"),
      lang: $(".ho-lang")
    };

    try { expanded = localStorage.getItem("ds-outline:panel-expanded") === "1"; } catch (e) { expanded = false; }
    ui.panel.classList.toggle("ho-max", expanded);

    // "Enter 换行"开关：真正的键盘接管在 src/keymaps.js（document_start 加载），
    // 这里只负责读写同一个 localStorage 开关。
    const ENTER_KEY = "ds-outline:enter-newline";
    const THINK_KEY = "ds-outline:search-thinking";
    const readBool = (key, fallback) => {
      try { const v = localStorage.getItem(key); return v == null ? fallback : v !== "0"; } catch (e) { return fallback; }
    };
    ui.enterToggle.checked = readBool(ENTER_KEY, true);
    ui.enterToggle.addEventListener("change", () => {
      try { localStorage.setItem(ENTER_KEY, ui.enterToggle.checked ? "1" : "0"); } catch (e) { /* ignore */ }
    });
    state.includeThinking = readBool(THINK_KEY, true);
    ui.thinkToggle.checked = state.includeThinking;
    ui.thinkToggle.addEventListener("change", () => {
      state.includeThinking = ui.thinkToggle.checked;
      try { localStorage.setItem(THINK_KEY, state.includeThinking ? "1" : "0"); } catch (e) { /* ignore */ }
      renderList();
      renderDetail();
    });

    ui.lang.value = I18N.readPref();
    ui.lang.addEventListener("change", () => {
      I18N.setLang(ui.lang.value);
      refreshStaticText();
      renderAll();
    });
    refreshStaticText();

    ui.fab.addEventListener("click", open);
    ui.close.addEventListener("click", close);
    ui.download.addEventListener("click", () => exportHtml(true));
    ui.search.addEventListener("input", () => {
      state.query = ui.search.value;
      renderList();
      renderDetail();
      focusMatch(0, true);
    });
    ui.search.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!state.query.trim()) return;
        ev.preventDefault();
        navigateMatch(ev.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (ev.key === "PageDown" || ev.key === "PageUp") {
        ev.preventDefault();
        stepVisibleTurn(ev.key === "PageDown" ? 1 : -1, "first");
      }
    });
    ui.panel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    document.addEventListener("keydown", (ev) => {
      if (!ui.panel.hidden && (ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === "k") {
        ev.preventDefault();
        ev.stopPropagation();
        focusSearch();
        return;
      }
      if (ev.key === "Escape" && !ui.panel.hidden) close();
    }, true);
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d || !d.__dsOutlineCmd) return;
      if (d.type === "focusSearch") focusSearch();
      else if (d.type === "togglePanel") togglePanel();
      else if (d.type === "expandPanel") { if (ui && !ui.panel.hidden) setExpanded(true); }
      else if (d.type === "collapsePanel") { if (ui && !ui.panel.hidden) setExpanded(false); }
    });
  }

  /** 把静态控件的文案刷新成当前语言（语言切换后调用）。 */
  function refreshStaticText() {
    if (!ui) return;
    ui.fab.title = t("fabTitle");
    ui.titleText.textContent = t("appName");
    ui.search.placeholder = t("searchPlaceholder");
    ui.search.title = t("searchFocusTitle");
    ui.enterText.textContent = t("enterNewline");
    ui.enterText.parentElement.title = t("enterNewlineTitle");
    ui.thinkText.textContent = t("searchThinking");
    ui.thinkText.parentElement.title = t("searchThinkingTitle");
    ui.lang.title = t("langTitle");
    if (ui.lang.options[0]) ui.lang.options[0].textContent = t("langAuto");
    if (ui.lang.options[1]) ui.lang.options[1].textContent = t("langZh");
    if (ui.lang.options[2]) ui.lang.options[2].textContent = t("langEn");
    ui.download.textContent = t("downloadHtml");
    ui.close.textContent = t("close");
  }

  function open() {
    ui.panel.hidden = false;
    try { localStorage.setItem("ds-outline:panel-open", "1"); } catch (e) { /* ignore */ }
    ui.search.focus();
    const sessionId = sessionIdFromPath();
    if (sessionId !== state.sessionId) {
      state.sessionId = sessionId;
      state.selected = 0;
      state.error = "";
      rebuildTurns();
    }
    renderAll();
    if (!state.sessionId) {
      state.error = t("needConversation");
      renderAll();
      return;
    }
    requestHistory(state.sessionId);
  }

  function close() {
    ui.panel.hidden = true;
    try { localStorage.setItem("ds-outline:panel-open", "0"); } catch (e) { /* ignore */ }
  }

  function togglePanel() {
    if (!ui) return;
    if (ui.panel.hidden) open();
    else close();
  }

  function setExpanded(on) {
    expanded = !!on;
    if (ui) ui.panel.classList.toggle("ho-max", expanded);
    try { localStorage.setItem("ds-outline:panel-expanded", expanded ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function focusSearch() {
    if (!ui || ui.panel.hidden) return;
    ui.search.focus();
    ui.search.select();
    try { ui.search.setSelectionRange(0, ui.search.value.length); } catch (e) { /* ignore */ }
  }

  function requestHistory(sessionId) {
    state.loading = true;
    state.error = "";
    state.pending = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    window.postMessage({
      __dsOutlineReq: true, action: "fetchHistory",
      sessionId, requestId: state.pending
    }, "*");
    renderAll();
  }

  function renderAll() { renderList(); renderDetail(); }

  /* --------------------------------------------------------------- 左列表 */
  function computeVisible() {
    const raw = state.query.trim();
    // 查询词同样走一遍"去 Markdown"处理，两边口径一致（这样 X_prg 与 **X_prg** 都能搜到）
    const normalized = raw ? (P.searchableText(raw) || raw) : "";
    const q = normalized.toLowerCase();
    const rows = [];
    state.turns.forEach((turn, i) => {
      const qHits = q ? MD.countOccurrences(turn.qSearch != null ? turn.qSearch : turn.q, q) : 0;
      const aHits = q ? (turn.answersSearch || []).reduce((n, a) => n + MD.countOccurrences(a, q), 0) : 0;
      const tHits = (q && state.includeThinking)
        ? (turn.thinkingSearch || []).reduce((n, a) => n + MD.countOccurrences(a, q), 0) : 0;
      const visible = !q || qHits > 0 || aHits > 0 || tHits > 0;
      rows.push({ t: turn, i, qHits, aHits, tHits, visible });
    });
    state.visible = rows.filter((r) => r.visible);
    return { q: raw, rows };
  }

  function renderList() {
    if (!ui) return;
    const { q, rows } = computeVisible();
    const list = ui.list;
    list.textContent = "";

    const shown = rows.filter((r) => r.visible);
    // 页面自己的 history 请求可能比我们的先到：已经有数据就直接显示条数，别一直挂着"读取中…"
    const loading = state.loading && !state.turns.length;
    ui.count.textContent = loading
      ? t("loading")
      : (q ? t("countFiltered", shown.length, state.turns.length) : t("countAll", state.turns.length));

    if (state.error) {
      const li = document.createElement("li");
      li.className = "ho-empty";
      li.textContent = state.error;
      list.appendChild(li);
      return;
    }
    if (!shown.length) {
      const li = document.createElement("li");
      li.className = "ho-empty";
      li.textContent = q ? t("noMatch") : (state.loading ? t("reading") : t("emptyConversation"));
      list.appendChild(li);
      return;
    }
    if (!shown.some((r) => r.i === state.selected)) state.selected = shown[0].i;

    for (const row of shown) {
      const li = document.createElement("li");
      li.className = "ho-item" + (row.i === state.selected ? " active" : "");
      const qDiv = document.createElement("div");
      qDiv.className = "ho-item-q";
      qDiv.innerHTML = '<span class="ho-item-idx">' + (row.i + 1) + "</span>" +
        MD.escapeHtml(truncate(displayQ(row.t.q).replace(/\s+/g, " "), 160));
      if (q) MD.highlightIn(qDiv, q);
      li.appendChild(qDiv);
      if (q && row.qHits === 0 && (row.aHits > 0 || row.tHits > 0)) {
        const parts = [];
        if (row.aHits > 0) parts.push(t("searchHitAnswer", row.aHits));
        if (row.tHits > 0) parts.push(t("searchHitThinking", row.tHits));
        const badge = document.createElement("span");
        badge.className = "ho-badge";
        badge.textContent = parts.join(" · ");
        li.appendChild(badge);
      }
      li.addEventListener("click", () => {
        state.selected = row.i;
        renderList();
        renderDetail();
        if (state.query.trim()) focusMatch(0, true);
      });
      list.appendChild(li);
    }
    ensureActiveVisible();
  }

  function ensureActiveVisible() {
    if (!ui || ui.panel.hidden) return;
    const list = ui.list;
    const active = list.querySelector(".ho-item.active");
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const pad = 8;
    if (itemRect.top < listRect.top + pad) {
      list.scrollTop += itemRect.top - listRect.top - pad;
    } else if (itemRect.bottom > listRect.bottom - pad) {
      list.scrollTop += itemRect.bottom - listRect.bottom + pad;
    }
  }

  /* --------------------------------------------------------- 搜索匹配导航 */
  function refreshMatches() {
    if (!ui) return;
    state.matchMarks = Array.from(ui.detail.querySelectorAll("mark.ho-hit"));
    if (state.currentMatch >= state.matchMarks.length) {
      state.currentMatch = Math.max(0, state.matchMarks.length - 1);
    }
  }

  function setCurrentMatch(index, scroll) {
    const marks = state.matchMarks;
    if (!marks.length) { state.currentMatch = 0; return; }
    const i = Math.max(0, Math.min(marks.length - 1, Number(index) || 0));
    state.currentMatch = i;
    marks.forEach((m, k) => m.classList.toggle("ho-hit-current", k === i));
    if (scroll) scrollMatchIntoView(marks[i]);
  }

  function focusMatch(index, scroll) {
    refreshMatches();
    if (!state.matchMarks.length) return false;
    setCurrentMatch(index, scroll);
    return true;
  }

  /** 面板内部平滑滚动，带"动画没起来就直接跳"的兜底。
   *  窗口被遮挡 / 系统开了减弱动效时，Chrome 的平滑滚动可能一帧都不走
   *  （scrollTo 的 smooth 由合成器驱动），这时直接赋值保证位置正确。 */
  function smoothScroll(pane, top) {
    const target = Math.max(0, top);
    const before = pane.scrollTop;
    try {
      pane.scrollTo({ top: target, behavior: "smooth" });
    } catch (e) {
      pane.scrollTop = target;
      return;
    }
    if (target === before) return;
    setTimeout(() => {
      if (pane.scrollTop === before) pane.scrollTop = target;   // 动画没动 → 直接跳
    }, 220);
  }

  function scrollMatchIntoView(mark) {
    if (!mark || !ui) return;
    const pane = ui.detail;
    const paneRect = pane.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    smoothScroll(pane, pane.scrollTop + (markRect.top - paneRect.top) - pane.clientHeight * 0.3);
  }

  function visiblePos() {
    return state.visible.findIndex((r) => r.i === state.selected);
  }

  function stepVisibleTurn(delta, matchAt) {
    if (!ui || ui.panel.hidden) return false;
    const shown = state.visible;
    if (!shown.length) return false;
    let pos = visiblePos();
    if (pos < 0) pos = 0;
    const next = pos + delta;
    if (next < 0 || next >= shown.length) return false;
    state.selected = shown[next].i;
    renderList();
    renderDetail();
    if (state.query.trim()) {
      focusMatch(matchAt === "last" ? state.matchMarks.length - 1 : 0, true);
    }
    return true;
  }

  function navigateMatch(delta) {
    if (!ui || ui.panel.hidden || !state.query.trim()) return;
    refreshMatches();
    if (!state.matchMarks.length) {
      stepVisibleTurn(delta > 0 ? 1 : -1, delta > 0 ? "first" : "last");
      return;
    }
    const next = state.currentMatch + delta;
    if (next >= 0 && next < state.matchMarks.length) {
      setCurrentMatch(next, true);
      return;
    }
    stepVisibleTurn(delta > 0 ? 1 : -1, delta > 0 ? "first" : "last");
  }

  /* --------------------------------------------------------------- 右详情 */
  /** 联网搜索的 `[reference:N]` 角标 → 可点的小圆标（指向来源 URL）。 */
  function decorateCitations(root, refs) {
    if (!root || !refs || !refs.length) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.indexOf("[reference:") < 0) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest("pre, code")) {
          return NodeFilter.FILTER_REJECT;   // 代码里的字面量不动
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n = walker.nextNode();
    while (n) { targets.push(n); n = walker.nextNode(); }
    let hits = 0;
    for (const node of targets) {
      const text = node.nodeValue;
      const re = /\[reference:(\d+)\]/g;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const idx = Number(m[1]);
        const ref = refs[idx] || null;
        const chip = document.createElement(ref && ref.url ? "a" : "span");
        chip.className = "ho-cite-num";
        chip.textContent = String(idx + 1);
        chip.title = (ref && ref.title) || (ref && ref.url) || t("sourceLabel", idx + 1);
        if (ref && ref.url) {
          chip.href = ref.url;
          chip.target = "_blank";
          chip.rel = "noopener noreferrer";
        }
        frag.appendChild(chip);
        hits += 1;
        last = m.index + m[0].length;
      }
      if (!hits) break;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return hits;
  }

  /** 渲染一段 Markdown（含代码高亮/复制按钮），返回容器。 */
  function proseOf(markdown, refs) {
    const prose = document.createElement("div");
    prose.className = "ho-prose";
    prose.innerHTML = MD.toHtml(markdown);
    highlightCode(prose);
    decorateCodeBlocks(prose);
    if (refs && refs.length) decorateCitations(prose, refs);
    return prose;
  }

  /** 从页面 DOM 找一个附件的下载地址（页面渲染附件时可能带 /api/file 链接）。 */
  function findAttachmentUrlInPage(name) {
    const nodes = document.querySelectorAll('a[href*="/api/file"], img[src*="/api/file"]');
    if (!nodes.length) return "";
    for (const el of nodes) {
      const url = el.getAttribute("href") || el.getAttribute("src") || "";
      if (!url) continue;
      const label = (el.getAttribute("download") || el.getAttribute("alt") || el.textContent || "").trim();
      if (name && label && (label === name || label.indexOf(name) >= 0)) return url;
    }
    if (nodes.length === 1) {
      const el = nodes[0];
      return el.getAttribute("href") || el.getAttribute("src") || "";
    }
    return "";
  }

  /** 一个附件的 UI：文件名按钮 + 隐藏的只读 textarea。
   *  点击时按需请求内容：消息里带正文就直接用，否则依次尝试
   *  a.url → fileUrlCache（页面请求过的 URL）→ 页面 DOM 中的 /api/file 链接 → hook 代为请求。
   *  全都拿不到就显示明确错误，不伪造数据。 */
  function attachmentRow(a) {
    const row = document.createElement("div");
    row.className = "ho-attach";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ho-attach-name";
    btn.textContent = a.isImage ? t("image") + " " + (a.name || "") : (a.name || t("attachment"));
    const sizeText = a.size ? (a.size >= 1024 * 1024 ? (a.size / 1048576).toFixed(1) + " MB" : Math.round(a.size / 1024) + " KB") : "";
    btn.title = t("attachClickTitle", sizeText);
    const view = document.createElement("div");
    view.className = "ho-attach-viewer";
    view.hidden = true;
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.className = "ho-attach-text";
    const img = document.createElement("img");
    img.className = "ho-attach-img";
    img.alt = a.name || "attachment image";
    img.hidden = true;
    const hint = document.createElement("div");
    hint.className = "ho-attach-hint";
    hint.hidden = true;
    let loaded = false;
    let loading = false;

    const showHint = (msg) => {
      hint.hidden = false;
      hint.textContent = msg;
    };

    const showImage = (url) => {
      ta.hidden = true;
      img.hidden = false;
      img.src = url;
      img.onerror = () => {
        img.hidden = true;
        showHint(t("attachImageFailed", url));
      };
      showHint(t("attachImageHint", sizeText));
      hint.hidden = false;
      hint.onclick = () => window.open(url, "_blank", "noopener");
    };

    const fill = (res) => {
      if (res.kind === "image") {
        showImage(res.url || a.url || "");
        return;
      }
      ta.hidden = false;
      ta.value = res.text || "";
      // 长附件直接给个高的框，省得手动拖
      ta.style.height = (ta.value.length > 4000 ? "45vh" : "");
      a.text = ta.value;          // 记住内容：再次展开不用再请求，导出时也能带上
      loaded = true;
      hint.hidden = true;
    };

    btn.addEventListener("click", async () => {
      view.hidden = !view.hidden;
      if (view.hidden || loaded || loading) return;

      // 1) 消息里直接带正文（或这次会话里已经读过，缓存在 a.text）
      if (a.text) {
        ta.hidden = false;
        ta.value = a.text;
        ta.style.height = (a.text.length > 4000 ? "45vh" : "");
        hint.hidden = true;
        loaded = true;
        return;
      }

      // 2) 图片：直接把签名地址交给 <img>，不用为了看 content-type 先抓一遍
      if (a.isImage && a.url) {
        showImage(a.url);
        loaded = true;
        return;
      }

      loading = true;
      btn.disabled = true;
      showHint(t("attachLoading"));
      ta.hidden = true;
      img.hidden = true;
      try {
        const url = a.url || (a.fileId && fileUrlCache.get(a.fileId)) || findAttachmentUrlInPage(a.name) || "";
        const key = a.fileId || url || a.name;
        let res = fileCache.get(key);
        if (!res) {
          res = await requestFileContent({ url, fileId: a.fileId });
          fileCache.set(key, res);
        }
        fill(res);
        loaded = true;
      } catch (err) {
        ta.hidden = true;
        img.hidden = true;
        showHint(t("attachFailed", String((err && err.message) || err)));
      } finally {
        loading = false;
        btn.disabled = false;
      }
    });
    view.appendChild(hint);
    view.appendChild(img);
    view.appendChild(ta);
    row.appendChild(btn);
    row.appendChild(view);
    return row;
  }

  /** 「深度思考」折叠块：默认收起，标题上显示字数与耗时。 */
  function thinkingBlock(answer, expanded, q) {
    const box = document.createElement("div");
    box.className = "ho-think";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "ho-think-head";
    const title = document.createElement("span");
    title.className = "ho-think-title";
    title.textContent = t("thinking");
    const meta = document.createElement("span");
    meta.className = "ho-think-meta";
    const chars = answer.thinking.replace(/\s+/g, "").length;
    const bits = [];
    if (chars) bits.push(t("charsText", chars));
    if (answer.elapsed) bits.push(t("elapsedText", answer.elapsed));
    meta.textContent = bits.join(" · ");
    const arrow = document.createElement("span");
    arrow.className = "ho-think-arrow";
    arrow.textContent = expanded ? "▾" : "▸";
    head.append(title, meta, arrow);

    const body = document.createElement("div");
    body.className = "ho-think-body";
    body.hidden = !expanded;
    body.appendChild(proseOf(answer.thinking));

    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      arrow.textContent = open ? "▾" : "▸";
      box.classList.toggle("open", open);
    });
    if (expanded) box.classList.add("open");
    box.append(head, body);
    return box;
  }

  function renderDetail() {
    if (!ui) return;
    const pane = ui.detail;
    pane.textContent = "";
    state.matchMarks = [];
    state.currentMatch = 0;
    const turn = state.turns[state.selected];
    if (!turn) {
      const empty = document.createElement("div");
      empty.className = "ho-empty";
      empty.textContent = state.error || (state.loading ? t("reading") : t("pickPrompt"));
      pane.appendChild(empty);
      return;
    }

    const q = state.query.trim();
    const qLower = q ? (P.searchableText(q) || q).toLowerCase() : "";
    const answerMd = copyableMd(turn.answers.map((a) => a.text).filter((s) => s && s.trim()).join("\n\n"));

    // 顶部：完整提问（代码框样式）+ 复制提问/复制回答/跳到回答
    const qBox = document.createElement("div");
    qBox.className = "ho-question-box";
    const bar = document.createElement("div");
    bar.className = "ho-question-bar";
    const label = document.createElement("span");
    label.className = "ho-question-label";
    label.textContent = t("questionLabel", state.selected + 1);
    const actions = document.createElement("div");
    actions.className = "ho-question-actions";
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "ho-jump-btn";
    jump.textContent = t("jumpToAnswer");
    jump.addEventListener("click", () => scrollToAnswer(pane));
    actions.appendChild(jump);
    bar.appendChild(label);
    bar.appendChild(actions);
    const qPre = document.createElement("pre");
    qPre.className = "ho-question";
    qPre.textContent = displayQ(qTextOf(turn));
    if (!qPre.textContent) qPre.hidden = true;   // 只有附件、没有文字时不留空框

    const copyQ = document.createElement("button");
    copyQ.type = "button";
    copyQ.className = "ho-copy-btn ho-copy-q";
    copyQ.textContent = t("copyPrompt");
    copyQ.__label = t("copyPrompt");
    copyQ.title = t("copyPromptTitle");
    copyQ.addEventListener("click", () => copyText(turn.q, copyQ, qPre));

    const copyA = document.createElement("button");
    copyA.type = "button";
    copyA.className = "ho-copy-btn ho-copy-a";
    copyA.textContent = t("copyAnswer");
    copyA.__label = t("copyAnswer");
    copyA.title = t("copyAnswerTitle");
    copyA.disabled = !answerMd;
    if (!answerMd) copyA.title = t("noAnswerTitle");

    actions.insertBefore(copyQ, jump);
    actions.insertBefore(copyA, jump);

    qBox.appendChild(bar);
    qBox.appendChild(qPre);
    pane.appendChild(qBox);

    // 附件区：文件名可点击，展开后用一个只读 textarea 显示内容
    if (turn.attachments && turn.attachments.length) {
      const attachBox = document.createElement("div");
      attachBox.className = "ho-attachments";
      for (const a of turn.attachments) attachBox.appendChild(attachmentRow(a));
      pane.appendChild(attachBox);
    }

    // 回答区（复制回答失败时的选中兜底要用到它）
    const answersBox = document.createElement("div");
    answersBox.className = "ho-answers";

    copyA.addEventListener("click", () => {
      if (!answerMd) return;
      copyText(answerMd, copyA, answersBox);
    });
    if (q) MD.highlightIn(qBox, q);

    if (!turn.answers.length) {
      const empty = document.createElement("div");
      empty.className = "ho-empty";
      empty.textContent = t("noAnswerForThis");
      pane.appendChild(empty);
      refreshMatches();
      if (q && state.matchMarks.length) setCurrentMatch(0, false);
      return;
    }

    const mark = document.createElement("div");
    mark.className = "ho-answer-anchor";
    mark.textContent = t("answerLabel", turn.answers.length);
    answersBox.appendChild(mark);

    for (const answer of turn.answers) {
      const wrap = document.createElement("div");
      wrap.className = "ho-msg";
      if (answer.thinking) {
        const thinkHits = qLower && state.includeThinking &&
          MD.countOccurrences(P.searchableText(answer.thinking).toLowerCase(), qLower);
        const expanded = !!(qLower && thinkHits);      // 搜到思考内容时自动展开，否则默认收起
        wrap.appendChild(thinkingBlock(answer, expanded, q));
      }
      if (answer.text) {
        const prose = proseOf(answer.text, answer.refs);
        wrap.appendChild(prose);
        if (q) MD.highlightIn(prose, q);
      }
      answersBox.appendChild(wrap);
    }
    pane.appendChild(answersBox);
    refreshMatches();
    if (q && state.matchMarks.length) setCurrentMatch(0, false);
    pane.scrollTop = 0;
  }

  /** 把详情区滚到回答开头（只滚动面板内部，不动页面） */
  function scrollToAnswer(pane) {
    const anchor = pane.querySelector(".ho-answer-anchor") || pane.querySelector(".ho-msg");
    if (!anchor) return false;
    const paneRect = pane.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const top = pane.scrollTop + (anchorRect.top - paneRect.top) - 8;
    smoothScroll(pane, top);
    return true;
  }

  /* ---------------------------------------------------------------- 导出 */
  const download = (text, filename) => {
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 15000);
  };

  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  };

  const safeName = (s) => (s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "deepseek";

  /** 导出用：渲染一个回答（含代码高亮与复制按钮），返回 HTML 字符串。 */
  function answerHtml(answer) {
    let html = "";
    if (answer.thinking) {
      const chars = answer.thinking.replace(/\s+/g, "").length;
      const bits = [];
      if (chars) bits.push(t("charsText", chars));
      if (answer.elapsed) bits.push(t("elapsedText", answer.elapsed));
      const holder = proseOf(answer.thinking);
      html += '<details class="ho-think"><summary class="ho-think-head">' +
        '<span class="ho-think-title">' + MD.escapeHtml(t("thinking")) + '</span>' +
        '<span class="ho-think-meta">' + MD.escapeHtml(bits.join(" · ")) + "</span></summary>" +
        holder.outerHTML + "</details>";
    }
    if (answer.text) {
      const holder = proseOf(answer.text, answer.refs);
      html += holder.outerHTML;
    }
    return html;
  }

  /** 导出用：把一轮提问的附件渲染成可点击展开的 <details>。
   *  正文只有在网页端点开过这个附件时才有（离线 HTML 里没法再请求签名地址）。 */
  function attachHtmlOf(turn) {
    if (!turn.attachments || !turn.attachments.length) return "";
    const rows = turn.attachments.map((a) => {
      const name = MD.escapeHtml(a.isImage ? t("image") + " " + (a.name || "") : (a.name || t("attachment")));
      const size = a.size ? (a.size >= 1048576 ? (a.size / 1048576).toFixed(1) + " MB" : Math.round(a.size / 1024) + " KB") : "";
      const content = a.text
        ? MD.escapeHtml(a.text)
        : MD.escapeHtml(t("exportUnread") + (a.url || "—") + t("exportUnreadEnd"));
      return '<details class="ho-attach"><summary class="ho-attach-name">' + name +
        (size ? ' <span class="ho-attach-size">' + size + "</span>" : "") + "</summary>" +
        '<textarea readonly class="ho-attach-text">' + content + "</textarea></details>";
    }).join("");
    return '<div class="ho-attachments">' + rows + "</div>";
  }

  const EXPORT_SCRIPT = `
(function () {
  var list = document.getElementById('ho-list');
  var search = document.getElementById('ho-search');
  var empty = document.getElementById('ho-empty');
  var count = document.getElementById('ho-count');
  var panels = [].slice.call(document.querySelectorAll('.ho-panel-data'));
  function stripMarks(el) {
    var marks = el.querySelectorAll('mark');
    for (var i = 0; i < marks.length; i++) {
      marks[i].parentNode.replaceChild(document.createTextNode(marks[i].textContent), marks[i]);
    }
    if (el.normalize) el.normalize();   // 合并被拆碎的相邻文本节点，否则跨节点的词搜不到
  }
  // 跨节点高亮：拼接子树文本后匹配，再用 Range 包裹（单个文本节点 indexOf 会漏掉跨节点的词）
  function highlight(root, needle) {
    var q = String(needle || '').trim();
    if (!q) return 0;
    var lower = q.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.parentNode) return NodeFilter.FILTER_REJECT;
        var t = n.parentNode.nodeName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'MARK') return NodeFilter.FILTER_REJECT;
        if (n.parentNode.closest && n.parentNode.closest('math, .katex, .ho-math-block')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var entries = [], full = '', n;
    while ((n = walker.nextNode())) { entries.push({ node: n, start: full.length }); full += n.nodeValue; }
    if (!full) return 0;
    var hay = full.toLowerCase(), matches = [], pos = 0, idx;
    while ((idx = hay.indexOf(lower, pos)) >= 0) { matches.push([idx, idx + lower.length]); pos = idx + lower.length; }
    if (!matches.length) return 0;
    var hits = 0;
    for (var m = matches.length - 1; m >= 0; m--) {
      for (var i = entries.length - 1; i >= 0; i--) {
        var e = entries[i], nodeStart = e.start, nodeEnd = nodeStart + e.node.nodeValue.length;
        if (nodeEnd <= matches[m][0]) break;
        if (nodeStart >= matches[m][1]) continue;
        var from = Math.max(matches[m][0], nodeStart) - nodeStart;
        var to = Math.min(matches[m][1], nodeEnd) - nodeStart;
        if (to <= from) continue;
        try {
          var range = document.createRange();
          range.setStart(e.node, from);
          range.setEnd(e.node, to);
          var mark = document.createElement('mark');
          range.surroundContents(mark);
          hits++;
        } catch (err) { /* 跳过无法包裹的片段 */ }
      }
    }
    return hits;
  }
  function apply() {
    var q = search.value.trim();
    var shown = 0;
    for (var i = 0; i < list.children.length; i++) {
      var li = list.children[i];
      if (!li.getAttribute('data-i')) continue;
      var panel = document.querySelector('.ho-panel-data[data-i="' + li.getAttribute('data-i') + '"]');
      stripMarks(li); if (panel) stripMarks(panel);
      var hit = !q || li.textContent.toLowerCase().indexOf(q.toLowerCase()) >= 0 ||
                (panel && panel.textContent.toLowerCase().indexOf(q.toLowerCase()) >= 0);
      li.hidden = !hit;
      if (hit) {
        shown++;
        if (q) { highlight(li, q); if (panel) highlight(panel, q); }
      }
      // 搜到「深度思考」里就把折叠块展开，否则收起
      if (panel) {
        var details = panel.querySelectorAll('details.ho-think');
        for (var d = 0; d < details.length; d++) {
          var hitThink = q && details[d].textContent.toLowerCase().indexOf(q.toLowerCase()) >= 0;
          if (hitThink) details[d].setAttribute('open', '');
          else if (!q) details[d].removeAttribute('open');
        }
      }
    }
    empty.hidden = shown > 0;
    count.textContent = q ? shown + ' / ' + panels.length + HO_TEXT.turnSuffix : panels.length + HO_TEXT.turnSuffix;
  }
  function copyText(text, btn, fallbackEl) {
    var label = btn.getAttribute('data-label') || HO_TEXT.copy;
    function flash(msg, ok) {
      btn.textContent = msg;
      btn.classList.toggle('ok', !!ok);
      setTimeout(function () { btn.textContent = label; btn.classList.remove('ok'); }, 1600);
    }
    function fallback() {
      try {
        var box = btn.closest('.ho-code');
        var el = fallbackEl || (box && box.querySelector('pre'));
        if (!el) { flash(HO_TEXT.copyFailed, false); return; }
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = document.execCommand('copy');
        flash(ok ? HO_TEXT.copied : HO_TEXT.selectCopy, ok);
      } catch (e) { flash(HO_TEXT.copyFailed, false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(HO_TEXT.copied, true); }, fallback);
    } else {
      fallback();
    }
  }
  [].forEach.call(document.querySelectorAll('.ho-code-copy'), function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var pre = btn.closest('.ho-code').querySelector('pre');
      copyText(pre ? pre.innerText : '', btn);
    });
  });
  // 复制提问 / 复制回答（答疑：回答复制的是 Markdown 原文，代码围栏与公式都保留）
  [].forEach.call(document.querySelectorAll('.ho-copy-q'), function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var section = btn.closest('.ho-panel-data');
      var pre = section && section.querySelector('.ho-question');
      if (pre) copyText(pre.textContent, btn, pre);
    });
  });
  [].forEach.call(document.querySelectorAll('.ho-copy-a'), function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var section = btn.closest('.ho-panel-data');
      if (!section) return;
      var tpl = section.querySelector('template.ho-src-a');
      var text = tpl ? tpl.content.textContent : '';
      if (!text) text = section.textContent;
      copyText(text, btn, section.querySelector('.ho-msg') || section);
    });
  });
  [].forEach.call(document.querySelectorAll('.ho-jump-btn'), function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var section = btn.closest('.ho-panel-data');
      var anchor = section ? (section.querySelector('.ho-answer-anchor') || section.querySelector('.ho-msg')) : null;
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  list.addEventListener('click', function (ev) {
    var li = ev.target.closest ? ev.target.closest('li[data-i]') : null;
    if (!li) return;
    for (var i = 0; i < list.children.length; i++) list.children[i].classList.remove('active');
    li.classList.add('active');
    var idx = li.getAttribute('data-i');
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute('data-i') !== idx;
    // 换项目时主栏回到顶部：滚动的是页面（主栏不是独立滚动容器），
    // 左侧列表的滚动位置保持不变。
    var detail = document.querySelector('.ho-doc-detail');
    if (detail) detail.scrollTop = 0;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (e) {
      window.scrollTo(0, 0);
    }
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  });
  search.addEventListener('input', apply);
  apply();
})();`;

  function exportHtml(notify) {
    if (!state.turns.length) {
      if (notify) {
        state.error = state.error || t("noExport");
        renderAll();
      }
      return;
    }
    const title = currentTitle();
    const lang = I18N.getLang();
    const css = STYLES.base + STYLES.export;
    const items = state.turns.map((turn, i) =>
      '<li class="ho-item' + (i === 0 ? " active" : "") + '" data-i="' + i + '">' +
      '<div class="ho-item-q"><span class="ho-item-idx">' + (i + 1) + "</span>" +
      MD.escapeHtml(truncate(displayQ(turn.q).replace(/\s+/g, " "), 160)) + "</div>" +
      (turn.answers.length > 1 ? '<span class="ho-badge">' + MD.escapeHtml(t("answerSegments", turn.answers.length)) + "</span>" : "") +
      "</li>").join("\n");
    const panels = state.turns.map((turn, i) => {
      const answerMd = copyableMd(turn.answers.map((a) => a.text).filter((s) => s && s.trim()).join("\n\n"));
      return '<section class="ho-panel-data" data-i="' + i + '"' + (i === 0 ? "" : " hidden") + ">" +
        '<div class="ho-question-box"><div class="ho-question-bar">' +
        '<span class="ho-question-label">' + MD.escapeHtml(t("questionLabel", i + 1)) + "</span>" +
        '<div class="ho-question-actions">' +
        '<button type="button" class="ho-copy-btn ho-copy-q" data-label="' + MD.escapeHtml(t("copyPrompt")) + '">' + MD.escapeHtml(t("copyPrompt")) + '</button>' +
        '<button type="button" class="ho-copy-btn ho-copy-a" data-label="' + MD.escapeHtml(t("copyAnswer")) + '"' +
        (answerMd ? "" : " disabled") + ">" + MD.escapeHtml(t("copyAnswer")) + "</button>" +
        '<button type="button" class="ho-jump-btn">' + MD.escapeHtml(t("jumpToAnswer")) + "</button></div></div>" +
        '<pre class="ho-question"' + (displayQ(qTextOf(turn)) ? "" : ' style="display:none"') + ">" +
        MD.escapeHtml(displayQ(qTextOf(turn))) + "</pre></div>" +
        attachHtmlOf(turn) +
        // 复制回答要用 Markdown 原文（保留代码围栏/公式），把它放进 <template>：
        // template 的内容不会被渲染，textContent 还原出来就是原文。
        '<template class="ho-src-a">' + MD.escapeHtml(answerMd) + "</template>" +
        (turn.answers.length ? '<div class="ho-answer-anchor">' + MD.escapeHtml(t("answerLabel", turn.answers.length)) + "</div>" : "") +
        (turn.answers.length ? turn.answers.map(answerHtml).map((h) => '<div class="ho-msg">' + h + "</div>").join("")
          : '<div class="ho-empty">' + MD.escapeHtml(t("noAnswerForThis")) + "</div>") +
        "</section>";
    }).join("\n");

    const exportText = {
      copy: t("copy"),
      copied: t("copied"),
      copyFailed: t("copyFailed"),
      selectCopy: t("selectCopy"),
      turnSuffix: t("turnSuffix")
    };

    const doc = "<!doctype html>\n<html lang=\"" + (lang === "zh" ? "zh-CN" : "en") + "\">\n<head>\n<meta charset=\"utf-8\">\n" +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      "<title>" + MD.escapeHtml(title) + MD.escapeHtml(t("exportTitleSuffix")) + "</title>\n<style>" + css + "</style>\n</head>\n<body>\n" +
      '<div class="ho-doc-head">\n' +
      '<span class="ho-doc-title">' + MD.escapeHtml(title) + "</span>\n" +
      '<span class="ho-doc-meta" id="ho-count">' + MD.escapeHtml(t("countAll", state.turns.length)) + "</span>\n" +
      '<input class="ho-search" id="ho-search" type="search" placeholder="' + MD.escapeHtml(t("searchPlaceholderShort")) + '" autocomplete="off">\n' +
      '<span class="ho-doc-meta">' + MD.escapeHtml(t("exportFooter", new Date().toLocaleString(lang === "zh" ? "zh-CN" : "en-US"))) + "</span>\n</div>\n" +
      '<div class="ho-doc-main">\n<ul class="ho-list ho-doc-list" id="ho-list">\n' + items + "\n</ul>\n" +
      '<div class="ho-doc-detail">\n<div class="ho-empty" id="ho-empty" hidden>' + MD.escapeHtml(t("noMatch")) + '</div>\n' +
      panels + "\n</div>\n</div>\n" +
      "<script>var HO_TEXT=" + JSON.stringify(exportText) + ";</" + "script>\n" +
      "<script>" + EXPORT_SCRIPT + "</" + "script>\n</body>\n</html>";

    download(doc, safeName(title) + "-" + (lang === "zh" ? "对话大纲" : "outline") + "-" + stamp() + ".html");
  }

  /* ------------------------------------------------------------ 事件接入 */
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || !d.__dsOutline) return;
    if (d.type === "payload") {
      mergeMessages(d.sessionId, d.messages, d.title);
      if (ui && !ui.panel.hidden && d.sessionId === state.sessionId) renderAll();
      return;
    }
    if (d.type === "history") {
      if (d.requestId && state.pending && d.requestId !== state.pending) return;
      state.loading = false;
      state.pending = null;
      if (d.ok) {
        mergeMessages(d.sessionId, d.messages, d.title);
        state.error = "";
      } else {
        state.error = t("readFailed", d.error || t("unknownError"));
      }
      if (ui && !ui.panel.hidden && d.sessionId === state.sessionId) renderAll();
    }
    if (d.type === "file") {
      const p = filePending.get(d.requestId);
      if (!p) return;
      filePending.delete(d.requestId);
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d);
      else p.reject(new Error(d.error || t("unknownError")));
      return;
    }
    if (d.type === "fileurl" && d.fileId && d.url) {
      fileUrlCache.set(d.fileId, d.url);
    }
  });

  // SPA 路由变化：换对话时清空当前视图；面板开着就顺便把新对话的历史取回来
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const sessionId = sessionIdFromPath();
    if (sessionId !== state.sessionId) {
      state.sessionId = sessionId;
      state.selected = 0;
      state.query = "";
      state.error = "";
      rebuildTurns();
      if (!ui) return;
      ui.search.value = "";
      if (ui.panel.hidden) return;
      renderAll();
      if (sessionId) requestHistory(sessionId);
    }
  }, 1000);

  function boot() {
    mount();
    state.sessionId = sessionIdFromPath();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
