#!/usr/bin/env python
"""改了 ext/ 里的文件后：重新 loadUnpacked 一遍扩展，再刷新页面确认新代码生效。

用法：python tools/reload_ext.py 9222 [--wait 9]
（单独的 Page.reload 只会重跑已加载的扩展文件，改过磁盘上的源码必须先重新 loadUnpacked）
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402

EXT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ext")


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    wait = 9.0
    if "--wait" in sys.argv:
        wait = float(sys.argv[sys.argv.index("--wait") + 1])

    with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=5) as r:
        browser_ws = json.load(r)["webSocketDebuggerUrl"]
    sess = Session(browser_ws)
    try:
        print("loadUnpacked:", json.dumps(sess.send("Extensions.loadUnpacked", {"path": EXT}, timeout=30), ensure_ascii=False))
    finally:
        sess.close()

    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.send("Page.enable")
        sess.send("Page.reload", {"ignoreCache": True})
        time.sleep(wait)
        print(json.dumps(sess.eval(r"""
        (() => {
          const host = document.getElementById('ds-outline-host');
          return {
            url: location.href,
            host: !!host,
            hook: !!window.__dsOutlineHook,
            hookFileHasTy: typeof window.__dsOutlineHook === "boolean"
          };
        })()
        """), ensure_ascii=False))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
