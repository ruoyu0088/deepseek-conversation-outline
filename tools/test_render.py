#!/usr/bin/env python
"""遍历一个会话的每一轮，统计渲染结果（代码块/高亮/公式/表格/思考块），顺带做健壮性检查。

用法：python tools/test_render.py 9222 <sessionId> [--verbose]
"""
from __future__ import annotations

import json
import sys
import time

HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
sys.path.insert(0, HERE)

import harness as H  # noqa: E402

LOOP = r"""
(() => {
  const sr = document.getElementById('ds-outline-host').shadowRoot;
  const items = Array.from(sr.querySelectorAll('li.ho-item'));
  const detail = sr.querySelector('.ho-detail');
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    items[i].click();
    rows.push({
      i,
      q: (detail.querySelector('.ho-question') ? detail.querySelector('.ho-question').textContent : '').slice(0, 40),
      answers: detail.querySelectorAll('.ho-msg').length,
      code: detail.querySelectorAll('.ho-code').length,
      tokens: detail.querySelectorAll('.token').length,
      math: detail.querySelectorAll('math').length,
      tables: detail.querySelectorAll('table').length,
      thinks: detail.querySelectorAll('.ho-think').length,
      cites: detail.querySelectorAll('.ho-cite-num').length,
      refMarkers: (detail.innerText.match(/\[reference:\d+\]/g) || []).length,
      textLen: (detail.innerText || '').length
    });
  }
  items[0] && items[0].click();
  return rows;
})()
"""


def main() -> int:
    port = int(sys.argv[1])
    session = sys.argv[2]
    verbose = "--verbose" in sys.argv
    sess = H.connect(port)
    try:
        sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/" + session})
        H.wait_ready(sess)
        time.sleep(2.0)
        H.reload_and_inject(sess)
        H.open_panel(sess)
        for _ in range(60):
            time.sleep(0.5)
            if H.panel_stats(sess).get("items"):
                break
        rows = sess.eval(LOOP)
    finally:
        sess.close()

    total = {k: sum(r[k] for r in rows) for k in ("answers", "code", "tokens", "math", "tables", "thinks", "cites", "refMarkers")}
    zero_answers = [r["i"] + 1 for r in rows if r["answers"] == 0]
    bad_q = [r["i"] + 1 for r in rows if r["textLen"] < 40]
    print("turns:", len(rows), "totals:", json.dumps(total, ensure_ascii=False))
    print("turns without answer:", zero_answers or "none")
    print("suspiciously short panels:", bad_q or "none")
    if verbose:
        for r in rows:
            print(json.dumps(r, ensure_ascii=False))
    top = sorted(rows, key=lambda r: -(r["code"] * 10 + r["math"]))[:5]
    print("richest turns:", [(r["i"] + 1, r["code"], r["tokens"], r["math"], r["tables"]) for r in top])
    return 0


if __name__ == "__main__":
    sys.exit(main())
