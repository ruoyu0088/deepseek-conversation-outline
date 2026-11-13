/*
 * 界面文案（中/英）。同时注入 ISOLATED 与 MAIN 两个世界：
 *   - 面板（content.js）在隔离世界用；
 *   - 请求层（hook.js）在主世界用它把错误消息本地化。
 * 语言偏好存在 localStorage 的 ds-outline:lang：auto / zh / en。
 * auto 时跟随浏览器（navigator.language 以 zh 开头 → 中文，否则英文）。
 */
(() => {
  "use strict";
  if (window.__dsI18n) return;

  const STORAGE_KEY = "ds-outline:lang";

  const zh = {
    appName: "对话大纲",
    fabTitle: "对话大纲：列出本对话的全部提问与回答",
    searchPlaceholder: "搜索提问和回答…（Ctrl+K 聚焦）",
    searchPlaceholderShort: "搜索提问和回答…",
    searchPlaceholderTiny: "搜索…（Ctrl+K）",
    searchFocusTitle: "按 Ctrl+K 聚焦搜索并全选",
    enterNewline: "Enter 换行",
    enterNewlineTitle: "勾选后：Enter 换行，Ctrl+Enter 发送",
    searchThinking: "搜索含思考",
    searchThinkingTitle: "搜索时是否也匹配「深度思考」里的内容",
    langTitle: "界面语言 / Language",
    langAuto: "自动 / Auto",
    langZh: "中文",
    langEn: "English",
    downloadHtml: "下载 HTML",
    close: "关闭",
    codeFallback: "代码",
    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败",
    selectCopy: "已选中，请按 Ctrl+C",
    loading: "读取中…",
    turnSuffix: " 条",
    countAll: (n) => n + " 条",
    countFiltered: (shown, total) => shown + " / " + total + " 条",
    noMatch: "没有匹配的提问或回答",
    reading: "正在读取本对话…",
    emptyConversation: "这个对话还没有可显示的内容",
    needConversation: "请先打开一个对话（地址形如 /a/chat/s/…）再点这个按钮。",
    readFailed: (msg) => "读取对话数据失败：" + msg,
    unknownError: "未知错误",
    pickPrompt: "点左侧的一条提问，这里显示它对应的回答。",
    copyPrompt: "复制提问",
    copyAnswer: "复制回答",
    copyPromptTitle: "把这一轮的提问复制到剪贴板",
    copyAnswerTitle: "把这一轮的回答（Markdown 原文，含代码围栏）复制到剪贴板",
    noAnswerTitle: "这条提问还没有回答",
    jumpToAnswer: "跳到回答 ↓",
    sourceLabel: (n) => "参考来源 " + n,
    questionLabel: (n) => "提问 · 第 " + n + " 轮",
    answerLabel: (n) => "回答 · " + n + " 段",
    answerSegments: (n) => n + " 段回答",
    noAnswerForThis: "这条提问还没有回答。",
    noExport: "没有可导出的内容（先打开一个对话）。",
    thinking: "深度思考",
    charsText: (n) => (n >= 1000 ? (n / 1000).toFixed(1) + " 千字" : n + " 字"),
    elapsedText: (sec) => "用时 " + sec.toFixed(1) + " 秒",
    attachClickTitle: (size) => "点击查看附件内容" + (size ? " · " + size : ""),
    attachment: "[附件]",
    image: "[图片]",
    attachLoading: "正在读取附件内容…",
    attachFailed: (err) => "读取附件失败：" + err,
    attachImageHint: (size) => "图片附件" + (size ? "（" + size + "）" : "") + " · 点这里在新标签打开",
    attachImageFailed: (url) => "图片没能加载，地址：" + url,
    requestTimeout: "请求超时",
    noUrl: "没有可用的附件地址",
    invalidUrl: "附件地址无效",
    disallowedUrl: "不允许的附件地址",
    expired: "附件签名可能已过期，重新打开这个会话再试",
    noTextQuestion: "（无文字提问）",
    conversationStart: "（对话开始）",
    conversationFallback: "DeepSeek 对话",
    exportTitleSuffix: " · 对话大纲",
    exportFooter: (date) => "导出于 " + date,
    searchHitAnswer: (n) => "回答中命中 " + n + " 处",
    searchHitThinking: (n) => "思考中命中 " + n + " 处",
    exportUnread: "（这个附件在导出时还没有读取过正文。附件正文要靠签名地址单独请求，离线 HTML 里拿不到；在网页端点开一次文件名再导出，正文就会带进来。原始地址：",
    exportUnreadEnd: "）",
    httpError: (status, body) => "HTTP " + status + (body ? " " + body : ""),
    noBizData: (code, msg) => "响应里没有 biz_data（code=" + code + " " + msg + "）",
    noMessages: "响应里没有 chat_messages",
  };

  const en = {
    appName: "Conversation Outline",
    fabTitle: "Conversation outline: list every question and answer in this conversation",
    searchPlaceholder: "Search questions and answers… (Ctrl+K)",
    searchPlaceholderShort: "Search questions and answers…",
    searchPlaceholderTiny: "Search… (Ctrl+K)",
    searchFocusTitle: "Press Ctrl+K to focus the search box and select all",
    enterNewline: "Enter for newline",
    enterNewlineTitle: "When checked: Enter inserts a newline, Ctrl+Enter sends",
    searchThinking: "Search thinking",
    searchThinkingTitle: "Also match text inside the thinking block when searching",
    langTitle: "Interface language / 界面语言",
    langAuto: "Auto / 自动",
    langZh: "中文",
    langEn: "English",
    downloadHtml: "Download HTML",
    close: "Close",
    codeFallback: "Code",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed",
    selectCopy: "Selected — press Ctrl+C",
    loading: "Loading…",
    turnSuffix: " turns",
    countAll: (n) => n + (n === 1 ? " turn" : " turns"),
    countFiltered: (shown, total) => shown + " / " + total + " turns",
    noMatch: "No matching questions or answers",
    reading: "Reading this conversation…",
    emptyConversation: "This conversation has nothing to show yet",
    needConversation: "Open a conversation first (URL like /a/chat/s/…) and then click this button.",
    readFailed: (msg) => "Failed to read conversation data: " + msg,
    unknownError: "unknown error",
    pickPrompt: "Pick a question on the left to see its answer here.",
    copyPrompt: "Copy question",
    copyAnswer: "Copy answer",
    copyPromptTitle: "Copy this round's question to the clipboard",
    copyAnswerTitle: "Copy this round's answer as Markdown (code fences kept) to the clipboard",
    noAnswerTitle: "This question has no answer yet",
    jumpToAnswer: "Jump to answer ↓",
    sourceLabel: (n) => "Source " + n,
    questionLabel: (n) => "Question · Round " + n,
    answerLabel: (n) => "Answer · " + n + (n === 1 ? " segment" : " segments"),
    answerSegments: (n) => n + (n === 1 ? " answer" : " answers"),
    noAnswerForThis: "This question has no answer yet.",
    noExport: "Nothing to export (open a conversation first).",
    thinking: "Thinking",
    charsText: (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k chars" : n + " chars"),
    elapsedText: (sec) => sec.toFixed(1) + "s",
    attachClickTitle: (size) => "Click to view attachment" + (size ? " · " + size : ""),
    attachment: "[Attachment]",
    image: "[Image]",
    attachLoading: "Reading attachment…",
    attachFailed: (err) => "Failed to read attachment: " + err,
    attachImageHint: (size) => "Image attachment" + (size ? " (" + size + ")" : "") + " · click to open in a new tab",
    attachImageFailed: (url) => "Image failed to load: " + url,
    requestTimeout: "Request timed out",
    noUrl: "No attachment URL available",
    invalidUrl: "Invalid attachment URL",
    disallowedUrl: "Attachment URL not allowed",
    expired: "Attachment signature may have expired; reopen this conversation and try again",
    noTextQuestion: "(no text question)",
    conversationStart: "(conversation start)",
    conversationFallback: "DeepSeek conversation",
    exportTitleSuffix: " · Conversation Outline",
    exportFooter: (date) => "Exported " + date,
    searchHitAnswer: (n) => n + (n === 1 ? " hit" : " hits") + " in answers",
    searchHitThinking: (n) => n + (n === 1 ? " hit" : " hits") + " in thinking",
    exportUnread: "(This attachment's content was not read before export. Attachment content must be fetched separately from its signed URL and is not available in an offline HTML; open it once on the site before exporting and the content will be included. Original URL: ",
    exportUnreadEnd: ")",
    httpError: (status, body) => "HTTP " + status + (body ? " " + body : ""),
    noBizData: (code, msg) => "Response has no biz_data (code=" + code + " " + msg + ")",
    noMessages: "Response has no chat_messages",
  };

  const DICT = { zh, en };

  const detectBrowserLang = () => {
    let raw = "";
    try { raw = navigator.language || (navigator.languages && navigator.languages[0]) || "en"; } catch (e) { raw = "en"; }
    return String(raw).toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  };

  const readPref = () => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      return v === "zh" || v === "en" ? v : "auto";
    } catch (e) { return "auto"; }
  };

  const getLang = () => {
    const pref = readPref();
    return pref === "auto" ? detectBrowserLang() : pref;
  };

  const t = (key, ...args) => {
    const lang = getLang();
    const table = DICT[lang] || DICT.en;
    let v = table[key];
    if (v == null) v = DICT.en[key];
    if (v == null) return key;
    return typeof v === "function" ? v(...args) : v;
  };

  const setLang = (pref) => {
    const v = pref === "zh" || pref === "en" ? pref : "auto";
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* ignore */ }
    return v;
  };

  window.__dsI18n = { t, getLang, setLang, detectBrowserLang, readPref, STORAGE_KEY };
})();
