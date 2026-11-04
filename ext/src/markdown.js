/*
 * 轻量 Markdown → HTML 渲染 + 白名单消毒 + 搜索高亮。
 * 全部本地实现，不联网、不加载任何外部脚本（MV3 下也不允许）。
 * 覆盖 DeepSeek 回答里常见的 Markdown 子集：标题、粗体/斜体/删除线、行内代码、
 * 围栏代码块、有序/无序列表（含一层嵌套）、引用、表格、分割线、链接、图片、硬换行。
 */
(() => {
  "use strict";
  if (window.__dsMarkdown) return;

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const ALLOWED = new Set(["P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "EM", "B", "I",
    "U", "S", "DEL", "INS", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "A", "IMG", "TABLE",
    "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "SPAN", "DIV", "MARK", "SUB", "SUP", "KBD", "FIGURE",
    "FIGCAPTION", "CAPTION", "DL", "DT", "DD", "ABBR", "SMALL"]);
  // 公式用 KaTeX 的 mathml 输出（Chrome 原生渲染），这些标签必须放行且属性大多是排版用的
  const MATHML = new Set(["MATH", "SEMANTICS", "ANNOTATION", "MROW", "MI", "MO", "MN", "MTEXT", "MSPACE",
    "MSUP", "MSUB", "MSUBSUP", "MFRAC", "MSQRT", "MROOT", "MOVER", "MUNDER", "MUNDEROVER", "MTABLE",
    "MTR", "MTD", "MSTYLE", "MPADDED", "MFENCED", "MENCLOSE", "MPHANTOM", "MS", "MMULTISCRIPTS",
    "MPRESCRIPTS"]);
  for (const t of MATHML) ALLOWED.add(t);
  const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT",
    "BUTTON", "SELECT", "TEXTAREA", "SVG", "AUDIO", "VIDEO", "SOURCE", "CANVAS", "NOSCRIPT", "TEMPLATE"]);
  const ATTRS = {
    A: ["href", "title", "target", "rel"],
    IMG: ["src", "alt", "title", "width", "height"],
    PRE: ["data-lang"], CODE: ["data-lang"],
    TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan"],
    MATH: ["display", "xmlns", "title"], ANNOTATION: ["encoding"]
  };
  // class 只放行我们自己生成的前缀（以及 KaTeX 自己加的 katex/katex-*），避免把页面的类名/样式带进来
  const CLASS_OK = { SPAN: /^(ho-|katex)/, CODE: /^(language-|ho-)/, PRE: /^(language-|ho-)/, MARK: /^ho-/, DIV: /^ho-/ };
  const attrAllowed = (tag, name, value) => {
    if ((ATTRS[tag] || []).indexOf(name) >= 0) return true;
    if (name === "class") {
      const re = CLASS_OK[tag];
      return !!re && re.test(String(value || "").split(/\s+/)[0]);
    }
    if (MATHML.has(tag)) {              // MathML 属性都是排版用的，只挡住脚本/外链面
      if (/^on/i.test(name.trim())) return false;
      if (/^(href|src|style|xlink:href)$/i.test(name.trim())) return false;
      if (/url\(|javascript:|expression\(/i.test(String(value || ""))) return false;
      return true;
    }
    return false;
  };

  const safeUrl = (raw, forImage) => {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (/^(https?:|mailto:|tel:|#|\/|data:image\/)/i.test(v)) {
      if (/^data:/i.test(v) && !forImage) return "";
      return v;
    }
    return "";
  };

  function sanitize(html) {
    const doc = new DOMParser().parseFromString("<div id='ho-root'>" + html + "</div>", "text/html");
    const root = doc.getElementById("ho-root");

    const walk = (node) => {
      const kids = Array.prototype.slice.call(node.childNodes);
      for (const child of kids) {
        if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        // 注意：HTML 元素的 tagName 是大写，但 MathML/SVG（外来内容）是小写——必须统一成大写再查表，
        // 否则 <math> 会被当成"未知标签"整棵拆掉。
        const tag = String(child.tagName || "").toUpperCase();
        if (DROP.has(tag)) { child.remove(); continue; }
        walk(child);
        if (!ALLOWED.has(tag)) {                       // 未知标签（含 ChatGPT 的 genui 组件）→ 拆掉外壳保留内容
          const frag = doc.createDocumentFragment();
          while (child.firstChild) frag.appendChild(child.firstChild);
          child.replaceWith(frag);
          continue;
        }
        const allowed = ATTRS[tag] || [];
        for (const attr of Array.prototype.slice.call(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (!attrAllowed(tag, name, attr.value)) { child.removeAttribute(attr.name); continue; }
          if (name === "href" || name === "src") {
            const ok = safeUrl(attr.value, tag === "IMG");
            if (!ok) child.removeAttribute(attr.name); else child.setAttribute(name, ok);
          }
        }
        if (tag === "A") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
      }
    };
    walk(root);
    return root.innerHTML;
  }

  /* ------------------------------------------------- 公式（KaTeX → MathML） */
  // 行内：\( … \) 与 $ … $。$ 有防误判：开头的 $ 后面不能是空白或另一个 $，
  // 结尾的 $ 前面不能是空白/反斜杠、后面不能紧跟数字——否则 "$5 and $10" 会被当成公式。
  const INLINE_MATH = [
    /\\\(([\s\S]+?)\\\)/g,
    /\$(?![\s$])((?:\\[\s\S]|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g
  ];
  // 块级（居中的独立公式）：$$ … $$ 与 \[ … \]
  const BLOCK_MATH = [/\$\$([\s\S]+?)\$\$/g, /\\\[([\s\S]+?)\\\]/g];
  const mathCache = new Map();
  const blockStash = [];                  // 块级 token（围栏代码块 + 块级公式）的内容，render() 与 inline() 共用

  /** LaTeX → HTML：KaTeX 的 MathML 输出，由 Chrome 原生渲染（不需要打包字体/CSS）。
   *  渲染失败（KaTeX 缺失或写法不认识）时退回原始文本，绝不在页面上显示报错。 */
  function renderMath(tex, display) {
    const src = String(tex == null ? "" : tex).replace(/^\s+|\s+$/g, "");
    if (!src) return "";
    const key = (display ? "D" : "I") + src;
    if (mathCache.has(key)) return mathCache.get(key);
    let inner = "";
    const K = window.katex;
    if (K && typeof K.renderToString === "function") {
      try {
        inner = K.renderToString(src, {
          displayMode: !!display, output: "mathml", throwOnError: false,
          errorColor: "inherit", strict: "ignore", trust: false
        });
      } catch (e) { inner = ""; }
    }
    if (!inner) inner = '<span class="ho-math-fallback" title="这个公式没能渲染，已按原样显示">' + escapeHtml(src) + "</span>";
    const html = display ? '<span class="ho-math-block">' + inner + "</span>" : inner;
    mathCache.set(key, html);
    return html;
  }

  /* ------------------------------------------------------------ inline */
  function inline(text) {
    const stash = [];                       // 行内代码与公式先取出：不能被抓强调符号/转义/链接规则碰到
    let s = String(text == null ? "" : text);
    s = s.replace(/`([^`\n]+)`/g, (m, c) => {
      stash.push({ code: true, v: c });
      return "\u0000T" + (stash.length - 1) + "\u0000";
    });
    for (const rx of INLINE_MATH) {
      s = s.replace(rx, (m, tex) => {
        stash.push({ math: true, v: tex });
        return "\u0000T" + (stash.length - 1) + "\u0000";
      });
    }
    let out = escapeHtml(s);
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
      (m, alt, url) => '<img src="' + url + '" alt="' + alt + '" loading="lazy">');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => '<a href="' + url + '">' + label + "</a>");
    out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (m, pre, url) => pre + '<a href="' + url + '">' + url + "</a>");
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    // 单下划线斜体要求两侧是边界（行首/空白/括号/引号）：否则 X_prg、df_prgs_play 这类标识符会被吃掉下划线
    out = out.replace(/(^|[\s(\[{>«"'（])_(?!\s)([^_\n]*?)(?<!\s)_(?![\w])/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/\u0000CITE\u0000/g, '<span class="ho-cite" title="原文引用">引用</span>');
    out = out.replace(/\u0000B(\d+)\u0000/g, (m, i) => blockStash[Number(i)] || "");   // 混在段落里的块级公式
    out = out.replace(/\u0000T(\d+)\u0000/g, (m, i) => {
      const it = stash[Number(i)];
      if (!it) return "";
      if (it.code) return "<code>" + escapeHtml(it.v) + "</code>";
      return renderMath(it.v, false);
    });
    return out;
  }

  const isBlank = (l) => !l || !l.trim();
  const isFence = (l) => /^\s*(```|~~~)/.test(l);
  const listMatch = (l) => /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(l);
  const headingMatch = (l) => /^(#{1,6})\s+(.*)$/.exec(l.trim());

  function renderList(lines, startIdx) {
    const first = listMatch(lines[startIdx]);
    const ordered = /^\d/.test(first[2]);
    const indent = first[1].length;
    let html = ordered ? "<ol>" : "<ul>";
    let i = startIdx;
    while (i < lines.length) {
      const m = listMatch(lines[i]);
      if (!m) {
        if (isBlank(lines[i]) && i + 1 < lines.length && listMatch(lines[i + 1])) { i += 1; continue; }
        break;
      }
      const ind = m[1].length;
      if (ind < indent) break;
      if (ind > indent) {                                   // 一层嵌套
        const sub = renderList(lines, i);
        html = html.replace(/<\/li>$/, "") + sub.html + "</li>";
        i = sub.next;
        continue;
      }
      if (ordered && !/^\d/.test(m[2])) break;
      if (!ordered && /^\d/.test(m[2])) break;
      let content = m[3];
      let extra = "";
      while (i + 1 < lines.length && !isBlank(lines[i + 1]) && !listMatch(lines[i + 1]) &&
             !headingMatch(lines[i + 1]) && !isFence(lines[i + 1]) && !/^\s*>/.test(lines[i + 1])) {
        extra += "\n" + lines[i + 1].trim();
        i += 1;
      }
      content += extra;
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(content);
      if (task) {
        html += '<li class="ho-task"><input type="checkbox" disabled' +
          (task[1].toLowerCase() === "x" ? " checked" : "") + "> " + inline(task[2]) + "</li>";
      } else {
        html += "<li>" + inline(content).replace(/\n/g, "<br>") + "</li>";
      }
      i += 1;
    }
    html += ordered ? "</ol>" : "</ul>";
    return { html, next: i };
  }

  function renderTable(lines, startIdx) {
    const rows = [];
    let i = startIdx;
    while (i < lines.length && lines[i].indexOf("|") >= 0 && !isBlank(lines[i])) { rows.push(lines[i]); i += 1; }
    if (rows.length < 2) return null;
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    let html = "<table><thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
    for (let r = 2; r < rows.length; r += 1) {
      html += "<tr>" + cells(rows[r]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
    }
    return { html: html + "</tbody></table>", next: i };
  }

  /* 正文里混着的组件标签（<box gap={3}>、<row>、<Cite refs={[...]}/> 等）不是标准 HTML，
     先统一处理，避免它们被当成正文显示。
     注意：DeepSeek 的回答里经常整段贴 HTML/SVG 代码，所以这个函数**必须**在
     围栏代码块与行内代码被摘出去之后再调用，否则 <rect/>、<path/> 会被当组件标签删掉。 */
  const SAFE_TAGS = new Set(["b", "i", "em", "strong", "u", "s", "del", "ins", "code", "pre", "br", "hr",
    "mark", "sub", "sup", "kbd", "span", "p", "div", "ul", "ol", "li", "blockquote", "table", "thead",
    "tbody", "tr", "th", "td", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6", "small", "figure", "figcaption"]);
  const LAYOUT_TAGS = /^(box|row|col|column|stack|grid|fragment|group)$/i;

  function stripCustomTags(text) {
    return text
      .replace(/<(AsyncImage|Image|ImageAsset|GeneratedImage|Canvas)\b[^>]*\/?>(?:<\/\1>)?/gi, "[图片]")
      .replace(/<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (whole, slash, name, attrs) => {
        if (/^cite$/i.test(name)) return slash ? "" : "\u0000CITE\u0000";
        const lower = name.toLowerCase();
        const looksLikeComponent = /[A-Z]/.test(name) || attrs.indexOf("{") >= 0;
        if (LAYOUT_TAGS.test(name)) return " ";
        if (looksLikeComponent || !SAFE_TAGS.has(lower)) return "";
        return whole;
      });
  }

  /** 行内代码先摘出来（单行内），免得里面的标签/强调符被后面的规则改掉。 */
  function stashInlineCode(text) {
    const stash = [];
    const out = text.replace(/`[^`\n]*`/g, (m) => {
      stash.push(m);
      return "\u0000K" + (stash.length - 1) + "\u0000";
    });
    return { text: out, restore: (s) => s.replace(/\u0000K(\d+)\u0000/g, (m, i) => stash[Number(i)] || "") };
  }

  function render(src) {
    let text = String(src == null ? "" : src).replace(/\r\n?/g, "\n");

    // 1) 围栏代码块最先摘出：里面的 <tag>、<br>、$ 等都不能被后面的规则碰到
    text = text.replace(/^([ \t]*)(```|~~~)([^\n]*)\n([\s\S]*?)^\1\2[ \t]*$/gm, (m, indent, fence, info, body) => {
      const lang = String(info || "").trim().split(/\s+/)[0];
      blockStash.push('<pre' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : "") + '><code' +
        (lang ? ' class="language-' + escapeHtml(lang) + '"' : "") + ">" +
        escapeHtml(body.replace(/\n$/, "")) + "</code></pre>");
      return "\u0000B" + (blockStash.length - 1) + "\u0000";
    });

    // 2) 组件标签处理（行内代码先保护）
    const codeGuard = stashInlineCode(text);
    text = stripCustomTags(codeGuard.text);
    text = codeGuard.restore(text);
    text = text.replace(/<br\s*\/?>/gi, "\n");

    // 3) 块级公式：必须在围栏代码块之后处理，否则代码里的 $ 与 \[ 会被当成公式
    for (const rx of BLOCK_MATH) {
      text = text.replace(rx, (m, tex) => {
        blockStash.push(renderMath(tex, true));
        return "\u0000B" + (blockStash.length - 1) + "\u0000";
      });
    }

    const lines = text.split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (isBlank(line)) { i += 1; continue; }

      const block = /^\u0000B(\d+)\u0000\s*$/.exec(line.trim());
      if (block) { out.push(blockStash[Number(block[1])] || ""); i += 1; continue; }

      const h = headingMatch(line);
      if (h) {
        const lvl = Math.min(h[1].length, 6);
        out.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">");
        i += 1;
        continue;
      }

      if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) { out.push("<hr>"); i += 1; continue; }

      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
        out.push("<blockquote>" + render(buf.join("\n")) + "</blockquote>");
        continue;
      }

      if (listMatch(line)) {
        const sub = renderList(lines, i);
        out.push(sub.html);
        i = sub.next;
        continue;
      }

      if (line.indexOf("|") >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const sub = renderTable(lines, i);
        if (sub) { out.push(sub.html); i = sub.next; continue; }
      }

      const buf = [line];
      i += 1;
      while (i < lines.length && !isBlank(lines[i]) && !headingMatch(lines[i]) && !isFence(lines[i]) &&
             !/^\s*>/.test(lines[i]) && !listMatch(lines[i]) && !/^\u0000B\d+\u0000\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      const para = buf.map((l) => l.replace(/ {2,}$|\\$/, "\u0000BR\u0000")).join("\n");
      out.push("<p>" + inline(para).replace(/\u0000BR\u0000\n?/g, "<br>").replace(/\n/g, " ") + "</p>");
    }
    return out.join("\n");
  }

  const toHtml = (src) => sanitize(render(src));

  /* --------------------------------------------------------- 搜索高亮 */
  /**
   * 跨节点高亮：先把子树内所有文本节点拼成一整串再做匹配，然后用 Range 精确包裹命中片段。
   * 这样"跨 <strong>/<code>/token span/被拆碎的文本节点"的词也能正确高亮——
   * 旧实现按单个文本节点 indexOf，一旦 DOM 被上一次搜索的 mark 拆成碎片就再也匹配不到。
   * 返回命中的片段数。
   */
  function highlightIn(rootEl, needle) {
    const q = String(needle == null ? "" : needle).trim();
    if (!q || !rootEl) return 0;
    const lower = q.toLowerCase();

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") return NodeFilter.FILTER_REJECT;
        // 公式内部不高亮：往 MathML 里插 <mark> 会打散排版
        if (parent.closest && parent.closest("math, .katex, .ho-math-block, .ho-math-inline")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const entries = [];
    let full = "";
    let node = walker.nextNode();
    while (node) {
      entries.push({ node, start: full.length });
      full += node.nodeValue;
      node = walker.nextNode();
    }
    if (!full) return 0;

    const hay = full.toLowerCase();
    const matches = [];
    let pos = 0;
    for (;;) {
      const idx = hay.indexOf(lower, pos);
      if (idx < 0) break;
      matches.push([idx, idx + lower.length]);
      pos = idx + lower.length;
    }
    if (!matches.length) return 0;

    let hits = 0;
    // 从后往前包裹：前面的偏移量不会因为后面 DOM 被拆分而失效
    for (let m = matches.length - 1; m >= 0; m -= 1) {
      const [start, end] = matches[m];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        const nodeStart = entry.start;
        const nodeEnd = nodeStart + entry.node.nodeValue.length;
        if (nodeEnd <= start) break;
        if (nodeStart >= end) continue;
        const from = Math.max(start, nodeStart) - nodeStart;
        const to = Math.min(end, nodeEnd) - nodeStart;
        if (to <= from) continue;
        try {
          const range = document.createRange();
          range.setStart(entry.node, from);
          range.setEnd(entry.node, to);
          const mark = document.createElement("mark");
          mark.className = "ho-hit";
          range.surroundContents(mark);
          hits += 1;
        } catch (e) { /* 无法包裹的片段直接跳过，不影响其它命中 */ }
      }
    }
    return hits;
  }

  const countOccurrences = (text, needle) => {
    if (!needle) return 0;
    const hay = String(text || "").toLowerCase();
    const q = needle.toLowerCase();
    let n = 0;
    let pos = 0;
    for (;;) {
      const idx = hay.indexOf(q, pos);
      if (idx < 0) break;
      n += 1;
      pos = idx + q.length;
    }
    return n;
  };

  window.__dsMarkdown = { escapeHtml, sanitize, render, toHtml, highlightIn, countOccurrences, renderMath };
})();
