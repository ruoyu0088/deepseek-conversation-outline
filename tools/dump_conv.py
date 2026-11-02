#!/usr/bin/env python
"""把某个会话的完整 history_messages JSON 存到 recon/（只读 GET）。

用法：python tools/dump_conv.py 9222 2c9ce637-29ad-43a8-ba4f-3e28973db6ae
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RECON = os.path.join(os.path.dirname(HERE), "recon")
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402

JS = r"""
(async (id) => {
  const tok = (() => { try { return JSON.parse(localStorage.getItem('userToken') || '{}').value || null; } catch (e) { return null; } })();
  const r = await fetch('/api/v0/chat/history_messages?chat_session_id=' + id,
    { credentials: 'include', headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  return await r.text();
})
"""


def main() -> int:
    port = int(sys.argv[1])
    sid = sys.argv[2]
    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        text = sess.eval("(%s)(%s)" % (JS, json.dumps(sid)))
    finally:
        sess.close()
    os.makedirs(RECON, exist_ok=True)
    fn = os.path.join(RECON, "raw-%s.json" % sid[:8])
    with open(fn, "w", encoding="utf-8") as f:
        f.write(text)
    data = json.loads(text)
    biz = (((data.get("data") or {}).get("biz_data")) or {})
    msgs = biz.get("chat_messages") or []
    print("saved", fn, len(text), "bytes; messages:", len(msgs), "title:",
          (biz.get("chat_session") or {}).get("title"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
