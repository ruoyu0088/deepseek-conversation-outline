#!/usr/bin/env python
"""DeepSeek 对话大纲 — 开发期侦察脚本（走 CDP）。

用途：在真实登录态页面上
  1) 注入 MAIN-world 记录器，抓页面自己发出的请求（含 history_messages 的响应体）
  2) 打开一个会话，把原始 JSON 存到 recon/
  3) 探明输入框 / 发送按钮 / 侧边栏的 DOM 结构

用法：
  python tools/recon_deepseek.py 9222 --status
  python tools/recon_deepseek.py 9222 --capture          # 记录器 + 打开会话 + 存包
  python tools/recon_deepseek.py 9222 --dom              # 打印输入框等 DOM 信息
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RECON = os.path.join(ROOT, "recon")
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")

from cdp import Session, _pick  # noqa: E402

RECORDER = r"""
(() => {
  if (window.__dsRecon) return;
  const R = { reqs: [], bodies: {}, errors: [] };
  window.__dsRecon = R;
  const keep = (url) => /history_messages|chat_session|fetch_page|chat\/completion|chat\//.test(url);
  const hdrs = (h) => {
    const out = {};
    try {
      if (!h) return out;
      if (typeof Headers !== "undefined" && h instanceof Headers) h.forEach((v, k) => { out[k] = String(v).slice(0, 24); });
      else if (Array.isArray(h)) h.forEach((p) => { if (p && p.length === 2) out[p[0]] = String(p[1]).slice(0, 24); });
      else if (typeof h === "object") Object.keys(h).forEach((k) => { out[k] = String(h[k]).slice(0, 24); });
    } catch (e) {}
    return out;
  };
  const save = (url, text) => {
    try { if (keep(url) && !R.bodies[url]) R.bodies[url] = text; } catch (e) {}
  };
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : ((input && input.url) || "");
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const rec = { url, method, headers: hdrs((init && init.headers) || (input && input.headers)), at: Date.now() };
      R.reqs.push(rec);
      const p = origFetch.apply(this, arguments);
      try {
        p.then((resp) => {
          rec.status = resp && resp.status;
          rec.ct = resp && resp.headers && resp.headers.get("content-type");
          if (resp && resp.ok && resp.clone && keep(url)) {
            resp.clone().text().then((t) => { rec.len = t.length; save(url, t); }).catch(() => {});
          }
        }, (e) => { rec.err = String(e); });
      } catch (e) { R.errors.push(String(e)); }
      return p;
    };
  }
  const oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__r = { url: String(u || ""), method: String(m || "GET").toUpperCase() }; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const rec = this.__r || { url: "", method: "?" };
    R.reqs.push(rec);
    this.addEventListener("load", () => {
      rec.status = this.status;
      try { if (this.status < 300 && keep(rec.url)) { rec.len = (this.responseText || "").length; save(rec.url, this.responseText); } } catch (e) {}
    });
    return oSend.apply(this, arguments);
  };
})();
"""

STATUS_JS = r"""
(() => {
  const ls = {};
  try { Object.keys(localStorage).forEach((k) => { const v = localStorage.getItem(k) || ""; ls[k] = v.length > 60 ? v.slice(0, 60) + "…(" + v.length + ")" : v; }); } catch (e) { ls.error = String(e); }
  return {
    href: location.href, title: document.title,
    localStorageKeys: Object.keys(ls),
    tokenLike: Object.keys(ls).filter((k) => /token|auth|user/i.test(k)),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    convLinks: Array.from(document.querySelectorAll('a[href*="/a/chat/s/"]')).slice(0, 5).map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 40) }))
  };
})()
"""

DOM_JS = r"""
(() => {
  const info = (el) => {
    if (!el) return null;
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = String(a.value).slice(0, 80);
    return {
      tag: el.tagName, attrs, cls: el.className && String(el.className).slice(0, 120),
      editable: el.isContentEditable, text: (el.value != null ? String(el.value) : (el.textContent || "")).slice(0, 60),
      rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
    };
  };
  const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).map(info);
  const btns = Array.from(document.querySelectorAll("button")).map((b) => {
    const attrs = {}; for (const a of b.attributes) attrs[a.name] = String(a.value).slice(0, 60);
    return { attrs, text: (b.textContent || "").trim().slice(0, 20), disabled: b.disabled,
             rect: (() => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() };
  }).filter((b) => b.rect.w > 0);
  return { url: location.href, inputs: cands, buttons: btns };
})()
"""


def get_page(port, match=None):
    return _pick(port, match or "chat.deepseek.com")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--capture", action="store_true")
    ap.add_argument("--dom", action="store_true")
    ap.add_argument("--match", default="chat.deepseek.com")
    args = ap.parse_args()

    os.makedirs(RECON, exist_ok=True)
    sess = Session(get_page(args.port, args.match)["webSocketDebuggerUrl"])
    try:
        if args.status:
            print(json.dumps(sess.eval(STATUS_JS), ensure_ascii=False, indent=1))
            return 0
        if args.capture:
            sess.send("Page.enable")
            sess.send("Page.addScriptToEvaluateOnNewDocument", {"source": RECORDER})
            sess.send("Page.reload", {"ignoreCache": True})
            time.sleep(1.0)
            for _ in range(40):
                try:
                    if sess.eval("document.readyState") == "complete":
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            time.sleep(2.0)
            print("status:", sess.eval("location.href"))
            clicked = sess.eval(r"""
            (() => {
              const a = document.querySelector('a[href*="/a/chat/s/"]');
              if (!a) return { ok: false, count: 0, sample: document.body.innerText.slice(0, 300) };
              a.click();
              return { ok: true, href: a.getAttribute('href') };
            })()
            """)
            print("click:", json.dumps(clicked, ensure_ascii=False)[:500])
            time.sleep(5.0)
            out = sess.eval(r"""
            (() => {
              const R = window.__dsRecon || { reqs: [], bodies: {} };
              return {
                href: location.href,
                reqs: R.reqs.map((r) => ({ url: r.url, method: r.method, status: r.status, ct: r.ct, len: r.len, err: r.err, authHdr: Object.keys(r.headers || {}).filter((k) => /auth|token/i.test(k)) })),
                bodyKeys: Object.keys(R.bodies)
              };
            })()
            """)
            print(json.dumps(out, ensure_ascii=False, indent=1)[:6000])
            # 存响应体
            bodies = sess.eval("(() => { const R = window.__dsRecon; const o = {}; for (const k in R.bodies) o[k] = R.bodies[k]; return o; })()")
            if isinstance(bodies, dict):
                for i, (url, text) in enumerate(bodies.items()):
                    fn = os.path.join(RECON, "body-%02d.json" % i)
                    with open(fn, "w", encoding="utf-8") as f:
                        f.write(text)
                    print("saved", fn, len(text), "←", url[:120])
                with open(os.path.join(RECON, "bodies-index.json"), "w", encoding="utf-8") as f:
                    json.dump(list(bodies.keys()), f, ensure_ascii=False, indent=1)
            return 0
        if args.dom:
            print(json.dumps(sess.eval(DOM_JS), ensure_ascii=False, indent=1))
            return 0
        print(json.dumps(sess.eval("({url: location.href, title: document.title})"), ensure_ascii=False, indent=1))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
