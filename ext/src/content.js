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

  const state = {
    sessionId: null,
    byConv: new Map(),      // sessionId -> Map(message_id -> message)
    titles: new Map(),      // sessionId -> title
    turns: [],
    visible: [],
    selected: 0,
    query: "",
    includeThinking: true,  // 搜索是否覆盖"深度思考"
    loading: false,
    error: "",
    pending: null
  };

  const sessionIdFromPath = () => {
    const m = /^\/a\/chat\/s\/([0-9a-fA-F-]{36})/.exec(location.pathname);
    return m ? m[1] : null;
  };

  const truncate = (text, n) => (text.length > n ? text.slice(0, n) + "…" : text);

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

  /** 把文本写进剪贴板；失败时退化为"选中文本"，让用户按 Ctrl+C。 */
  function copyText(text, btn) {
    const flash = (msg, ok) => {
      if (!btn) return;
      btn.textContent = msg;
      btn.classList.toggle("ok", !!ok);
      clearTimeout(btn.__dsTimer);
      btn.__dsTimer = setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("ok"); }, 1600);
    };
    const legacy = () => {
      try {
        const pre = btn.closest(".ho-code").querySelector("pre");
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand("copy");
        flash(ok ? "已复制" : "已选中，请按 Ctrl+C", ok);
      } catch (e) {
        flash("复制失败", false);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash("已复制", true)).catch(legacy);
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
      lang.textContent = pre.getAttribute("data-lang") || "代码";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ho-code-copy";
      btn.textContent = "复制";
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
    (document.title || "").replace(/\s*[-|]\s*DeepSeek\s*$/i, "").trim() || "DeepSeek 对话";

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

  function mount() {
    const host = document.createElement("div");
    host.id = "ds-outline-host";
    host.style.cssText = "all:initial;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES.base;
    const root = document.createElement("div");
    root.className = "ho-root" + (pageIsLight() ? " ho-light" : "");
    root.innerHTML = `
      <button class="ho-fab" type="button" title="对话大纲：列出本对话的全部提问与回答">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h9"></path>
        </svg>
      </button>
      <div class="ho-panel" hidden>
        <div class="ho-head">
          <div class="ho-title">对话大纲 <span class="ho-count"></span></div>
          <input class="ho-search" type="search" placeholder="搜索提问和回答…" autocomplete="off">
          <label class="ho-toggle" title="勾选后：Enter 换行，Ctrl+Enter 发送">
            <input type="checkbox" class="ho-enter-toggle"> Enter 换行
          </label>
          <label class="ho-toggle" title="搜索时是否也匹配「深度思考」里的内容">
            <input type="checkbox" class="ho-think-toggle"> 搜索含思考
          </label>
          <button class="ho-btn primary ho-download" type="button">下载 HTML</button>
          <button class="ho-btn ho-close" type="button">关闭</button>
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
      enterToggle: $(".ho-enter-toggle"), thinkToggle: $(".ho-think-toggle")
    };

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

    ui.fab.addEventListener("click", open);
    ui.close.addEventListener("click", close);
    ui.download.addEventListener("click", () => exportHtml(true));
    ui.search.addEventListener("input", () => {
      state.query = ui.search.value;
      renderList();
      renderDetail();
    });
    ui.panel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !ui.panel.hidden) close();
    });
  }

  function open() {
    ui.panel.hidden = false;
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
      state.error = "请先打开一个对话（地址形如 /a/chat/s/…）再点这个按钮。";
      renderAll();
      return;
    }
    requestHistory(state.sessionId);
  }

  function close() { ui.panel.hidden = true; }

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
    state.turns.forEach((t, i) => {
      const qHits = q ? MD.countOccurrences(t.qSearch != null ? t.qSearch : t.q, q) : 0;
      const aHits = q ? (t.answersSearch || []).reduce((n, a) => n + MD.countOccurrences(a, q), 0) : 0;
      const tHits = (q && state.includeThinking)
        ? (t.thinkingSearch || []).reduce((n, a) => n + MD.countOccurrences(a, q), 0) : 0;
      const visible = !q || qHits > 0 || aHits > 0 || tHits > 0;
      rows.push({ t, i, qHits, aHits, tHits, visible });
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
    ui.count.textContent = state.loading
      ? "读取中…"
      : (q ? shown.length + " / " + state.turns.length + " 条" : state.turns.length + " 条");

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
      li.textContent = q ? "没有匹配的提问或回答" : (state.loading ? "正在读取本对话…" : "这个对话还没有可显示的内容");
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
        MD.escapeHtml(truncate(row.t.q.replace(/\s+/g, " "), 160));
      if (q) MD.highlightIn(qDiv, q);
      li.appendChild(qDiv);
      if (q && row.qHits === 0 && (row.aHits > 0 || row.tHits > 0)) {
        const parts = [];
        if (row.aHits > 0) parts.push("回答中命中 " + row.aHits + " 处");
        if (row.tHits > 0) parts.push("思考中命中 " + row.tHits + " 处");
        const badge = document.createElement("span");
        badge.className = "ho-badge";
        badge.textContent = parts.join(" · ");
        li.appendChild(badge);
      }
      li.addEventListener("click", () => {
        state.selected = row.i;
        renderList();
        renderDetail();
      });
      list.appendChild(li);
    }
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
        chip.title = (ref && ref.title) || (ref && ref.url) || ("参考来源 " + (idx + 1));
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

  /** 「深度思考」折叠块：默认收起，标题上显示字数与耗时。 */
  function thinkingBlock(answer, expanded) {
    const box = document.createElement("div");
    box.className = "ho-think";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "ho-think-head";
    const title = document.createElement("span");
    title.className = "ho-think-title";
    title.textContent = "深度思考";
    const meta = document.createElement("span");
    meta.className = "ho-think-meta";
    const chars = answer.thinking.replace(/\s+/g, "").length;
    const bits = [];
    if (chars) bits.push(chars >= 1000 ? (chars / 1000).toFixed(1) + " 千字" : chars + " 字");
    if (answer.elapsed) bits.push("用时 " + answer.elapsed.toFixed(1) + " 秒");
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
    const t = state.turns[state.selected];
    if (!t) {
      const empty = document.createElement("div");
      empty.className = "ho-empty";
      empty.textContent = state.error || (state.loading ? "正在读取本对话…" : "点左侧的一条提问，这里显示它对应的回答。");
      pane.appendChild(empty);
      return;
    }

    const q = state.query.trim();
    const qLower = q ? (P.searchableText(q) || q).toLowerCase() : "";

    // 顶部：完整提问（代码框样式）+ 跳到回答按钮
    const qBox = document.createElement("div");
    qBox.className = "ho-question-box";
    const bar = document.createElement("div");
    bar.className = "ho-question-bar";
    const label = document.createElement("span");
    label.className = "ho-question-label";
    label.textContent = "提问 · 第 " + (state.selected + 1) + " 轮";
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "ho-jump-btn";
    jump.textContent = "跳到回答 ↓";
    jump.addEventListener("click", () => scrollToAnswer(pane));
    bar.appendChild(label);
    bar.appendChild(jump);
    const qPre = document.createElement("pre");
    qPre.className = "ho-question";
    qPre.textContent = t.q;
    qBox.appendChild(bar);
    qBox.appendChild(qPre);
    pane.appendChild(qBox);
    if (q) MD.highlightIn(qBox, q);

    if (!t.answers.length) {
      const empty = document.createElement("div");
      empty.className = "ho-empty";
      empty.textContent = "这条提问还没有回答。";
      pane.appendChild(empty);
      return;
    }

    const mark = document.createElement("div");
    mark.className = "ho-answer-anchor";
    mark.textContent = "回答 · " + t.answers.length + " 段";
    pane.appendChild(mark);

    for (const answer of t.answers) {
      const wrap = document.createElement("div");
      wrap.className = "ho-msg";
      if (answer.thinking) {
        const thinkHits = qLower && state.includeThinking &&
          MD.countOccurrences(P.searchableText(answer.thinking).toLowerCase(), qLower);
        const expanded = !!(qLower && thinkHits);      // 搜到思考内容时自动展开，否则默认收起
        wrap.appendChild(thinkingBlock(answer, expanded));
      }
      if (answer.text) {
        const prose = proseOf(answer.text, answer.refs);
        wrap.appendChild(prose);
        if (q) MD.highlightIn(prose, q);
      }
      pane.appendChild(wrap);
    }
    pane.scrollTop = 0;
  }

  /** 把详情区滚到回答开头（只滚动面板内部，不动页面） */
  function scrollToAnswer(pane) {
    const anchor = pane.querySelector(".ho-answer-anchor") || pane.querySelector(".ho-msg");
    if (!anchor) return false;
    const paneRect = pane.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const top = pane.scrollTop + (anchorRect.top - paneRect.top) - 8;
    try {
      pane.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } catch (e) {
      pane.scrollTop = Math.max(0, top);
    }
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
      if (chars) bits.push(chars >= 1000 ? (chars / 1000).toFixed(1) + " 千字" : chars + " 字");
      if (answer.elapsed) bits.push("用时 " + answer.elapsed.toFixed(1) + " 秒");
      const holder = proseOf(answer.thinking);
      html += '<details class="ho-think"><summary class="ho-think-head">' +
        '<span class="ho-think-title">深度思考</span>' +
        '<span class="ho-think-meta">' + MD.escapeHtml(bits.join(" · ")) + "</span></summary>" +
        holder.outerHTML + "</details>";
    }
    if (answer.text) {
      const holder = proseOf(answer.text, answer.refs);
      html += holder.outerHTML;
    }
    return html;
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
    count.textContent = q ? shown + ' / ' + panels.length + ' 条' : panels.length + ' 条';
  }
  function copyText(text, btn) {
    function flash(msg, ok) {
      btn.textContent = msg;
      btn.classList.toggle('ok', !!ok);
      setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('ok'); }, 1600);
    }
    function fallback() {
      try {
        var pre = btn.closest('.ho-code').querySelector('pre');
        var range = document.createRange();
        range.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = document.execCommand('copy');
        flash(ok ? '已复制' : '已选中，请按 Ctrl+C', ok);
      } catch (e) { flash('复制失败', false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash('已复制', true); }, fallback);
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
        state.error = state.error || "没有可导出的内容（先打开一个对话）。";
        renderAll();
      }
      return;
    }
    const title = currentTitle();
    const css = STYLES.base + STYLES.export;
    const items = state.turns.map((t, i) =>
      '<li class="ho-item' + (i === 0 ? " active" : "") + '" data-i="' + i + '">' +
      '<div class="ho-item-q"><span class="ho-item-idx">' + (i + 1) + "</span>" +
      MD.escapeHtml(truncate(t.q.replace(/\s+/g, " "), 160)) + "</div>" +
      (t.answers.length > 1 ? '<span class="ho-badge">' + t.answers.length + " 段回答</span>" : "") +
      "</li>").join("\n");
    const panels = state.turns.map((t, i) =>
      '<section class="ho-panel-data" data-i="' + i + '"' + (i === 0 ? "" : " hidden") + ">" +
      '<div class="ho-question-box"><div class="ho-question-bar">' +
      '<span class="ho-question-label">提问 · 第 ' + (i + 1) + " 轮</span>" +
      '<button type="button" class="ho-jump-btn">跳到回答 ↓</button></div>' +
      '<pre class="ho-question">' + MD.escapeHtml(t.q) + "</pre></div>" +
      (t.answers.length ? '<div class="ho-answer-anchor">回答 · ' + t.answers.length + " 段</div>" : "") +
      (t.answers.length ? t.answers.map(answerHtml).map((h) => '<div class="ho-msg">' + h + "</div>").join("")
        : '<div class="ho-empty">这条提问还没有回答。</div>') +
      "</section>").join("\n");

    const doc = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n" +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      "<title>" + MD.escapeHtml(title) + " · 对话大纲</title>\n<style>" + css + "</style>\n</head>\n<body>\n" +
      '<div class="ho-doc-head">\n' +
      '<span class="ho-doc-title">' + MD.escapeHtml(title) + "</span>\n" +
      '<span class="ho-doc-meta" id="ho-count">' + state.turns.length + " 条</span>\n" +
      '<input class="ho-search" id="ho-search" type="search" placeholder="搜索提问和回答…" autocomplete="off">\n' +
      '<span class="ho-doc-meta">导出于 ' + new Date().toLocaleString("zh-CN") + "</span>\n</div>\n" +
      '<div class="ho-doc-main">\n<ul class="ho-list ho-doc-list" id="ho-list">\n' + items + "\n</ul>\n" +
      '<div class="ho-doc-detail">\n<div class="ho-empty" id="ho-empty" hidden>没有匹配的提问或回答</div>\n' +
      panels + "\n</div>\n</div>\n<script>" + EXPORT_SCRIPT + "</" + "script>\n</body>\n</html>";

    download(doc, safeName(title) + "-对话大纲-" + stamp() + ".html");
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
        state.error = "读取对话数据失败：" + (d.error || "未知错误");
      }
      if (ui && !ui.panel.hidden && d.sessionId === state.sessionId) renderAll();
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
