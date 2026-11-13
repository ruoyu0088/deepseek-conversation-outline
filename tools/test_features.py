#!/usr/bin/env python
"""交互细节验证（真扩展）：代码块复制按钮、跳到回答、搜索高亮。

用法：python tools/test_features.py 9222 [sessionId]
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")

from cdp import Session, _pick  # noqa: E402
import harness as H  # noqa: E402

DEFAULT_SESSION = "2c9ce637-29ad-43a8-ba4f-3e28973db6ae"


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    session = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SESSION
    problems = []
    sess = Session(_pick(port, "chat.deepseek.com")["webSocketDebuggerUrl"])
    H.ensure_active(sess)
    try:
        sess.send("Page.enable")
        sess.send("Page.navigate", {"url": "https://chat.deepseek.com/a/chat/s/" + session})
        time.sleep(6)
        sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-fab').click()")
        for _ in range(30):
            time.sleep(0.5)
            if H.panel_stats(sess).get("items"):
                break

        # 找一条有代码的回答
        info = sess.eval(r"""
        (() => {
          const sr = document.getElementById('ds-outline-host').shadowRoot;
          const items = Array.from(sr.querySelectorAll('li.ho-item'));
          const detail = sr.querySelector('.ho-detail');
          for (let i = 0; i < items.length; i++) {
            items[i].click();
            const code = detail.querySelectorAll('.ho-code');
            if (code.length) {
              return { index: i, codes: code.length, tokens: detail.querySelectorAll('.token').length,
                       lang: (code[0].querySelector('.ho-code-lang') || {}).textContent || null };
            }
          }
          return { index: -1 };
        })()
        """)
        print("code turn:", json.dumps(info, ensure_ascii=False))
        if info["index"] < 0:
            problems.append("没有找到带代码块的回答")
        else:
            # 复制按钮：必须用**真实鼠标点击**——JS 的 .click() 没有用户激活，
            # Chrome 会拒绝 navigator.clipboard.writeText（NotAllowedError）。
            sess.send("Browser.grantPermissions", {
                "origin": "https://chat.deepseek.com",
                "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]
            }, timeout=10)
            pos = sess.eval(r"""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const btn = sr.querySelector('.ho-detail .ho-code-copy');
              if (!btn) return { err: 'no copy button' };
              btn.scrollIntoView({ block: 'center' });
              const r = btn.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                       expectLen: btn.closest('.ho-code').querySelector('pre').innerText.length };
            })()
            """)
            print("copy button at:", json.dumps(pos, ensure_ascii=False))
            for kind in ("mousePressed", "mouseReleased"):
                sess.send("Input.dispatchMouseEvent", {
                    "type": kind, "x": pos["x"], "y": pos["y"],
                    "button": "left", "clickCount": 1
                })
            time.sleep(0.6)
            got = sess.eval(r"""
            (async () => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const btn = sr.querySelector('.ho-detail .ho-code-copy');
              let clip = null;
              try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'READ_ERR: ' + e; }
              const pre = btn.closest('.ho-code').querySelector('pre');
              const norm = (s) => String(s).replace(/\r\n/g, '\n').trim();
              return { ok: norm(clip) === norm(pre.innerText), btnText: btn.textContent,
                       len: (clip || '').length, expectLen: pre.innerText.length,
                       head: String(clip || '').slice(0, 30) };
            })()
            """)
            print("copy:", json.dumps(got, ensure_ascii=False))
            if "READ_ERR" in str(got.get("head", "")) or not got.get("ok"):
                # 读不到剪贴板时，退一步只要求按钮变"已复制"（说明 writeText 成功）
                if got.get("btnText") != "已复制":
                    problems.append("复制按钮没有把代码写进剪贴板")

            # 复制提问 / 复制回答（同样必须真实鼠标点击）
            def click_in_shadow(selector: str) -> bool:
                pos = sess.eval("""
                (() => {
                  const sr = document.getElementById('ds-outline-host').shadowRoot;
                  const el = sr.querySelector(%s);
                  if (!el) return null;
                  el.scrollIntoView({ block: 'center' });
                  const r = el.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                           disabled: !!el.disabled };
                })()
                """ % json.dumps(selector))
                if not pos or pos.get("disabled"):
                    return False
                for kind in ("mousePressed", "mouseReleased"):
                    sess.send("Input.dispatchMouseEvent", {
                        "type": kind, "x": pos["x"], "y": pos["y"], "button": "left", "clickCount": 1
                    })
                time.sleep(0.5)
                return True

            def read_clip() -> str:
                return sess.eval("""
                (async () => {
                  try { return await navigator.clipboard.readText(); } catch (e) { return 'READ_ERR: ' + e; }
                })()
                """)

            q_text = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-question').textContent")
            if not click_in_shadow(".ho-detail .ho-copy-q"):
                problems.append("找不到「复制提问」按钮")
            else:
                clip = read_clip()
                ok = str(clip).replace("\r\n", "\n").strip() == str(q_text).strip()
                btn = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-copy-q').textContent")
                print("copy question:", json.dumps({"ok": ok, "btnText": btn, "len": len(str(clip)),
                                                    "qLen": len(q_text)}, ensure_ascii=False))
                if "READ_ERR" in str(clip):
                    if btn != "已复制":
                        problems.append("复制提问失败")
                elif not ok:
                    problems.append("复制提问的内容与提问不一致")

            if not click_in_shadow(".ho-detail .ho-copy-a"):
                problems.append("找不到「复制回答」按钮")
            else:
                clip = str(read_clip())
                btn = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-copy-a').textContent")
                rendered = sess.eval("""
                (() => {
                  const sr = document.getElementById('ds-outline-host').shadowRoot;
                  // 用直接子元素选择器：思考块的 .ho-prose 在 .ho-think 里，不能选到
                  const p = sr.querySelector('.ho-detail .ho-msg > .ho-prose');
                  return p ? p.textContent.trim().slice(0, 15) : '';
                })()
                """)
                body = clip.replace("\r\n", "\n")
                has_fence = "```" in body
                head_ok = rendered and (body.lstrip("# \n").startswith(rendered[:10]) or rendered[:10] in body[:200])
                print("copy answer:", json.dumps({"btnText": btn, "len": len(body), "fence": has_fence,
                                                  "headOk": bool(head_ok),
                                                  "head": body[:40]}, ensure_ascii=False))
                if "READ_ERR" in body:
                    if btn != "已复制":
                        problems.append("复制回答失败")
                elif len(body) < 100 or not head_ok:
                    problems.append("复制回答的内容看起来不对")

            # 跳到回答
            jump = sess.eval(r"""
            (() => {
              const sr = document.getElementById('ds-outline-host').shadowRoot;
              const detail = sr.querySelector('.ho-detail');
              const btn = detail.querySelector('.ho-jump-btn');
              if (!btn) return { err: 'no jump button' };
              detail.scrollTop = 0;
              const before = detail.scrollTop;
              btn.click();
              return { before: before };
            })()
            """)
            time.sleep(1.2)
            after = sess.eval("document.getElementById('ds-outline-host').shadowRoot.querySelector('.ho-detail').scrollTop")
            print("jump: before=%s after=%s (jump=%s)" % (jump.get("before"), after, jump))
            if after <= 0:
                problems.append("「跳到回答」没有滚动")

        # 搜索：命中词的左右两侧都应高亮
        s = H.search(sess, "Pyodide")
        print("search:", json.dumps(s, ensure_ascii=False))
        if s["items"] <= 0 or s["marks"] <= 0:
            problems.append("搜索没有高亮")
        H.search(sess, "")

        print()
        print("PROBLEMS:", problems or "none")
        return 1 if problems else 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
