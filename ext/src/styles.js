/*
 * 界面样式。深色为默认，页面是浅色主题时给根节点加 .ho-light 覆盖变量。
 * 字号/字体/配色尽量贴近 DeepSeek 本身（正文 15-16px、代码用 ui-monospace 系）。
 */
(() => {
  "use strict";
  if (window.__dsStyles) return;

  // 变量单独抽出来，界面（.ho-root/.ho-light）和导出的独立 HTML（:root）共用同一套
  const VARS_DARK = `
  --ho-bg: #212121;
  --ho-bg-soft: #2f2f2f;
  --ho-bg-code: #0d0d0d;
  --ho-bg-list: rgba(255,255,255,.028);
  --ho-fg: #ececec;
  --ho-fg-dim: #9b9b9b;
  --ho-border: rgba(255,255,255,.15);
  --ho-hover: rgba(255,255,255,.08);
  --ho-accent: #7ab7ff;
  --ho-mark-bg: #ffe066;
  --ho-mark-fg: #1a1a1a;
  --ho-shadow: 0 12px 40px rgba(0,0,0,.55);
  --ho-font: -apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, "Microsoft YaHei", sans-serif;
  --ho-mono: ui-monospace, SFMono-Regular, "SF Mono", menlo, consolas, "Liberation Mono", monospace;
`;
  const VARS_LIGHT = `
  --ho-bg: #ffffff;
  --ho-bg-soft: #f4f4f4;
  --ho-bg-code: #f6f8fa;
  --ho-bg-list: rgba(13,13,13,.025);
  --ho-fg: #0d0d0d;
  --ho-fg-dim: #6b6b6b;
  --ho-border: rgba(13,13,13,.15);
  --ho-hover: rgba(13,13,13,.06);
  --ho-accent: #0b57d0;
  --ho-mark-bg: #ffe066;
  --ho-mark-fg: #1a1a1a;
  --ho-shadow: 0 12px 40px rgba(0,0,0,.28);
  --ho-font: -apple-system-body, ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, "Microsoft YaHei", sans-serif;
  --ho-mono: ui-monospace, SFMono-Regular, "SF Mono", menlo, consolas, "Liberation Mono", monospace;
`;

  const BASE = `
:host, .ho-root { all: initial; }
.ho-root {${VARS_DARK}}
.ho-light {${VARS_LIGHT}}
.ho-root, .ho-root * { box-sizing: border-box; }

.ho-fab {
  position: fixed; right: 18px; bottom: 104px; z-index: 2147483000;
  width: 46px; height: 46px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--ho-bg-soft); color: var(--ho-fg);
  border: 1px solid var(--ho-border); box-shadow: 0 4px 16px rgba(0,0,0,.4);
  cursor: pointer; font-family: var(--ho-font); padding: 0;
}
.ho-fab:hover { transform: scale(1.06); }
.ho-fab svg { width: 22px; height: 22px; display: block; }

.ho-panel {
  position: fixed; z-index: 2147483001; inset: 0;
  margin: auto; width: min(1180px, 94vw); height: min(86vh, 900px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--ho-bg); color: var(--ho-fg); font-family: var(--ho-font);
  border: 1px solid var(--ho-border); border-radius: 14px; box-shadow: var(--ho-shadow);
  font-size: 15px; line-height: 1.7;
}
.ho-panel[hidden] { display: none; }

.ho-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--ho-border); flex-wrap: wrap;
}
.ho-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
.ho-count { font-weight: 400; color: var(--ho-fg-dim); font-size: 12px; }
.ho-search {
  flex: 1 1 240px; min-width: 160px; background: var(--ho-bg-soft); color: inherit;
  border: 1px solid var(--ho-border); border-radius: 9px; padding: 8px 12px;
  font: inherit; font-size: 13px; outline: none;
}
.ho-search:focus { border-color: var(--ho-accent); }
.ho-toggle {
  display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ho-fg-dim);
  white-space: nowrap; cursor: pointer; user-select: none;
}
.ho-toggle input { width: 13px; height: 13px; accent-color: #4d6bfe; cursor: pointer; }
.ho-btn {
  background: var(--ho-bg-soft); color: inherit; border: 1px solid var(--ho-border);
  border-radius: 9px; padding: 7px 13px; font: inherit; font-size: 13px; cursor: pointer;
  white-space: nowrap;
}
.ho-btn:hover { background: var(--ho-hover); }
.ho-btn.primary { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
.ho-btn.primary:hover { background: #3f5bea; }

.ho-body { flex: 1; display: flex; min-height: 0; }
.ho-list {
  width: 320px; flex: 0 0 320px; margin: 0; padding: 8px; list-style: none;
  overflow-y: auto; background: var(--ho-bg-list); border-right: 1px solid var(--ho-border);
}
.ho-item {
  padding: 8px 10px; border-radius: 9px; cursor: pointer; font-size: 13px; line-height: 1.5;
  color: var(--ho-fg); margin-bottom: 2px; word-break: break-word;
}
.ho-item:hover { background: var(--ho-hover); }
.ho-item.active {
  background: var(--ho-hover);
  box-shadow: inset 3px 0 0 var(--ho-accent);
  font-weight: 500;
}
.ho-item-q { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ho-item-idx { color: var(--ho-fg-dim); font-size: 11px; margin-right: 6px; }
.ho-badge { display: block; margin-top: 3px; font-size: 11px; color: var(--ho-fg-dim); }
.ho-empty { padding: 18px; color: var(--ho-fg-dim); font-size: 13px; }

.ho-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 22px 26px; }
.ho-detail-head {
  font-size: 12px; color: var(--ho-fg-dim); border-bottom: 1px solid var(--ho-border);
  padding-bottom: 8px; margin-bottom: 16px;
}
/* 顶部：完整提问（同代码框外观，保留换行） */
.ho-question-box { margin: 0 0 18px; }
.ho-question-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px;
}
.ho-question-label { font-size: 11px; color: var(--ho-fg-dim); letter-spacing: .02em; }
.ho-jump-btn {
  font: inherit; font-size: 11px; font-family: var(--ho-font);
  color: var(--ho-fg-dim); background: transparent; border: 1px solid var(--ho-border);
  border-radius: 6px; padding: 3px 9px; cursor: pointer; white-space: nowrap;
}
.ho-jump-btn:hover { color: var(--ho-fg); background: var(--ho-hover); }
.ho-prose pre.ho-question, .ho-question {
  margin: 0; background: var(--ho-bg-code); border: 1px solid var(--ho-border); border-radius: 10px;
  padding: 12px 14px; font-family: var(--ho-mono); font-size: 12.5px; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; color: var(--ho-fg);
  max-height: 45vh; overflow-y: auto;
}
.ho-answer-anchor {
  font-size: 11px; color: var(--ho-fg-dim); letter-spacing: .02em;
  border-top: 1px solid var(--ho-border); padding-top: 12px; margin: 4px 0 14px;
}
.ho-msg + .ho-msg { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--ho-border); }

/* 「深度思考」折叠块：默认收起，点标题展开 */
.ho-think { margin: 0 0 12px; border: 1px solid var(--ho-border); border-radius: 10px; overflow: hidden; }
.ho-think-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  margin: 0; padding: 7px 12px; border: 0; background: var(--ho-bg-list); color: var(--ho-fg-dim);
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.ho-think-head:hover { background: var(--ho-hover); color: var(--ho-fg); }
.ho-think-title { font-weight: 600; color: var(--ho-fg); }
.ho-think-meta { flex: 1; font-size: 11px; }
.ho-think-arrow { font-size: 11px; }
.ho-think-body { padding: 12px 14px 2px; border-top: 1px solid var(--ho-border); }
.ho-think-body[hidden] { display: none; }
.ho-think.open .ho-think-head { background: var(--ho-hover); color: var(--ho-fg); }
.ho-think .ho-prose { font-size: 14px; color: var(--ho-fg-dim); }
.ho-think .ho-prose mark { color: var(--ho-mark-fg); }

.ho-prose { font-size: 15px; line-height: 1.75; word-break: break-word; }
.ho-prose p { margin: 0 0 14px; }
.ho-prose h1, .ho-prose h2, .ho-prose h3, .ho-prose h4, .ho-prose h5, .ho-prose h6 {
  margin: 20px 0 10px; line-height: 1.3; font-weight: 600;
}
.ho-prose h1 { font-size: 1.55em; } .ho-prose h2 { font-size: 1.3em; } .ho-prose h3 { font-size: 1.15em; }
.ho-prose h4, .ho-prose h5, .ho-prose h6 { font-size: 1em; }
.ho-prose ul, .ho-prose ol { margin: 0 0 14px; padding-left: 1.6em; }
.ho-prose li { margin: 4px 0; }
.ho-prose li.ho-task { list-style: none; margin-left: -1.2em; }
.ho-prose blockquote {
  margin: 0 0 14px; padding: 2px 0 2px 14px; border-left: 2px solid var(--ho-border);
  color: var(--ho-fg-dim);
}
.ho-prose pre {
  background: var(--ho-bg-code); border: 1px solid var(--ho-border); border-radius: 10px;
  padding: 12px 14px; overflow-x: auto; margin: 0; font-size: 12.5px; line-height: 1.6;
}
/* 代码块：语言名 + 复制按钮的头部，外框由 .ho-code 统一负责 */
.ho-code {
  margin: 0 0 14px; border: 1px solid var(--ho-border); border-radius: 10px;
  background: var(--ho-bg-code); overflow: hidden;
}
.ho-code pre { border: 0; border-radius: 0; }
.ho-code-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px 6px 12px; border-bottom: 1px solid var(--ho-border);
  font-family: var(--ho-mono); font-size: 11px; color: var(--ho-fg-dim);
}
.ho-code-lang { text-transform: lowercase; letter-spacing: .02em; }
.ho-code-copy {
  font: inherit; font-family: var(--ho-font); font-size: 11px;
  color: var(--ho-fg-dim); background: transparent; border: 1px solid var(--ho-border);
  border-radius: 6px; padding: 3px 8px; cursor: pointer;
}
.ho-code-copy:hover { color: var(--ho-fg); background: var(--ho-hover); }
.ho-code-copy.ok { color: #7ee787; border-color: #7ee787; }
.ho-prose pre[data-lang]::before { content: none; }
.ho-prose pre code.hljs, .ho-prose pre code[data-lang] { color: var(--ho-fg); background: none; }
/* 数学公式：KaTeX 的 MathML 输出由 Chrome 原生渲染（不打包字体），这里只调尺寸、间距与溢出 */
.ho-prose .katex { font-size: 1.03em; line-height: 1.25; }
.ho-prose math { font-size: 1.06em; }
.ho-prose math[display="block"], .ho-prose .ho-math-block > .katex { margin: 0 auto; }
.ho-math-block {
  display: block; margin: 14px 0; padding: 2px 0; text-align: center;
  overflow-x: auto; overflow-y: hidden; max-width: 100%;
}
.ho-math-fallback { font-family: var(--ho-mono); color: var(--ho-fg-dim); }
/* 语法高亮：Prism 的 token 类名，配色沿用 GitHub Dark（作用域限定在 .ho-prose 内） */
.ho-prose .token.comment, .ho-prose .token.prolog, .ho-prose .token.doctype, .ho-prose .token.cdata { color: #8b949e; }
.ho-prose .token.punctuation { color: var(--ho-fg); }
.ho-prose .token.keyword, .ho-prose .token.boolean, .ho-prose .token.important, .ho-prose .token.atrule { color: #ff7b72; }
.ho-prose .token.function, .ho-prose .token.class-name, .ho-prose .token.maybe-class-name, .ho-prose .token.decorator,
.ho-prose .token.annotation { color: #d2a8ff; }
.ho-prose .token.number, .ho-prose .token.operator, .ho-prose .token.constant, .ho-prose .token.symbol,
.ho-prose .token.attr-name, .ho-prose .token.property, .ho-prose .token.variable { color: #79c0ff; }
.ho-prose .token.string, .ho-prose .token.char, .ho-prose .token.regex, .ho-prose .token.attr-value,
.ho-prose .token.url { color: #a5d6ff; }
.ho-prose .token.builtin, .ho-prose .token.tag, .ho-prose .token.selector, .ho-prose .token.inserted { color: #7ee787; }
.ho-prose .token.namespace { opacity: .8; }
.ho-prose .token.deleted { color: #ffdcd7; background: #67060c; }
.ho-prose .token.italic { font-style: italic; }
.ho-prose .token.bold { font-weight: 700; }
/* 浅色主题下换一套配色，避免在浅背景上看不清 */
.ho-light .ho-prose .token.comment, .ho-light .ho-prose .token.prolog, .ho-light .ho-prose .token.doctype,
.ho-light .ho-prose .token.cdata { color: #6a737d; }
.ho-light .ho-prose .token.keyword, .ho-light .ho-prose .token.boolean, .ho-light .ho-prose .token.important,
.ho-light .ho-prose .token.atrule { color: #d73a49; }
.ho-light .ho-prose .token.function, .ho-light .ho-prose .token.class-name, .ho-light .ho-prose .token.decorator,
.ho-light .ho-prose .token.annotation { color: #6f42c1; }
.ho-light .ho-prose .token.number, .ho-light .ho-prose .token.operator, .ho-light .ho-prose .token.constant,
.ho-light .ho-prose .token.symbol, .ho-light .ho-prose .token.attr-name, .ho-light .ho-prose .token.property,
.ho-light .ho-prose .token.variable { color: #005cc5; }
.ho-light .ho-prose .token.string, .ho-light .ho-prose .token.char, .ho-light .ho-prose .token.regex,
.ho-light .ho-prose .token.attr-value, .ho-light .ho-prose .token.url { color: #032f62; }
.ho-light .ho-prose .token.builtin, .ho-light .ho-prose .token.tag, .ho-light .ho-prose .token.selector { color: #22863a; }
.ho-prose pre code { background: none; padding: 0; border: 0; font-size: inherit; }
.ho-prose code {
  font-family: var(--ho-mono); font-size: .88em; background: rgba(255,255,255,.09);
  border-radius: 4px; padding: 1.5px 5px;
}
.ho-light .ho-prose code { background: rgba(13,13,13,.07); }
.ho-prose table { border-collapse: collapse; margin: 0 0 14px; font-size: .93em; display: block; overflow-x: auto; }
.ho-prose th, .ho-prose td { border: 1px solid var(--ho-border); padding: 6px 10px; text-align: left; }
.ho-prose th { background: var(--ho-hover); font-weight: 600; }
.ho-prose a { color: var(--ho-accent); text-decoration: none; }
.ho-prose a:hover { text-decoration: underline; }
.ho-prose img { max-width: 100%; border-radius: 8px; }
.ho-prose hr { border: 0; border-top: 1px solid var(--ho-border); margin: 18px 0; }
.ho-prose mark { background: var(--ho-mark-bg); color: var(--ho-mark-fg); border-radius: 2px; padding: 0 1px; }
.ho-prose .ho-cite {
  display: inline-block; font-size: .72em; line-height: 1.5; vertical-align: baseline;
  color: var(--ho-fg-dim); border: 1px solid var(--ho-border); border-radius: 4px;
  padding: 0 4px; margin: 0 2px; white-space: nowrap;
}
.ho-prose .ho-img-ph {
  display: inline-block; padding: 2px 8px; border: 1px dashed var(--ho-border);
  border-radius: 6px; color: var(--ho-fg-dim); font-size: 12px;
}
/* 联网检索的来源角标（[reference:N] → 可点的小圆标） */
.ho-prose .ho-cite-num {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1.25em; height: 1.25em; margin: 0 2px; padding: 0 3px;
  font-family: var(--ho-font); font-size: .66em; font-weight: 500; line-height: 1;
  vertical-align: super; border: 1px solid var(--ho-border); border-radius: 999px;
  color: var(--ho-fg-dim); background: var(--ho-bg-soft); text-decoration: none;
}
.ho-prose a.ho-cite-num:hover { color: var(--ho-fg); border-color: var(--ho-accent); }
`;

  const EXPORT = `
/* 独立 HTML：这里没有 .ho-root 元素，变量必须挂在 :root 上 */
:root {${VARS_DARK}}
@media (prefers-color-scheme: light) { :root {${VARS_LIGHT}} }
html, body { margin: 0; padding: 0; background: var(--ho-bg); color: var(--ho-fg); }
body {
  font-family: var(--ho-font);
  font-size: 15px; line-height: 1.7;
}
.ho-doc-head {
  position: sticky; top: 0; z-index: 5; background: var(--ho-bg); border-bottom: 1px solid var(--ho-border);
  padding: 12px 18px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
}
.ho-doc-title { font-size: 14px; font-weight: 600; }
.ho-doc-meta { font-size: 12px; color: var(--ho-fg-dim); }
.ho-doc-main { display: flex; align-items: flex-start; min-height: calc(100vh - 58px); }
.ho-doc-list {
  width: 320px; flex: 0 0 320px; list-style: none; margin: 0; padding: 8px;
  background: var(--ho-bg-list); border-right: 1px solid var(--ho-border);
  position: sticky; top: 58px; max-height: calc(100vh - 58px); overflow-y: auto;
}
.ho-doc-detail { flex: 1; min-width: 0; padding: 22px 26px; border-left: 0; }
.ho-doc-question { font-size: 13px; color: var(--ho-fg-dim); margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid var(--ho-border); }
/* 导出页里的「深度思考」用原生 <details>，去掉默认三角标记 */
details.ho-think > summary { list-style: none; }
details.ho-think > summary::-webkit-details-marker { display: none; }
details.ho-think > summary::marker { content: ""; }
details.ho-think > summary::after { content: "▸"; font-size: 11px; }
details.ho-think[open] > summary::after { content: "▾"; }
`;

  window.__dsStyles = { base: BASE, export: EXPORT };
})();
