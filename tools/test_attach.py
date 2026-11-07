#!/usr/bin/env python
"""测试「点击附件文件名 → 请求并显示附件内容」。

用法：python tools/test_attach.py 9222 [sessionId]
前提：页面已加载扩展（tools/launch_debug.py）。
"""
from __future__ import annotations

import json
import sys
import time

HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")

from cdp import Session, _pick  # noqa: E402

DEFAULT_SESSION = "2c9ce637-29ad-43a8-ba4f-3e28973db6ae"   # 有 bundle.txt / right {.txt 两个附件


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    session = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SESSION
    problems = []
    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.send("Page.enable")
        sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/" + session})
        time.sleep(7)
        print("host:", sess.eval("!!document.getElementById('ds-outline-host')"))

        # 打开面板并等历史数据到位（列表项出现）再找附件
        sess.eval("(() => { const sr = document.getElementById('ds-outline-host').shadowRoot; if (sr.querySelector('.ho-panel').hidden) sr.querySelector('.ho-fab').click(); })()")
        for _ in range(40):
            time.sleep(0.5)
            n = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelectorAll('li.ho-item').length")
            if n:
                break
        print("turns in list:", n)

        found = sess.eval(r"""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const items = Array.from(sr.querySelectorAll('li.ho-item'));
          const detail = sr.querySelector('.ho-detail');
          for (let i = 0; i < items.length; i++) {
            items[i].click();
            const rows = detail.querySelectorAll('.ho-attach');
            if (rows.length) {
              const btn = rows[0].querySelector('.ho-attach-name');
              return { index: i, rows: rows.length, name: btn ? btn.textContent : null };
            }
          }
          return { index: -1 };
        })()
        """)
        print("attachment turn:", json.dumps(found, ensure_ascii=False))
        if found.get("index", -1) < 0:
            problems.append("没有找到带附件的提问")

        # 附件地址是否已经能从消息数据里拼出来（不需要页面先请求过一次）
        info = sess.eval(r"""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const btn = sr.querySelector('.ho-detail .ho-attach-name');
          if (!btn) return { err: 'no attach button' };
          const before = sr.querySelector('.ho-detail .ho-attach-text');
          btn.click();
          return { clicked: true, hadText: before ? before.value.length : null };
        })()
        """)
        print("click:", json.dumps(info, ensure_ascii=False))

        # 等内容加载（大文件 400KB 左右）
        state = {}
        for _ in range(40):
            time.sleep(0.5)
            state = sess.eval(r"""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const row = sr.querySelector('.ho-detail .ho-attach');
              if (!row) return { err: 'no row' };
              const ta = row.querySelector('.ho-attach-text');
              const hint = row.querySelector('.ho-attach-hint');
              return {
                hidden: !!(ta && ta.hidden),
                len: ta && !ta.hidden ? ta.value.length : 0,
                head: ta && !ta.hidden ? ta.value.slice(0, 60) : null,
                hint: hint && !hint.hidden ? hint.textContent : null,
                viewerHidden: row.querySelector('.ho-attach-viewer').hidden
              };
            })()
            """)
            if state.get("len") or (state.get("hint") and "正在读取" not in state.get("hint", "")):
                break
        print("after click:", json.dumps(state, ensure_ascii=False))

        if not state.get("len"):
            problems.append("附件内容没有加载出来：%s" % (state.get("hint") or state))
        else:
            if state["len"] < 100:
                problems.append("附件内容太短，可能不对")

        # 再点一次：收起；第三次：用的是缓存，应当立刻有内容
        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-detail .ho-attach-name').click()")
        time.sleep(0.3)
        collapsed = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-detail .ho-attach-viewer').hidden")
        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-detail .ho-attach-name').click()")
        time.sleep(0.3)
        again = sess.eval("""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const ta = sr.querySelector('.ho-detail .ho-attach-text');
          return { len: ta && !ta.hidden ? ta.value.length : 0, viewerHidden: sr.querySelector('.ho-detail .ho-attach-viewer').hidden };
        })()
        """)
        print("toggle:", json.dumps({"collapsed": collapsed, "again": again}, ensure_ascii=False))
        if not collapsed:
            problems.append("再次点击没有收起")
        if not again.get("len"):
            problems.append("重新展开后内容丢了")

        # URL 详情（调试用）
        urls = sess.eval(r"""
        (() => {
          const host = document.getElementById('ds-outline-host');
          const rows = host.shadowRoot.querySelectorAll('.ho-detail .ho-attach');
          return Array.from(rows).map((r) => r.querySelector('.ho-attach-name').title);
        })()
        """)
        print("rows:", json.dumps(urls, ensure_ascii=False))

        print()
        print("PROBLEMS:", problems or "none")
        return 1 if problems else 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
