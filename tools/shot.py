#!/usr/bin/env python
"""给当前页面截图（用于人工检查面板观感）。

用法：python tools/shot.py 9222 recon/shot.png [--selector '#ds-outline-host']
"""
from __future__ import annotations

import base64
import os
import sys

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def main() -> int:
    port = int(sys.argv[1])
    out = sys.argv[2]
    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.send("Page.enable")
        res = sess.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    finally:
        sess.close()
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "wb") as f:
        f.write(base64.b64decode(res["data"]))
    print("saved", out, os.path.getsize(out), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
