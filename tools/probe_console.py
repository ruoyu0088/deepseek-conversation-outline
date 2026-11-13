"""重载页面并抓 console / 未捕获异常，看 keymaps 到底有没有装上。

用法：python tools/probe_console.py 9222 [--goto URL]
"""
from __future__ import annotations

import argparse
import json
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import _pick  # noqa: E402
from websockets.sync.client import connect  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--goto", default="https://chat.deepseek.com/a/chat/s/2c9ce637-29ad-43a8-ba4f-3e28973db6ae")
    ap.add_argument("--seconds", type=float, default=12.0)
    args = ap.parse_args()

    page = _pick(args.port, "chat.deepseek.com")
    ws = connect(page["webSocketDebuggerUrl"], max_size=None, open_timeout=15)
    nid = 0

    def send(method, params=None):
        nonlocal nid
        nid += 1
        ws.send(json.dumps({"id": nid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv(timeout=30))
            if msg.get("id") == nid:
                return msg.get("result", {})

    send("Runtime.enable")
    send("Log.enable")
    send("Page.enable")
    send("Page.navigate", {"url": args.goto})

    deadline = time.time() + args.seconds
    ws.socket.settimeout(1.0)
    while time.time() < deadline:
        try:
            raw = ws.recv(timeout=1.0)
        except Exception:
            continue
        msg = json.loads(raw)
        method = msg.get("method", "")
        if method == "Runtime.consoleAPICalled":
            args_ = [a.get("value") if "value" in a else a.get("description", "") for a in msg["params"].get("args", [])]
            print("[console:%s]" % msg["params"].get("type"), " ".join(str(a) for a in args_)[:300])
        elif method in ("Runtime.exceptionThrown",):
            det = msg["params"].get("exceptionDetails", {})
            print("[exception]", (det.get("exception") or {}).get("description", det.get("text"))[:400])
        elif method == "Log.entryAdded":
            e = msg["params"]["entry"]
            print("[log:%s]" % e.get("level"), e.get("text", "")[:300])
        elif method == "Runtime.executionContextCreated":
            ctx = msg["params"]["context"]
            print("[context]", ctx.get("id"), ctx.get("origin"), ctx.get("name"), (ctx.get("auxData") or {}).get("type"))
    ws.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
