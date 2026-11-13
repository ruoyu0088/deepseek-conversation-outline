"""语言切换回归：面板文案随 ds-outline:lang 切换、刷新后保持、搜索仍工作。

用法：python tools/test_i18n.py 9222
"""
from __future__ import annotations

import json
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402
import harness as H  # noqa: E402

SNAP = r"""
(() => {
  const host = document.getElementById("ds-outline-host");
  if (!host) return { error: "no host" };
  const sr = host.shadowRoot;
  const q = (s) => sr.querySelector(s);
  const txt = (s) => { const el = q(s); return el ? (el.textContent || "").trim() : null; };
  return {
    title: txt(".ho-title-text"),
    count: txt(".ho-count"),
    placeholder: (q(".ho-search") || {}).placeholder || null,
    enter: txt(".ho-enter-text"),
    think: txt(".ho-think-text"),
    download: txt(".ho-download"),
    close: txt(".ho-close"),
    langValue: (q(".ho-lang") || {}).value || null,
    fab: (q(".ho-fab") || {}).title || null,
    items: sr.querySelectorAll("li.ho-item").length,
    firstQ: txt("li.ho-item .ho-item-q"),
    detailQ: txt(".ho-question"),
    questionLabel: txt(".ho-question-label"),
    jump: txt(".ho-jump-btn"),
    copyQ: txt(".ho-copy-q"),
    copyA: txt(".ho-copy-a"),
    thinkTitle: txt(".ho-think-title"),
    codeLang: txt(".ho-code-lang"),
  };
})()
"""


def open_panel(sess: Session) -> None:
    sess.eval(r"""
    (() => {
      const host = document.getElementById("ds-outline-host");
      if (!host) return false;
      const sr = host.shadowRoot;
      const panel = sr.querySelector(".ho-panel");
      if (panel.hidden) sr.querySelector(".ho-fab").click();
      return true;
    })()
    """)
    for _ in range(40):
        time.sleep(0.25)
        if sess.eval("""(() => {
          const host = document.getElementById("ds-outline-host");
          return !!(host && host.shadowRoot.querySelectorAll("li.ho-item").length);
        })()"""):
            return
    raise SystemExit("panel/list never appeared")


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
    time.sleep(0.6)


def main() -> int:
    sess = Session(_pick(9222, "chat.deepseek.com")["webSocketDebuggerUrl"])
    H.ensure_active(sess)
    try:
        open_panel(sess)
        print("auto   :", json.dumps(sess.eval(SNAP), ensure_ascii=False))
        set_lang(sess, "zh")
        print("zh     :", json.dumps(sess.eval(SNAP), ensure_ascii=False))
        set_lang(sess, "en")
        print("en     :", json.dumps(sess.eval(SNAP), ensure_ascii=False))
        # 搜索在两种语言下都要照常工作
        for lang in ("en", "zh"):
            set_lang(sess, lang)
            sess.eval("""(() => {
              const sr = document.getElementById("ds-outline-host").shadowRoot;
              const inp = sr.querySelector(".ho-search");
              inp.value = "Pyodide";
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              return true;
            })()""")
            time.sleep(0.8)
            print("search %s:" % lang, json.dumps(sess.eval("""(() => {
              const sr = document.getElementById("ds-outline-host").shadowRoot;
              const host = document.getElementById("ds-outline-host");
              return {
                count: (sr.querySelector(".ho-count") || {}).textContent,
                items: sr.querySelectorAll("li.ho-item").length,
                marks: sr.querySelectorAll("mark").length,
              };
            })()"""), ensure_ascii=False))
        sess.eval("""(() => {
          const sr = document.getElementById("ds-outline-host").shadowRoot;
          const inp = sr.querySelector(".ho-search");
          inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()""")
        print("pref now:", sess.eval("localStorage.getItem('ds-outline:lang')"))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
