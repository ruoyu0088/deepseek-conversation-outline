#!/usr/bin/env python
"""启动一个带远程调试端口、并已加载本扩展的独立 Chrome 窗口（开发/验证用）。

用法：
  python tools/launch_debug.py                # 默认端口 9222
  python tools/launch_debug.py --port 9333
  python tools/launch_debug.py --keep         # 不先关掉已存在的调试 Chrome
  python tools/launch_debug.py --url https://chat.deepseek.com/a/chat/s/<id>

说明：
  * 用独立 user-data-dir（默认 C:\\Users\\ruoyu\\workspace\\chrome-debug-profile-deepseek），
    不影响日常 Chrome 配置；登录态保存在里面，只需登录一次。
  * Chrome 137+ 不允许对默认配置开调试端口，也忽略了 --load-extension，
    所以这里用 Extensions.loadUnpacked（需要 --enable-unsafe-extension-debugging）。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DEFAULT_PROFILE = r"C:\Users\ruoyu\workspace\chrome-debug-profile-deepseek"
EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + r"\ext"
START_URL = "https://chat.deepseek.com/"


def cdp_ready(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=1) as r:
                json.load(r)
                return True
        except Exception:
            time.sleep(0.4)
    return False


def load_extension(port: int, ext: str) -> dict:
    sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
    from cdp import Session
    with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=5) as r:
        ws = json.load(r)["webSocketDebuggerUrl"]
    sess = Session(ws)
    try:
        res = sess.send("Extensions.loadUnpacked", {"path": ext}, timeout=20)
        return res
    finally:
        sess.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--profile", default=DEFAULT_PROFILE)
    ap.add_argument("--ext", default=EXT)
    ap.add_argument("--url", default=START_URL)
    ap.add_argument("--keep", action="store_true", help="不关闭已运行的调试 Chrome")
    args = ap.parse_args()

    if not args.keep:
        subprocess.run(["taskkill", "/IM", "chrome.exe", "/F"], capture_output=True)
        time.sleep(2.0)

    os.makedirs(args.profile, exist_ok=True)
    cmd = [
        CHROME,
        "--remote-debugging-port=%d" % args.port,
        "--user-data-dir=%s" % args.profile,
        "--no-first-run", "--no-default-browser-check", "--profile-directory=Default",
        "--enable-unsafe-extension-debugging",
        # 窗口被别的窗口完全遮住时 Chrome 会把页面标成 hidden：那时 CDP 的
        # Input.dispatchKeyEvent 不投递、navigator.clipboard 也会被拒，测试会假失败。
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        args.url,
    ]
    subprocess.Popen(cmd, close_fds=True)
    if not cdp_ready(args.port):
        print("Chrome 没起来（端口 %d 无响应）" % args.port)
        return 1
    time.sleep(1.0)
    print("loadUnpacked:", load_extension(args.port, args.ext))
    print("CDP: http://127.0.0.1:%d  profile: %s" % (args.port, args.profile))
    print("提示：首次使用要在弹出的窗口里登录 chat.deepseek.com。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
