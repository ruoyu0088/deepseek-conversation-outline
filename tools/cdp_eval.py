#!/usr/bin/env python
"""在页面里执行一个 .js 文件里的表达式（便于在仓库里保存侦察/验证脚本）。

用法：python tools/cdp_eval.py 9222 recon/probe_composer.js [--match chat.deepseek.com]
"""
from __future__ import annotations

import argparse
import json
import sys

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("file")
    ap.add_argument("--match", default="chat.deepseek.com")
    ap.add_argument("--raw", action="store_true", help="按字符串原样输出（不 json.dumps）")
    args = ap.parse_args()
    src = open(args.file, encoding="utf-8").read()
    sess = Session(_pick(args.port, args.match)["webSocketDebuggerUrl"])
    try:
        out = sess.eval(src, timeout=60)
    finally:
        sess.close()
    if args.raw:
        print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, indent=1))
    else:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
