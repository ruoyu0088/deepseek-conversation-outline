#!/usr/bin/env python
"""开发期测试脚手架：通过 CDP 把扩展脚本注入真实页面并做断言。

注意：这是"开发期验证"，不是扩展的运行方式。扩展在 chrome://extensions 里加载后
由 Chrome 自己按 manifest.json 注入到三个世界。
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EXT = os.path.join(ROOT, "ext")
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")

from cdp import Session, _pick  # noqa: E402

# 与 manifest.json 的加载顺序保持一致
SCRIPTS = [
    "src/keymaps.js",
    "src/hook.js",
    "vendor/katex/katex.min.js",
    "vendor/prism-config.js",
    "vendor/prism/prism-core.min.js",
    "vendor/prism/prism-markup.min.js",
    "vendor/prism/prism-css.min.js",
    "vendor/prism/prism-clike.min.js",
    "vendor/prism/prism-markup-templating.min.js",
    "vendor/prism/prism-javascript.min.js",
    "vendor/prism/prism-typescript.min.js",
    "vendor/prism/prism-jsx.min.js",
    "vendor/prism/prism-tsx.min.js",
    "vendor/prism/prism-json.min.js",
    "vendor/prism/prism-python.min.js",
    "vendor/prism/prism-bash.min.js",
    "vendor/prism/prism-sql.min.js",
    "vendor/prism/prism-yaml.min.js",
    "vendor/prism/prism-markdown.min.js",
    "vendor/prism/prism-java.min.js",
    "vendor/prism/prism-c.min.js",
    "vendor/prism/prism-cpp.min.js",
    "vendor/prism/prism-csharp.min.js",
    "vendor/prism/prism-go.min.js",
    "vendor/prism/prism-rust.min.js",
    "vendor/prism/prism-ruby.min.js",
    "vendor/prism/prism-php.min.js",
    "vendor/prism/prism-kotlin.min.js",
    "vendor/prism/prism-swift.min.js",
    "vendor/prism/prism-r.min.js",
    "vendor/prism/prism-diff.min.js",
    "vendor/prism/prism-ini.min.js",
    "vendor/prism/prism-powershell.min.js",
    "vendor/prism/prism-lua.min.js",
    "src/parse.js",
    "src/markdown.js",
    "src/styles.js",
    "src/content.js",
]

# 安全网：拦住所有非 GET 请求（发送消息、改名、删除都走 POST），只记录不发送
BLOCKER = r"""
(() => {
  if (window.__dsBlockedInstalled) return;
  window.__dsBlockedInstalled = true;
  window.__dsBlockedPosts = [];
  const body = (b) => { try { return typeof b === "string" ? b.slice(0, 4000) : (b ? String(b).slice(0, 4000) : ""); } catch (e) { return ""; } };
  const rec = (method, url, b) => {
    if (String(method).toUpperCase() === "GET" || String(method).toUpperCase() === "HEAD") return false;
    window.__dsBlockedPosts.push({ method, url: String(url).slice(0, 160), body: body(b), at: Date.now() });
    return true;
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : ((input && input.url) || "");
    const method = (init && init.method) || (input && input.method) || "GET";
    if (rec(method, url, init && init.body)) {
      return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    }
    return origFetch.apply(this, arguments);
  };
  const oSend = XMLHttpRequest.prototype.send;
  const oOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { this.__bm = m; this.__bu = u; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    if (rec(this.__bm, this.__bu, b)) { try { this.dispatchEvent(new Event("load")); } catch (e) {} return; }
    return oSend.apply(this, arguments);
  };
})();
"""


def ensure_active(sess: Session) -> dict:
    """让 CDP 的输入事件真的能到页面。

    窗口被别的窗口完全遮住时，Chrome 会把页面标成 visibilityState="hidden"：
    那时 Input.dispatchKeyEvent 根本不投递（键盘会"假失败"），
    navigator.clipboard.writeText 也会以 NotAllowedError 拒绝。
    这里用 focus emulation + 生命周期 active 把页面救回前台状态。
    """
    out = {}
    for method, params in (("Page.bringToFront", {}),
                           ("Emulation.setFocusEmulationEnabled", {"enabled": True}),
                           ("Page.setWebLifecycleState", {"state": "active"})):
        try:
            sess.send(method, params)
            out[method] = "ok"
        except Exception as exc:  # noqa: BLE001
            out[method] = str(exc)[:80]
    time.sleep(0.3)
    try:
        out["visibility"] = sess.eval("document.visibilityState")
    except Exception:
        pass
    return out


def connect(port: int, match: str = "chat.deepseek.com") -> Session:
    sess = Session(_pick(port, match)["webSocketDebuggerUrl"])
    ensure_active(sess)
    return sess


def read_script(rel: str) -> str:
    with open(os.path.join(EXT, rel), encoding="utf-8") as f:
        return f.read()


def wait_ready(sess: Session, timeout: float = 40.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if sess.eval("document.readyState") == "complete":
                return
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError("page never became ready")


def reload_and_inject(sess: Session, block_network: bool = True) -> None:
    """刷新页面并注入全部扩展脚本（主世界），顺便装好发送拦截。"""
    sess.send("Page.enable")
    sess.send("Page.reload", {"ignoreCache": True})
    wait_ready(sess)
    time.sleep(1.5)
    if block_network:
        sess.eval(BLOCKER, timeout=60)
    for rel in SCRIPTS:
        # 末尾的 void 0 让 Runtime.evaluate 别去序列化脚本最后一个表达式的值
        # （katex / Prism 的对象图会触发 "Object reference chain is too long"）
        sess.eval(read_script(rel) + "\n;void 0", timeout=120)
    time.sleep(0.6)


def open_panel(sess: Session) -> dict:
    return sess.eval(r"""
    (() => {
      const host = document.getElementById('ds-outline-host');
      if (!host || !host.shadowRoot) return { ok: false, err: 'no host' };
      host.shadowRoot.querySelector('.ho-fab').click();
      return { ok: true };
    })()
    """)


def panel_stats(sess: Session) -> dict:
    return sess.eval(r"""
    (() => {
      const host = document.getElementById('ds-outline-host');
      const sr = host && host.shadowRoot;
      if (!sr) return { err: 'no shadow root' };
      const panel = sr.querySelector('.ho-panel');
      const list = sr.querySelector('.ho-list');
      const detail = sr.querySelector('.ho-detail');
      return {
        open: panel && !panel.hidden,
        count: sr.querySelector('.ho-count') && sr.querySelector('.ho-count').textContent,
        items: list ? list.querySelectorAll('li.ho-item').length : 0,
        empty: list && list.querySelector('.ho-empty') ? list.querySelector('.ho-empty').textContent : null,
        detailText: detail ? (detail.innerText || '').slice(0, 300) : '',
        detailScrollHeight: detail ? detail.scrollHeight : 0,
        question: detail && detail.querySelector('.ho-question') ? detail.querySelector('.ho-question').textContent.slice(0, 120) : null,
        answers: detail ? detail.querySelectorAll('.ho-msg').length : 0,
        codeBlocks: detail ? detail.querySelectorAll('.ho-code').length : 0,
        tokens: detail ? detail.querySelectorAll('.token').length : 0,
        thinks: detail ? detail.querySelectorAll('.ho-think').length : 0,
        thinkOpen: detail ? detail.querySelectorAll('.ho-think-body:not([hidden])').length : 0,
        math: detail ? detail.querySelectorAll('math').length : 0,
        marks: detail ? detail.querySelectorAll('mark').length : 0,
        jump: detail ? !!detail.querySelector('.ho-jump-btn') : false
      };
    })()
    """)


def close_panel(sess: Session) -> dict:
    return sess.eval(r"""
    (() => { const sr = document.getElementById('ds-outline-host').shadowRoot;
      sr.querySelector('.ho-close').click();
      return { open: !sr.querySelector('.ho-panel').hidden }; })()
    """)


def search(sess: Session, text: str) -> dict:
    return sess.eval("""
    (() => {
      const sr = document.getElementById('ds-outline-host').shadowRoot;
      const input = sr.querySelector('.ho-search');
      input.value = %s;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        count: sr.querySelector('.ho-count').textContent,
        items: sr.querySelectorAll('li.ho-item').length,
        marks: sr.querySelectorAll('.ho-detail mark').length,
        listMarks: sr.querySelectorAll('.ho-list mark').length,
        badges: Array.from(sr.querySelectorAll('.ho-badge')).map(b => b.textContent).slice(0, 3),
        thinkOpen: sr.querySelectorAll('.ho-think-body:not([hidden])').length
      };
    })()
    """ % json.dumps(text))
