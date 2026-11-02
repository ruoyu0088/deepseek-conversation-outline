#!/usr/bin/env python
"""把抓到的 DeepSeek 响应体整理成可读摘要。

用法：python tools/describe_payload.py recon/body-03.json [--full]
"""
from __future__ import annotations

import json
import sys


def walk(obj, path="", depth=0, out=None):
    out = out if out is not None else []
    if depth > 4:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, (dict, list)):
                out.append(f"{'  ' * depth}{p}: {type(v).__name__}[{len(v)}]")
                walk(v, p, depth + 1, out)
            else:
                s = repr(v)
                out.append(f"{'  ' * depth}{p}: {s[:100]}")
    elif isinstance(obj, list):
        if not obj:
            return out
        out.append(f"{'  ' * depth}[0] of {len(obj)}:")
        walk(obj[0], path + "[0]", depth + 1, out)
    return out


def main() -> int:
    fn = sys.argv[1]
    data = json.load(open(fn, encoding="utf-8"))
    print("\n".join(walk(data)))
    biz = (((data.get("data") or {}).get("biz_data")) or {})
    msgs = biz.get("chat_messages")
    if isinstance(msgs, list):
        print("\n=== messages:", len(msgs))
        types = {}
        for m in msgs:
            for f in m.get("fragments") or []:
                types[f.get("type")] = types.get(f.get("type"), 0) + 1
        print("fragment types:", types)
        print("roles:", {r: sum(1 for m in msgs if m.get("role") == r) for r in {m.get("role") for m in msgs}})
        print("ids sorted?:", [m.get("message_id") for m in msgs] == sorted(m.get("message_id") for m in msgs))
        for m in msgs[:4]:
            print(" -", m.get("message_id"), m.get("role"), "inserted_at=", m.get("inserted_at"),
                  "fragments=", [(f.get("type"), len(f.get("content") or "")) for f in m.get("fragments") or []])
    sess = biz.get("chat_session")
    if sess:
        print("\nsession keys:", list(sess.keys()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
