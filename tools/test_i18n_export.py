"""导出页的跟随语言 + 语言偏好持久化。

用法：python tools/test_i18n_export.py 9222
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402
import harness as H  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recon", "downloads2")


def set_lang(sess: Session, value: str) -> None:
    sess.eval("""
    (() => {
      const sr = document.getElementById("ds-outline-host").shadowRoot;
      const sel = sr.querySelector(".ho-lang");
      sel.value = %s;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return sel.value;
    })()
    """ % json.dumps(value))
    time.sleep(0.5)


def export(sess: Session) -> str:
    # 面板没开过时 state.turns 是空的，导出会直接报"没有可导出的内容"
    sess.eval("""(() => {
      const sr = document.getElementById("ds-outline-host").shadowRoot;
      if (sr.querySelector(".ho-panel").hidden) sr.querySelector(".ho-fab").click();
      return true;
    })()""")
    for _ in range(60):
        time.sleep(0.25)
        if sess.eval("""(() => {
          const sr = document.getElementById("ds-outline-host").shadowRoot;
          return sr.querySelectorAll("li.ho-item").length > 0;
        })()"""):
            break
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*.html")):
        os.remove(f)
    sess.send("Browser.setDownloadBehavior",
              {"behavior": "allow", "downloadPath": OUT, "eventsEnabled": True})
    sess.eval("""(() => {
      const sr = document.getElementById("ds-outline-host").shadowRoot;
      sr.querySelector(".ho-download").click();
      return true;
    })()""")
    deadline = time.time() + 60
    while time.time() < deadline:
        files = [f for f in glob.glob(os.path.join(OUT, "*.html")) if os.path.getsize(f) > 1000]
        if files:
            time.sleep(1.5)
            return max(files, key=os.path.getsize)
        time.sleep(0.5)
    raise SystemExit("no export file")


def probe_page(sess: Session, path: str) -> dict:
    sess.send("Page.enable")
    sess.send("Page.navigate", {"url": "file:///" + path.replace("\\", "/")})
    time.sleep(5)
    return sess.eval("""(() => {
      const q = (s) => document.querySelector(s);
      const txt = (s) => { const e = q(s); return e ? (e.textContent || "").trim() : null; };
      const meta = [...document.querySelectorAll(".ho-doc-meta")].map((e) => e.textContent.trim());
      return {
        title: document.title,
        header: txt(".ho-doc-title") || (document.querySelector(".ho-doc-head") || {}).textContent,
        placeholder: (q("#ho-search") || {}).placeholder || null,
        meta: meta,
        items: document.querySelectorAll(".ho-item").length,
        questionLabel: txt(".ho-question-label"),
        jump: txt(".ho-jump-btn"),
        copyQ: txt(".ho-copy-q"),
        errors: window.__hoErrors || [],
      };
    })()""")


def main() -> int:
    sess = Session(_pick(9222, "chat.deepseek.com")["webSocketDebuggerUrl"])
    H.ensure_active(sess)
    try:
        # 上一次体检可能把标签页留在 file:// 的导出页，先回到会话
        if not sess.eval("!!document.getElementById('ds-outline-host')"):
            sess.send("Page.enable")
            sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/2c9ce637-29ad-43a8-ba4f-3e28973db6ae"})
            time.sleep(10)
        for lang in ("en", "zh"):
            set_lang(sess, lang)
            path = export(sess)
            print(lang, "export:", os.path.basename(path), os.path.getsize(path), "bytes")
            print(lang, "page   :", json.dumps(probe_page(sess, path), ensure_ascii=False))
            # 回到网页，面板还要在
            sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/2c9ce637-29ad-43a8-ba4f-3e28973db6ae"})
            time.sleep(9)
            print(lang, "back   :", sess.eval("""(() => {
              const sr = document.getElementById("ds-outline-host").shadowRoot;
              return {lang: sr.querySelector(".ho-lang").value,
                      title: sr.querySelector(".ho-title-text").textContent,
                      pref: localStorage.getItem("ds-outline:lang")};
            })()"""))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
