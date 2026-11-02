#!/usr/bin/env python
"""刷新当前 DeepSeek 页面并确认扩展还挂着（改了 ext/ 里的文件、又用 loadUnpacked 重新加载扩展之后用）。

用法：python tools/reload.py 9222 [--wait 7]
"""
from __future__ import annotations

import json
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    wait = 7.0
    if "--wait" in sys.argv:
        wait = float(sys.argv[sys.argv.index("--wait") + 1])
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
            copyBtns: host && host.shadowRoot ? host.shadowRoot.querySelectorAll('.ho-copy-btn').length : 0
          };
        })()
        """), ensure_ascii=False))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
