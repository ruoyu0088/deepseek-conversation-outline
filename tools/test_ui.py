#!/usr/bin/env python
"""冒烟测试：注入扩展 → 打开面板 → 渲染 → 搜索 → 导出 → 关闭。

用法：
  python tools/test_ui.py 9222 [sessionId] [--export out.html]

安全：注入前先堵住页面的所有非 GET 请求，全程不会真的发消息。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import harness as H  # noqa: E402

DEFAULT_SESSION = "2c9ce637-29ad-43a8-ba4f-3e28973db6ae"   # 154 条消息 / 77 轮


def capture_export(sess) -> str:
    """拦下 createObjectURL，拿到导出的 HTML 文本（不落盘、不触发真实下载）。"""
    sess.eval(r"""
    (() => {
      window.__dsLastBlob = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__dsLastBlob = blob; return origCreate.call(URL, blob); };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dsDownloadName = this.download; return; } return origClick.apply(this, arguments); };
    })()
    """)
    sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-download').click()")
    time.sleep(0.4)
    return sess.eval(r"""
    (async () => {
      const b = window.__dsLastBlob;
      if (!b) return { ok: false };
      const text = await b.text();
      return { ok: true, name: window.__dsDownloadName, size: text.length, text };
    })()
    """)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("session", nargs="?", default=DEFAULT_SESSION)
    ap.add_argument("--export", default=os.path.join(ROOT, "recon", "export-test.html"))
    ap.add_argument("--search", default="Git")
    args = ap.parse_args()

    sess = H.connect(args.port)
    try:
        sess.send("Page.enable")
        sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/" + args.session})
        H.wait_ready(sess)
        time.sleep(2.0)
        H.reload_and_inject(sess)
        print("injected:", sess.eval(r"""
          ({ hook: !!window.__dsOutlineHook, keymaps: !!window.__dsKeymapsInstalled,
             parse: !!window.__dsParse, md: !!window.__dsMarkdown, styles: !!window.__dsStyles,
             prism: !!(window.Prism && window.Prism.languages.python), katex: !!(window.katex && window.katex.renderToString) })
        """))

        t0 = time.time()
        H.open_panel(sess)
        stats = {}
        for _ in range(60):
            time.sleep(0.5)
            stats = H.panel_stats(sess)
            if stats.get("items"):
                break
        print("open+render (%.1fs):" % (time.time() - t0), json.dumps(
            {k: v for k, v in stats.items() if k != "detailText"}, ensure_ascii=False))

        if args.search:
            print("search %r:" % args.search, json.dumps(H.search(sess, args.search), ensure_ascii=False))
            H.search(sess, "")

        if args.export:
            out = capture_export(sess)
            if out.get("ok"):
                os.makedirs(os.path.dirname(args.export), exist_ok=True)
                with open(args.export, "w", encoding="utf-8") as f:
                    f.write(out["text"])
                print("export:", out["name"], out["size"], "bytes →", args.export)
            else:
                print("export FAILED")

        print("close:", H.close_panel(sess))
        print("blocked posts:", sess.eval("window.__dsBlockedPosts || []"))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
