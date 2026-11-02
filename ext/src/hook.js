/*
 * DeepSeek 对话大纲 — MAIN-world 采集层
 *
 * 职责：
 *  1) 挂钩 window.fetch / XMLHttpRequest，把前端自己请求到的会话 JSON 截获下来，转发给隔离世界的 UI。
 *  2) 记录前端请求用过的鉴权头（authorization），供按需重取历史时复用。
 *  3) 提供按需"取完整对话"的能力（只读 GET，绝不会修改任何会话）。
 *
 * 实测（recon/）：
 *   GET /api/v0/chat/history_messages?chat_session_id=<uuid>
 *     Authorization: Bearer <localStorage.userToken.value>
 *   → {code:0, data:{biz_data:{chat_session:{...}, chat_messages:[...]}}}
 *   一次返回整个会话（154 条消息 / 1.4 MB 实测无分页），所以不需要翻页。
 *
 * 只读：这里只会 GET，从不 POST/PUT/DELETE，也不会发送任何消息。
 */
(() => {
  "use strict";
  if (window.__dsOutlineHook) return;
  window.__dsOutlineHook = true;

  const FLAG = "__dsOutline";
  const REQ = "__dsOutlineReq";
  const HISTORY_API = /\/api\/v0\/chat\/history_messages(?:[?#]|$)/;
  const MAX_MESSAGES = 4000;

  /** 前端最近一次用过的请求头（小写键名）。 */
  let lastAuthHeaders = null;

  const post = (type, payload) => {
    try { window.postMessage(Object.assign({ [FLAG]: true, type }, payload), "*"); } catch (e) { /* ignore */ }
  };

  const headersToObject = (headers) => {
    const out = {};
    try {
      if (!headers) return out;
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
      } else if (Array.isArray(headers)) {
        headers.forEach((pair) => { if (pair && pair.length === 2) out[String(pair[0]).toLowerCase()] = pair[1]; });
      } else if (typeof headers === "object") {
        Object.keys(headers).forEach((k) => { out[String(k).toLowerCase()] = headers[k]; });
      }
    } catch (e) { /* ignore */ }
    return out;
  };

  const rememberAuth = (headers) => {
    const h = headersToObject(headers);
    if (h.authorization) lastAuthHeaders = Object.assign({}, lastAuthHeaders, h);
  };

  /** localStorage.userToken 是 {"value":"<64 字符>"}，页面的 Authorization 就取自它。 */
  const tokenFromStorage = () => {
    try {
      const raw = window.localStorage.getItem("userToken");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const v = parsed && (parsed.value || parsed);
      return typeof v === "string" && v ? v : null;
    } catch (e) {
      return null;
    }
  };

  const sessionIdOf = (url) => {
    try {
      const m = /[?&]chat_session_id=([0-9a-fA-F-]{36})/.exec(url || "");
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  };

  const deliver = (url, data) => {
    const sessionId = sessionIdOf(url);
    if (!sessionId || !data) return;
    const biz = (data && data.data && data.data.biz_data) || null;
    if (!biz || !Array.isArray(biz.chat_messages)) return;
    post("payload", {
      sessionId,
      url,
      title: (biz.chat_session && biz.chat_session.title) || null,
      messages: biz.chat_messages
    });
  };

  /* ---------------------------------------------------------------- fetch */
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const input = args[0];
      const init = args[1];
      let url = "";
      let isHistory = false;
      try {
        url = typeof input === "string" ? input : (input && input.url) || "";
        isHistory = HISTORY_API.test(url);
        if (isHistory) rememberAuth((init && init.headers) || (input && input.headers));
      } catch (e) { /* ignore */ }

      const promise = origFetch.apply(this, args);
      try {
        if (isHistory) {
          promise.then((resp) => {
            if (!resp || !resp.ok || typeof resp.clone !== "function") return;
            resp.clone().json()
              .then((data) => deliver(url, data))
              .catch(() => { /* 非 JSON 或已被消费，忽略 */ });
          }).catch(() => { /* 交给页面自己的错误处理 */ });
        }
      } catch (e) { /* ignore */ }
      return promise;
    };
  }

  /* ------------------------------------------------------------------ XHR */
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__ds_url = String(url || "");
      this.__ds_headers = {};
    } catch (e) { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__ds_headers) this.__ds_headers[String(name).toLowerCase()] = value;
    } catch (e) { /* ignore */ }
    return origSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    try {
      const url = this.__ds_url || "";
      if (HISTORY_API.test(url)) {
        rememberAuth(this.__ds_headers);
        this.addEventListener("load", () => {
          try {
            const ct = this.getResponseHeader("content-type") || "";
            if (this.status >= 200 && this.status < 300 && ct.indexOf("json") >= 0) {
              deliver(url, JSON.parse(this.responseText));
            }
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    return origSend.apply(this, args);
  };

  /* ------------------------------------------------- 按需取完整历史（只读） */
  async function authHeaders() {
    const h = Object.assign({ accept: "*/*" }, lastAuthHeaders || {});
    const token = (h.authorization || "").replace(/^Bearer\s+/i, "") || tokenFromStorage();
    if (token) h.authorization = "Bearer " + token;
    delete h["content-length"];
    return h;
  }

  async function collectHistory(sessionId) {
    const headers = await authHeaders();
    const url = "/api/v0/chat/history_messages?chat_session_id=" + encodeURIComponent(sessionId);
    const resp = await origFetch(url, { credentials: "include", headers, method: "GET" });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error("HTTP " + resp.status + (body ? " " + body.slice(0, 200) : ""));
    }
    const data = await resp.json();
    const biz = (data && data.data && data.data.biz_data) || null;
    if (!biz) throw new Error("响应里没有 biz_data（code=" + (data && data.code) + " " + ((data && data.msg) || "") + "）");
    if (!Array.isArray(biz.chat_messages)) throw new Error("响应里没有 chat_messages");
    const messages = biz.chat_messages.slice(0, MAX_MESSAGES);
    return {
      messages,
      title: (biz.chat_session && biz.chat_session.title) || null,
      session: biz.chat_session || null,
      pages: 1
    };
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d[FLAG] || !d[REQ]) return;
    if (d.action === "fetchHistory" && d.sessionId) {
      const { sessionId, requestId } = d;
      collectHistory(sessionId)
        .then((res) => post("history", Object.assign({ sessionId, requestId, ok: true }, res)))
        .catch((err) => post("history", { sessionId, requestId, ok: false, error: String((err && err.message) || err) }));
    }
  });

  post("ready", {});
})();
