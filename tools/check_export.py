#!/usr/bin/env python
"""体检导出的单文件 HTML：结构 + 在浏览器里真实打开后的搜索/切换/折叠行为。

用法：python tools/check_export.py 9222 recon/export-test.html [--search 词]
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402


def structural(html: str) -> dict:
    return {
        "bytes": len(html.encode("utf-8")),
        "doctype": html.startswith("<!doctype html>"),
        "sections": html.count('class="ho-panel-data"'),
        "listItems": html.count('<li class="ho-item'),
        "questions": html.count('class="ho-question"'),
        "jumpBtns": html.count('class="ho-jump-btn"'),
        "codeBlocks": html.count('class="ho-code"'),
        "copyBtns": html.count('class="ho-code-copy"'),
        "tokens": html.count('class="token '),
        "details": html.count('<details class="ho-think"'),
        "math": html.count("<math"),
        "scripts": html.count("<script>"),
        "externalScripts": len(re.findall(r'<script[^>]+src=', html)),
        "externalCss": len(re.findall(r'<link[^>]+stylesheet', html)),
        "leftoverRefs": len(re.findall(r"\[reference:\d+\]", html)),
        "vars": len(re.findall(r"--ho-[a-z-]+:", html))
    }


def main() -> int:
    port = int(sys.argv[1])
    path = os.path.abspath(sys.argv[2])
    query = "Pyodide"
    if "--search" in sys.argv:
        query = sys.argv[sys.argv.index("--search") + 1]
    html = open(path, encoding="utf-8").read()
    print("structure:", json.dumps(structural(html), ensure_ascii=False))

    sess = Session(_pick(port, None)["webSocketDebuggerUrl"])
    try:
        sess.send("Page.enable")
        sess.send("Page.navigate", {"url": "file:///" + path.replace("\\", "/")})
        for _ in range(40):
            time.sleep(0.4)
            try:
                if sess.eval("document.readyState") == "complete":
                    break
            except Exception:
                pass
        time.sleep(1.0)
        base = sess.eval(r"""
        (() => {
          const panels = [].slice.call(document.querySelectorAll('.ho-panel-data'));
          return {
            url: location.href,
            title: document.title,
            items: document.querySelectorAll('#ho-list li[data-i]').length,
            panels: panels.length,
            visiblePanels: panels.filter((p) => !p.hidden).length,
            visibleItems: [].slice.call(document.querySelectorAll('#ho-list li[data-i]')).filter((l) => !l.hidden).length,
            count: (document.getElementById('ho-count') || {}).textContent,
            detailsOpen: document.querySelectorAll('details.ho-think[open]').length,
            errors: []
          };
        })()
        """)
        print("loaded:", json.dumps(base, ensure_ascii=False))

        res = sess.eval("""
        (() => {
          const input = document.getElementById('ho-search');
          input.value = %s;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const panels = [].slice.call(document.querySelectorAll('.ho-panel-data'));
          const items = [].slice.call(document.querySelectorAll('#ho-list li[data-i]'));
          const visible = items.filter((l) => !l.hidden);
          return {
            count: document.getElementById('ho-count').textContent,
            visibleItems: visible.length,
            marksInList: document.querySelectorAll('#ho-list mark').length,
            marksTotal: document.querySelectorAll('mark').length,
            detailsOpen: document.querySelectorAll('details.ho-think[open]').length,
            emptyHidden: document.getElementById('ho-empty').hidden
          };
        })()
        """ % json.dumps(query))
        print("search %r:" % query, json.dumps(res, ensure_ascii=False))

        # 切换一条：主栏应回到顶部
        click = sess.eval("""
        (() => {
          const items = [].slice.call(document.querySelectorAll('#ho-list li[data-i]'));
          const shown = items.filter((l) => !l.hidden);
          const target = shown[shown.length - 1] || items[items.length - 1];
          window.scrollTo(0, 900);
          const before = window.scrollY;
          target.click();
          const panels = [].slice.call(document.querySelectorAll('.ho-panel-data'));
          const active = panels.filter((p) => !p.hidden);
          return { clicked: target.getAttribute('data-i'), scrollBefore: before, scrollAfter: window.scrollY,
                   visiblePanels: active.length, activeIdx: active.length ? active[0].getAttribute('data-i') : null,
                   activeHasQuestion: active.length ? !!active[0].querySelector('.ho-question') : false };
        })()
        """)
        print("switch:", json.dumps(click, ensure_ascii=False))

        # 清空搜索，确认折叠块恢复收起
        reset = sess.eval("""
        (() => {
          const input = document.getElementById('ho-search');
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { items: [].slice.call(document.querySelectorAll('#ho-list li[data-i]')).filter((l) => !l.hidden).length,
                   detailsOpen: document.querySelectorAll('details.ho-think[open]').length };
        })()
        """)
        print("reset:", json.dumps(reset, ensure_ascii=False))
    finally:
        sess.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
