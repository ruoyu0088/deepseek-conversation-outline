"""在扩展的隔离世界里求值：keymaps 有没有装上、Enter 逻辑走到哪一步。

用法：python tools/probe_isolated.py 9222 [--goto URL]
"""
from __future__ import annotations

import argparse
import json
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import _pick  # noqa: E402
from websockets.sync.client import connect  # noqa: E402

MARK = "chrome-extension://"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--goto", default=None)
    args = ap.parse_args()

    page = _pick(args.port, "chat.deepseek.com")
    ws = connect(page["webSocketDebuggerUrl"], max_size=None, open_timeout=15, legacy=True)
    nid = 0

    def send(method, params=None):
        nonlocal nid
        nid += 1
        ws.send(json.dumps({"id": nid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv(timeout=30))
            if msg.get("id") == nid:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    ctx_ids: list[int] = []
    send("Runtime.enable")
    send("Page.enable")
    if args.goto:
        send("Page.navigate", {"url": args.goto})
        time.sleep(9)
    ws.socket.settimeout(1.0)
    deadline = time.time() + 1.5
    while time.time() < deadline:
        try:
            msg = json.loads(ws.recv(timeout=1.0))
        except Exception:
            continue
        if msg.get("method") == "Runtime.executionContextCreated":
            ctx = msg["params"]["context"]
            if (ctx.get("origin") or "").startswith(MARK):
                ctx_ids.append(ctx["id"])
    print("extension contexts:", ctx_ids)

    expr = """JSON.stringify({
      keymaps: !!window.__dsKeymaps,
      enabled: !!(window.__dsKeymaps && window.__dsKeymaps.enabled()),
      state: window.__dsKeymapsState || null,
      i18n: !!(window.__dsI18n && window.__dsI18n.getLang()),
      parse: !!window.__dsParse,
      content: !!document.getElementById('ds-outline-host'),
    })"""
    for cid in ctx_ids[-2:]:
        res = send("Runtime.evaluate", {"expression": expr, "contextId": cid, "returnByValue": True})
        print("ctx", cid, "->", res.get("result", {}).get("value") or res)
    ws.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
