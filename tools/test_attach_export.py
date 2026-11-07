#!/usr/bin/env python
"""验证附件：第二个附件能读、内容能进导出文件。

用法：python tools/test_attach_export.py 9222
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
sys.path.insert(0, HERE)

from cdp import Session, _pick  # noqa: E402

SESSION = "2c9ce637-29ad-43a8-ba4f-3e28973db6ae"


def wait_items(sess):
    for _ in range(40):
        time.sleep(0.5)
        n = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelectorAll('li.ho-item').length")
        if n:
            return n
    return 0


def click_item(sess, idx):
    sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelectorAll('li.ho-item')[%d].click()" % idx)


def click_attach(sess):
    return sess.eval("""
    (() => {
      const sr = document.getElementById('ds-outline-host').shadowRoot;
      const btn = sr.querySelector('.ho-detail .ho-attach-name');
      if (!btn) return { err: 'no attach' };
      btn.click();
      return { name: btn.textContent, title: btn.title };
    })()
    """)


def read_viewer(sess):
    return sess.eval("""
    (() => {
      const sr = document.getElementById('ds-outline-host').shadowRoot;
      const row = sr.querySelector('.ho-detail .ho-attach');
      if (!row) return { err: 'no row' };
      const ta = row.querySelector('.ho-attach-text');
      const hint = row.querySelector('.ho-attach-hint');
      return {
        len: ta && !ta.hidden ? ta.value.length : 0,
        head: ta && !ta.hidden ? ta.value.slice(0, 80) : null,
        hint: hint && !hint.hidden ? hint.textContent : null
      };
    })()
    """)


def main() -> int:
    sess = Session(_pick(9222, "chat.deepseek.com")["webSocketDebuggerUrl"])
    problems = []
    try:
        sess.send("Page.enable")
        sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/" + SESSION})
        time.sleep(7)
        sess.eval("(() => { const sr = document.getElementById('ds-outline-host').shadowRoot; if (sr.querySelector('.ho-panel').hidden) sr.querySelector('.ho-fab').click(); })()")
        print("items:", wait_items(sess))

        # 1) 第二个附件：right {.txt
        click_item(sess, 53)
        time.sleep(0.5)
        print("turn 54:", click_attach(sess))
        st = {}
        for _ in range(30):
            time.sleep(0.4)
            st = read_viewer(sess)
            if st.get("len"):
                break
        print("  ->", json.dumps(st, ensure_ascii=False))
        if not st.get("len"):
            problems.append("第二个附件没读出来：%s" % st)

        # 2) 第一个附件：bundle.txt，记下内容特征
        click_item(sess, 18)
        time.sleep(0.5)
        print("turn 19:", click_attach(sess))
        st2 = {}
        for _ in range(40):
            time.sleep(0.4)
            st2 = read_viewer(sess)
            if st2.get("len"):
                break
        print("  ->", json.dumps(st2, ensure_ascii=False)[:300])
        if not st2.get("len"):
            problems.append("第一个附件没读出来：%s" % st2)
            return 1

        marker = "PyCale" if "PyCalc" in str(st2.get("head")) else None
        sample = sess.eval("""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const v = sr.querySelector('.ho-detail .ho-attach-text').value;
          return v.slice(200, 320);
        })()
        """)
        print("  sample:", repr(sample))

        # 3) 导出（已读过的附件正文应当带进 HTML）
        out_dir = os.path.join(ROOT, "recon", "downloads2")
        if os.path.isdir(out_dir):
            for f in glob.glob(os.path.join(out_dir, "*")):
                os.remove(f)
        os.makedirs(out_dir, exist_ok=True)
        sess.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": out_dir, "eventsEnabled": True}, timeout=10)
        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-download').click()")
        files = []
        for _ in range(60):
            time.sleep(0.5)
            files = [f for f in glob.glob(os.path.join(out_dir, "*")) if not f.endswith(".crdownload")]
            if files:
                time.sleep(1.0)
                break
        if not files:
            problems.append("导出没落盘")
        else:
            p = files[0]
            html = open(p, encoding="utf-8", errors="replace").read()
            print("  export:", os.path.basename(p), len(html), "chars")
            if sample and sample[:40] in html:
                print("  附件正文已写进导出文件 ✓")
            else:
                problems.append("导出文件里没有附件正文（样本 %r）" % sample[:40])
            if "（导出页无法请求附件内容" in html:
                print("  仍有占位提示（针对没打开过的附件，正常）")
            print("  attach rows:", html.count('class="ho-attach"'), "textarea:", html.count("ho-attach-text"))

        print()
        print("PROBLEMS:", problems or "none")
        return 1 if problems else 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
