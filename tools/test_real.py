#!/usr/bin/env python
"""真实路径验证：扩展通过 Extensions.loadUnpacked 加载（不是注入），
验证 content script 在隔离世界挂载、MAIN-world hook 通信、面板/搜索/导出、
以及输入框键盘接管在"真扩展"下依然成立。

安全：开始前先在主世界堵住所有非 GET 请求，所以任何"发送"都只会被记录，不会真的发出去。

用法：python tools/test_real.py 9222 [--download]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
sys.path.insert(0, HERE)

from cdp import Session, _pick  # noqa: E402
import harness as H  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", type=int)
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    problems = []

    sess = Session(_pick(args.port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.send("Page.enable")
        sess.eval(H.BLOCKER, timeout=60)

        state = sess.eval(r"""
        (() => {
          const host = document.getElementById('ds-outline-host');
          return { host: !!host, shadow: !!(host && host.shadowRoot),
                   hook: !!window.__dsOutlineHook,
                   blocked: (window.__dsBlockedPosts || []).length };
        })()
        """)
        print("extension present:", json.dumps(state))
        if not state["host"] or not state["hook"]:
            problems.append("扩展没有在页面上挂载")

        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-fab').click()")
        stats = {}
        for _ in range(40):
            time.sleep(0.5)
            stats = H.panel_stats(sess)
            if stats.get("items"):
                break
        print("panel:", json.dumps({k: v for k, v in stats.items() if k != "detailText"}, ensure_ascii=False))
        if not stats.get("open"):
            problems.append("面板没打开")
        if not stats.get("items"):
            problems.append("面板没有内容（跨世界通信或接口失败）")

        print("search:", json.dumps(H.search(sess, "Pyodide"), ensure_ascii=False))
        H.search(sess, "")
        time.sleep(0.3)

        if args.download:
            out_dir = os.path.join(ROOT, "recon", "downloads")
            shutil.rmtree(out_dir, ignore_errors=True)
            os.makedirs(out_dir, exist_ok=True)
            sess.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": out_dir}, timeout=10)
            sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-download').click()")
            files = []
            for _ in range(40):
                time.sleep(0.5)
                files = [f for f in glob.glob(os.path.join(out_dir, "*")) if not f.endswith(".crdownload")]
                if files:
                    time.sleep(0.8)
                    files = [f for f in glob.glob(os.path.join(out_dir, "*.html"))]
                    if files:
                        break
            if files:
                print("downloaded:", os.path.basename(files[0]), os.path.getsize(files[0]), "bytes")
                html = open(files[0], encoding="utf-8").read()
                print("export structure:", json.dumps({
                    "sections": html.count('class="ho-panel-data"'),
                    "code": html.count('class="ho-code"'),
                    "details": html.count('<details class="ho-think"'),
                    "scripts": html.count("<script>")
                }))
            else:
                problems.append("下载 HTML 没有产生文件")

        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-close').click()")

        # ---- 键盘接管（真扩展 + 已堵住发送出口） ----
        sess.eval(r"""
        (() => {
          const ta = document.querySelector('textarea');
          ta.focus();
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return { ok: true };
        })()
        """)
        sess.send("Input.insertText", {"text": "真实扩展测试"})
        time.sleep(0.3)
        base_posts = sess.eval("(window.__dsBlockedPosts || []).length")
        sess.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter",
                                             "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13,
                                             "text": "\r", "unmodifiedText": "\r"})
        sess.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter",
                                             "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13})
        time.sleep(0.8)
        st = sess.eval(r"""
        (() => {
          const ta = document.querySelector('textarea');
          return { value: ta.value, posts: (window.__dsBlockedPosts || []).length,
                   chat: (window.__dsBlockedPosts || []).filter((p) => p.url.indexOf('/chat/completion') >= 0).length };
        })()
        """)
        print("enter in real extension:", json.dumps(st, ensure_ascii=False))
        if "\n" not in st["value"]:
            problems.append("真扩展下 Enter 没有换行")
        if st["posts"] != base_posts or st["chat"]:
            problems.append("真扩展下 Enter 触发了发送")

        # 收尾：清空输入框 + 恢复开关
        sess.eval(r"""
        (() => {
          const ta = document.querySelector('textarea');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          localStorage.removeItem('ds-outline:enter-newline');
        })()
        """)

        print()
        print("PROBLEMS:", problems or "none")
        return 1 if problems else 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
