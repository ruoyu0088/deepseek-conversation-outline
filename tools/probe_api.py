#!/usr/bin/env python
"""只读探针：在页面上下文里直接 GET DeepSeek 的会话接口，确认鉴权方式、分页与字段。

用法：
  python tools/probe_api.py 9222                 # 统计前 N 个会话的消息数/fragment 类型
  python tools/probe_api.py 9222 --id <session>  # 只看一个会话
  python tools/probe_api.py 9222 --auth          # 对比"带 / 不带 Authorization"的结果
"""
from __future__ import annotations

import argparse
import json
import sys

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402

AUTH_HELPER = r"""
const __tok = (() => { try { return JSON.parse(localStorage.getItem('userToken') || '{}').value || null; } catch (e) { return null; } })();
const __h = __tok ? { Authorization: 'Bearer ' + __tok } : {};
"""

JS_LIST = r"""
(async () => {
""" + AUTH_HELPER + r"""
  const r = await fetch('/api/v0/chat_session/fetch_page?lte_cursor.pinned=false', { credentials: 'include', headers: __h });
  const j = await r.json();
  const arr = (((j.data || {}).biz_data || {}).chat_sessions) || [];
  return arr.map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at }));
})()
"""

JS_STAT = r"""
(async (ids) => {
""" + AUTH_HELPER + r"""
  const out = [];
  for (const id of ids) {
    const u = '/api/v0/chat/history_messages?chat_session_id=' + id;
    try {
      const r = await fetch(u, { credentials: 'include', headers: __h });
      let j = null, err = null;
      try { j = await r.json(); } catch (e) { err = 'not json'; }
      const biz = (((j || {}).data || {}).biz_data) || {};
      const msgs = biz.chat_messages || [];
      const types = {};
      for (const m of msgs) for (const f of (m.fragments || [])) types[f.type] = (types[f.type] || 0) + 1;
      out.push({ id, status: r.status, code: (j || {}).code, msg: (j || {}).msg, n: msgs.length,
                 title: (biz.chat_session || {}).title, types,
                 keys: Object.keys(biz), err });
    } catch (e) { out.push({ id, err: String(e) }); }
  }
  return out;
})
"""

JS_AUTH = r"""
(async (id) => {
  let tok = null;
  try { tok = JSON.parse(localStorage.getItem('userToken') || '{}').value || null; } catch (e) {}
  const u = '/api/v0/chat/history_messages?chat_session_id=' + id;
  const bare = await fetch(u, { credentials: 'include' });
  const withTok = await fetch(u, { credentials: 'include', headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  return { hasToken: !!tok, tokenLen: tok ? tok.length : 0,
           bareStatus: bare.status, withTokenStatus: withTok.status };
})
"""

JS_PAGING = r"""
(async (id) => {
""" + AUTH_HELPER + r"""
  const base = '/api/v0/chat/history_messages?chat_session_id=' + id;
  const tries = [base, base + '&count=10', base + '&page_size=10', base + '&limit=10', base + '&before=9999999999999', base + '&offset=10'];
  const out = [];
  for (const u of tries) {
    try {
      const r = await fetch(u, { credentials: 'include', headers: __h });
      const j = await r.json().catch(() => null);
      const n = ((((j || {}).data || {}).biz_data || {}).chat_messages || []).length;
      out.push({ u: u.slice(u.indexOf('?')), status: r.status, n });
    } catch (e) { out.push({ u, err: String(e) }); }
  }
  return out;
})
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--id")
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--auth", action="store_true")
    ap.add_argument("--paging", action="store_true")
    ap.add_argument("--match", default="chat.deepseek.com")
    args = ap.parse_args()

    sess = Session(_pick(args.port, args.match)["webSocketDebuggerUrl"])
    try:
        if args.auth or args.paging:
            sid = args.id or sess.eval("(location.pathname.match(/\\/a\\/chat\\/s\\/([0-9a-f-]{36})/) || [])[1]")
            if not sid:
                print("no session id (open a conversation first)")
                return 1
            print(json.dumps(sess.eval("(%s)(%s)" % (JS_AUTH if args.auth else JS_PAGING, json.dumps(sid))),
                             ensure_ascii=False, indent=1))
            return 0
        if args.id:
            ids = [args.id]
        else:
            sessions = sess.eval(JS_LIST)
            print("sessions:", len(sessions))
            ids = [s["id"] for s in sessions[: args.limit] if s.get("id")]
        stats = sess.eval("(%s)(%s)" % (JS_STAT, json.dumps(ids)))
        print(json.dumps(stats, ensure_ascii=False, indent=1))
        return 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
