/*
 * 纯逻辑：把 DeepSeek 的 chat_messages 整理成「提问 → 回答」的轮次。
 * 与界面解耦，便于用真实抓到的 JSON 单独验证。
 *
 * 真实数据结构（抓包确认，recon/raw-*.json）：
 *   GET /api/v0/chat/history_messages?chat_session_id=<id>
 *   → {"code":0,"data":{"biz_data":{"chat_session":{...},"chat_messages":[...]}}}
 *   message = {
 *     message_id: 1..n        // 会话内单调递增，UI 顺序就是它（inserted_at 不可靠：
 *                             //   助手消息的时间戳有时比提问还早几十毫秒）
 *     role: "USER" | "ASSISTANT",
 *     status: "FINISHED" | "WIP",
 *     fragments: [ {type:"REQUEST"|"THINK"|"RESPONSE"|"TIP"|"TOOL_SEARCH"|"TOOL_OPEN"|"FILE", ...} ]
 *   }
 *   REQUEST/RESPONSE/THINK 的正文都在 fragment.content（Markdown）；
 *   FILE 在 fragment.files[]（file_name / is_image）；TIP 是"AI 生成"免责声明。
 */
(() => {
  "use strict";
  if (window.__dsParse) return;

  /** FILE fragment → 附件占位行。 */
  const filesText = (fragment) => {
    const files = (fragment && fragment.files) || [];
    const lines = [];
    for (const f of files) {
      if (!f) continue;
      if (f.is_image) { lines.push("[图片]"); continue; }
      const name = String(f.file_name || "").trim();
      lines.push(name ? "[附件] " + name : "[附件]");
    }
    return lines.join("\n");
  };

  /** FILE fragment 里可能出现的完整 URL 字段（有则直接用）。 */
  const pickUrl = (f) => {
    const keys = ["download_url", "file_url", "url", "src", "href"];
    for (const k of keys) {
      const v = f[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
    return "";
  };
  /** 文件 id：真实数据里是 "file-<uuid>"，也兼容 file_id / fileId；"file-" 前缀要剥掉。 */
  const pickId = (f) => {
    const v = f.file_id || f.fileId || f.id;
    if (typeof v !== "string" || !v) return "";
    return v.indexOf("file-") === 0 ? v.slice(5) : v;
  };
  const pickState = (f) => {
    const v = f.state || f.file_state || f.fileState || f.token || f.sign;
    return typeof v === "string" ? v : "";
  };

  /**
   * 附件的下载地址。实测（recon/probe_file_url.js）：
   *   fetch("https://files.deepseeksvc.com/api" + signed_path)          → Failed to fetch
   *   fetch("https://files.deepseeksvc.com/api" + signed_path + "&ty=r") → 200，正文
   * 所以 ty=r（"读文本"）是必须的；且必须 credentials:"omit"（带 cookie 会被 CORS 拒）。
   * 签名（state）本身就在 signed_path 里，不需要 Authorization。
   */
  const FILE_BASE = "https://files.deepseeksvc.com/api";
  const fileUrlOf = (f) => {
    const direct = pickUrl(f);
    if (direct) return direct;

    let path = typeof f.signed_path === "string" ? f.signed_path : "";
    if (!path && pickId(f) && pickState(f)) {
      path = "/file?file_id=" + encodeURIComponent(pickId(f)) + "&state=" + encodeURIComponent(pickState(f));
    }
    if (!path) return "";

    if (/^https?:\/\//i.test(path)) {                       // 已经是绝对地址
      // 只用它的 origin + path+query，保证不会被指向别的站
      try {
        const u = new URL(path);
        if (u.hostname !== "files.deepseeksvc.com") return "";
        path = u.pathname + u.search;
      } catch (e) { return ""; }
    }
    if (path.charAt(0) !== "/") path = "/" + path;
    const abs = FILE_BASE + path;
    return /[?&]ty=/.test(abs) ? abs : abs + (abs.indexOf("?") >= 0 ? "&" : "?") + "ty=r";
  };

  /** FILE fragment → { name, isImage, size, fileId, state, url, text, raw }。
   *  text 只取消息里能直接读到的字段；正文通常需要点击时再请求（content.js → hook.js）。 */
  const attachmentsOf = (fragment) => {
    const files = (fragment && fragment.files) || [];
    const out = [];
    for (const f of files) {
      if (!f) continue;
      const text =
        (typeof f.content === "string" && f.content) ||
        (typeof f.text === "string" && f.text) ||
        (typeof f.file_content === "string" && f.file_content) ||
        (typeof f.body === "string" && f.body) ||
        "";
      out.push({
        name: String(f.file_name || "").trim(),
        isImage: !!f.is_image,
        size: Number(f.file_size) || 0,
        fileId: pickId(f),
        state: pickState(f),
        url: fileUrlOf(f),
        text: String(text || ""),
        raw: f
      });
    }
    return out;
  };

  /**
   * 把一条 DeepSeek 消息拆成 {request, thinking[], answers[], files[], refs[], elapsed}。
   * 只取"界面上看得到"的内容：TIP（免责声明）与 TOOL_*（联网检索过程）都跳过。
   *
   * 联网搜索时，回答正文里会混着 `[reference:0]`、`[reference:1]` 这样的角标，
   * 序号指向该 RESPONSE 片段的 references 数组；references 里的 id 又能对到同一条消息里
   * 的 TOOL_OPEN（有 result.url/title）或 TOOL_SEARCH（有 urls）片段。这里把这张表建好，
   * 界面渲染时换成可点的"来源角标"。
   */
  function decompose(message) {
    const out = { request: "", thinking: [], answers: [], files: [], attachments: [], refs: [], elapsed: 0 };
    const tools = {};
    for (const f of (message && message.fragments) || []) {
      if (!f || f.id == null) continue;
      const type = String(f.type || "").toUpperCase();
      if (type === "TOOL_OPEN" || type === "TOOL_SEARCH") tools[f.id] = f;
    }

    for (const f of (message && message.fragments) || []) {
      if (!f) continue;
      const type = String(f.type || "").toUpperCase();
      const content = typeof f.content === "string" ? f.content : "";
      switch (type) {
        case "REQUEST":
          if (content.trim()) out.request += (out.request ? "\n\n" : "") + content;
          break;
        case "THINK":
          if (content.trim()) {
            out.thinking.push(content);
            if (Number.isFinite(f.elapsed_secs)) out.elapsed += Number(f.elapsed_secs);
          }
          break;
        case "RESPONSE":
          if (content.trim()) out.answers.push(content);
          if (!out.refs.length && Array.isArray(f.references) && f.references.length) {
            out.refs = f.references.map((r) => {
              const tool = (r && tools[r.id]) || null;
              const result = (tool && tool.result) || {};
              const url = result.url || ((r && r.urls && r.urls[0]) || "");
              return { url: String(url || ""), title: String(result.title || "") };
            });
          }
          break;
        case "FILE": {
          const text = filesText(f);
          if (text) out.files.push(text);
          const atts = attachmentsOf(f);
          if (atts.length) out.attachments.push.apply(out.attachments, atts);
          break;
        }
        default:
          break;                       // TIP / TOOL_SEARCH / TOOL_OPEN / 未知类型
      }
    }
    return out;
  }

  /**
   * 用于搜索的文本：把 Markdown 记号"还原成它渲染出来的样子"，而不是简单地删字符。
   * 关键点：只去掉**成对**的强调标记（**粗体** / _斜体_ / `代码` / ~~删除~~），
   * 孤立的下划线必须保留——否则 X_prg、step_length 这类标识符会被破坏。
   * 围栏代码块与行内代码的内容原样保留（里面的 __init__、a*b 等不应被当成 Markdown）。
   */
  function searchableText(s) {
    const literals = [];
    const stash = (text) => {
      literals.push(text);
      return "\u0000L" + (literals.length - 1) + "\u0000";
    };
    let t = String(s == null ? "" : s);
    t = t.replace(/\[reference:\d+\]/g, "");                               // 联网检索的角标
    t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (m, body) => stash(body));   // 围栏代码块
    t = t.replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, (m, body) => stash(body));
    t = t.replace(/`([^`\n]+)`/g, (m, body) => stash(body));                // 行内代码
    t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[\s(（])_([^\s_][^_]*?)_(?=[\s)）.,，。:：;；!?！？]|$)/g, "$1$2")
      .replace(/(^|[\s(（])\*([^\s*][^*]*?)\*(?=[\s)）.,，。:：;；!?！？]|$)/g, "$1$2")
      .replace(/^#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/\u0000L(\d+)\u0000/g, (m, i) => literals[Number(i)]);
    return t.replace(/\s+/g, " ").trim();
  }

  /** 合并 THINK 片段（一次回答可能分多段思考）。 */
  const joinThinking = (parts) => (parts || []).filter((s) => s && s.trim()).join("\n\n");

  /**
   * @param {Array} messages 原始 chat_messages（顺序不限）
   * @returns {Array<{
   *   q: string, qSearch: string,
   *   answers: Array<{text: string, thinking: string, refs: number}>,
   *   answersSearch: string[], thinkingSearch: string[],
   *   time: number, id: number|string, synthetic?: boolean
   * }>}
   */
  function buildTurns(messages) {
    const sorted = (messages || []).filter(Boolean).slice().sort((a, b) => {
      const am = Number(a.message_id);
      const bm = Number(b.message_id);
      if (Number.isFinite(am) && Number.isFinite(bm) && am !== bm) return am - bm;
      return (a.inserted_at || 0) - (b.inserted_at || 0);
    });

    const turns = [];
    let cur = null;
    for (const m of sorted) {
      const role = String(m.role || "").toUpperCase();
      if (role !== "USER" && role !== "ASSISTANT") continue;
      const d = decompose(m);
      const body = [d.request, d.files.join("\n")].filter((s) => s && s.trim()).join("\n\n").trim();

      if (role === "USER") {
        cur = {
          q: body || "（无文字提问）",
          // 纯提问文字（不含 "[附件] xxx" 行）：面板里附件用可点的文件名单独显示，不重复
          qText: String(d.request || "").trim(),
          qSearch: searchableText(body),
          attachments: d.attachments || [],
          answers: [], answersSearch: [], thinkingSearch: [],
          time: m.inserted_at, id: m.message_id
        };
        turns.push(cur);
        continue;
      }

      // 助手消息
      const thinking = joinThinking(d.thinking);
      const text = d.answers.join("\n\n");
      if (!text && !thinking) continue;
      if (!cur) {                                      // 开场就是助手消息
        cur = {
          q: "（对话开始）", qSearch: "",
          answers: [], answersSearch: [], thinkingSearch: [],
          time: m.inserted_at, id: m.message_id, synthetic: true
        };
        turns.push(cur);
      }
      cur.answers.push({ text: text, thinking: thinking, elapsed: d.elapsed || 0, refs: d.refs || [] });
      cur.answersSearch.push(searchableText(text));
      cur.thinkingSearch.push(searchableText(thinking));
    }
    return turns;
  }

  window.__dsParse = { decompose, searchableText, buildTurns };
})();
