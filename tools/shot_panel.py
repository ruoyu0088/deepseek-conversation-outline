#!/usr/bin/env python
"""打开面板并截图（页面里必须已经注入过扩展，见 tools/test_ui.py）。

用法：python tools/shot_panel.py 9222 recon/shot.png [--search <词>] [--select <序号>] [--expand]
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def main() -> int:
    port = int(sys.argv[1])
    out = sys.argv[2]
    search = None
    select = None
    expand = False
    argv = sys.argv[3:]
    i = 0
    while i < len(argv):
        if argv[i] == "--search":
            search = argv[i + 1]; i += 2
        elif argv[i] == "--select":
            select = int(argv[i + 1]); i += 2
        elif argv[i] == "--expand":
            expand = True; i += 1
        else:
            i += 1

    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.eval(r"""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          if (sr.querySelector('.ho-panel').hidden) sr.querySelector('.ho-fab').click();
        })()
        """)
        time.sleep(1.2)
        if select is not None:
            sess.eval("""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const items = sr.querySelectorAll('li.ho-item');
              if (items[%d]) items[%d].click();
            })()
            """ % (select, select))
            time.sleep(0.6)
        if search is not None:
            sess.eval("""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const input = sr.querySelector('.ho-search');
              input.value = %s;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            })()
            """ % json.dumps(search))
            time.sleep(0.6)
        if expand:
            sess.eval(r"""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const head = sr.querySelector('.ho-detail .ho-think-head');
              if (head) head.click();
            })()
            """)
            time.sleep(0.5)
        res = sess.send("Page.captureScreenshot", {"format": "png"})
    finally:
        sess.close()
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "wb") as f:
        f.write(base64.b64decode(res["data"]))
    print("saved", out, os.path.getsize(out), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
