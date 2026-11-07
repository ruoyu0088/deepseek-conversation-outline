#!/usr/bin/env python
"""截图：选中某轮、点开附件，拍面板（用于人工检查附件显示）。

用法：python tools/shot_attach.py 9222 out.png --select 18 [--attach 0]
"""
from __future__ import annotations

import base64
import os
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def main() -> int:
    port = int(sys.argv[1])
    out = sys.argv[2]
    select = 0
    attach = 0
    argv = sys.argv[3:]
    i = 0
    while i < len(argv):
        if argv[i] == "--select":
            select = int(argv[i + 1]); i += 2
        elif argv[i] == "--attach":
            attach = int(argv[i + 1]); i += 2
        else:
            i += 1

    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.eval("(() => { const sr = document.getElementById('ds-outline-host').shadowRoot; if (sr.querySelector('.ho-panel').hidden) sr.querySelector('.ho-fab').click(); })()")
        for _ in range(40):
            time.sleep(0.5)
            if sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelectorAll('li.ho-item').length"):
                break
        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelectorAll('li.ho-item')[%d].click()" % select)
        time.sleep(1.0)
        info = sess.eval("""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const btn = sr.querySelectorAll('.ho-detail .ho-attach-name')[%d];
          if (btn) btn.click();
          const q = sr.querySelector('.ho-detail .ho-question');
          return { attach: !!btn, qHidden: q ? q.hidden : null, qText: q ? q.textContent : null };
        })()
        """ % attach)
        print("state:", info)
        time.sleep(2.5)
        rect = sess.eval("""
        (() => {
          const p = document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-panel').getBoundingClientRect();
          return { x: Math.max(0, p.x), y: Math.max(0, p.y), width: p.width, height: p.height };
        })()
        """)
        data = sess.send("Page.captureScreenshot", {
            "format": "png",
            "clip": {"x": rect["x"], "y": rect["y"], "width": rect["width"], "height": rect["height"], "scale": 1},
            "captureBeyondViewport": False,
        })["data"]
        os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
        open(out, "wb").write(base64.b64decode(data))
        print("saved", out, os.path.getsize(out), "bytes")
        return 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
