#!/usr/bin/env python
"""验证输入框键盘接管：Enter 换行、Ctrl+Enter 发送、关掉开关后恢复原行为。

关键点：
  * 用 CDP 的 Input.dispatchKeyEvent / Input.insertText 发**可信**输入（走真实事件链路）；
  * 每个阶段都重新加载页面，避免上一阶段"被拦截的发送"把页面留在奇怪状态；
  * 安全网拦下所有非 GET 请求，所以 Ctrl+Enter 只会产生"被拦截的发送尝试"，不会真的发消息。

用法：python tools/test_key.py 9222
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import harness as H  # noqa: E402

CLEAR = r"""
(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return { ok: false };
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.selectionStart = ta.selectionEnd = 0;
  return { ok: true };
})()
"""

READ = r"""
(() => {
  const ta = document.querySelector('textarea');
  let box = ta; for (let i = 0; i < 3 && box; i++) box = box.parentElement;
  const btn = box && box.querySelector('[role=button].ds-button--primary');
  const posts = window.__dsBlockedPosts || [];
  const chat = posts.filter((p) => p.url.indexOf('/chat/completion') >= 0);
  return {
    value: ta ? ta.value : null,
    lines: ta ? ta.value.split('\n').length : 0,
    caret: ta ? ta.selectionStart : null,
    sendDisabled: btn ? btn.classList.contains('ds-button--disabled') : null,
    state: window.__dsKeymapsState || null,
    posts: posts.map((p) => ({ url: p.url, body: (p.body || '').slice(0, 120) })),
    chatPosts: chat.length,
    chatBody: chat.length ? chat[chat.length - 1].body.slice(0, 300) : ''
  };
})()
"""


def key(sess, *, modifiers=0):
    sess.send("Input.dispatchKeyEvent", {
        "type": "rawKeyDown" if modifiers else "keyDown",
        "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13,
        "modifiers": modifiers, "text": "" if modifiers else "\r", "unmodifiedText": "\r"
    })
    sess.send("Input.dispatchKeyEvent", {
        "type": "keyUp", "key": "Enter", "code": "Enter",
        "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13, "modifiers": modifiers
    })


def fresh(sess, switch_off: bool) -> None:
    sess.eval("localStorage.%s('ds-outline:enter-newline','%s'); void 0"
              % ("setItem" if switch_off else "removeItem", "0" if switch_off else "1"))
    H.reload_and_inject(sess)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    sess = H.connect(port)
    problems = []
    try:
        # ---------- 阶段 1：默认（Enter 换行） ----------
        fresh(sess, switch_off=False)
        print("focus:", sess.eval(CLEAR))
        sess.send("Input.insertText", {"text": "第一行"})
        time.sleep(0.3)
        print("before:", json.dumps(sess.eval(READ), ensure_ascii=False)[:300])

        key(sess)
        time.sleep(0.6)
        st = sess.eval(READ)
        print("after Enter:", json.dumps({k: st[k] for k in ("value", "lines", "caret", "sendDisabled", "chatPosts", "state")},
                                         ensure_ascii=False))
        if "\n" not in (st["value"] or ""):
            problems.append("Enter 没有换行")
        if st["chatPosts"]:
            problems.append("Enter 触发了发送请求")
        if st["sendDisabled"]:
            problems.append("换行后发送按钮仍是禁用态（页面状态没跟上）")

        # 换行后继续打字，检查光标位置
        sess.send("Input.insertText", {"text": "第二行"})
        time.sleep(0.3)
        st2 = sess.eval(READ)
        if st2["value"] != "第一行\n第二行":
            problems.append("回车后继续输入的位置不对：%r" % (st2["value"],))

        # ---------- 阶段 2：Ctrl+Enter 发送 ----------
        key(sess, modifiers=2)
        time.sleep(1.0)
        st3 = sess.eval(READ)
        print("after Ctrl+Enter:", json.dumps({k: st3[k] for k in ("value", "chatPosts", "chatBody", "state")},
                                              ensure_ascii=False)[:600])
        if not st3["chatPosts"]:
            problems.append("Ctrl+Enter 没有触发发送")
        if st3["state"] and st3["state"]["last"] != "submit":
            problems.append("Ctrl+Enter 没走 submit 分支")
        body = st3["chatBody"]
        if body and "第一行" not in body:
            problems.append("发送的正文里没有输入内容")
        if body and "\\n" not in body:
            problems.append("发送的正文里没有换行（React 状态没拿到换行）")

        # ---------- 阶段 3：关掉开关 → 恢复页面原行为 ----------
        fresh(sess, switch_off=True)
        sess.eval(CLEAR)
        sess.send("Input.insertText", {"text": "第三行"})
        time.sleep(0.3)
        key(sess)
        time.sleep(1.0)
        st4 = sess.eval(READ)
        print("switch off, after Enter:", json.dumps({k: st4[k] for k in ("value", "chatPosts", "state")}, ensure_ascii=False))
        if not st4["chatPosts"]:
            problems.append("关掉开关后 Enter 仍未恢复提交")
        if "\n" in (st4["value"] or ""):
            problems.append("关掉开关后 Enter 仍然插入换行")

        sess.eval("localStorage.removeItem('ds-outline:enter-newline'); void 0")
        print()
        print("PROBLEMS:", problems or "none")
        return 1 if problems else 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
