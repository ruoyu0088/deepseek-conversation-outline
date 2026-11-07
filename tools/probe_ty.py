"""验证 hook.fetchFile 自己补 ty=r：给一个不带 ty 的签名地址，应当仍能读到正文。

地址来源：页面里用 userToken 直接 GET /api/v0/chat/history_messages，取第一个 FILE 的 signed_path。
"""
import json
import sys
import time

sys.path.insert(0, r"C:\Users\ruoyu\workspace\chrome-cdp-tools")
from cdp import Session, _pick  # noqa: E402

SID = "2c9ce637-29ad-43a8-ba4f-3e28973db6ae"   # 对话「打包HTML运行Python可行」

FIND_URL = """
(async () => {
  const tok = JSON.parse(localStorage.getItem("userToken") || "{}");
  const r = await fetch("/api/v0/chat/history_messages?chat_session_id=%s",
                        { headers: { authorization: "Bearer " + (tok.value || tok) } });
  const j = await r.json();
  const msgs = (j.data && j.data.biz_data && j.data.biz_data.chat_messages) || [];
  for (const m of msgs) {
    for (const f of (m.fragments || [])) {
      for (const file of ((f.files) || [])) {
        if (file.signed_path && file.file_name === "bundle.txt") {
          return JSON.stringify({ name: file.file_name, size: file.file_size, path: file.signed_path });
        }
      }
    }
  }
  return "";
})()
""" % SID

INSTALL_LISTENER = """
(() => {
  if (window.__dsProbeListener) window.removeEventListener("message", window.__dsProbeListener);
  window.__dsProbeFile = null;
  window.__dsProbeListener = (ev) => {
    const d = ev.data;
    if (d && d.type === "file" && d.requestId && String(d.requestId).indexOf("probe-") === 0) window.__dsProbeFile = d;
  };
  window.addEventListener("message", window.__dsProbeListener);
  return true;
})()
"""


def js_call(sess, url, file_id=""):
    rid = "probe-%d" % int(time.time() * 1000)
    sess.eval("window.__dsProbeFile = null; true")
    sess.eval("""window.postMessage({__dsOutlineReq: true, action: "fetchFile", requestId: %s,
                                url: %s, fileId: %s}, "*"); true""" % (json.dumps(rid), json.dumps(url), json.dumps(file_id)))
    for _ in range(60):
        time.sleep(0.25)
        res = sess.eval("""
        (() => {
          const d = window.__dsProbeFile;
          return d ? JSON.stringify({ok: d.ok, kind: d.kind, len: d.text ? d.text.length : 0,
                                     head: d.text ? d.text.slice(0, 30) : null,
                                     error: d.error || null}) : "";
        })()
        """)
        if res:
            return json.loads(res)
    return {"timeout": True}


def main():
    sess = Session(_pick(9222, "chat.deepseek.com")["webSocketDebuggerUrl"])
    try:
        sess.eval(INSTALL_LISTENER)
        raw = sess.eval(FIND_URL, timeout=60)
        if not raw:
            print("没找到 bundle.txt 的 signed_path")
            return
        info = json.loads(raw)
        print("file:", info["name"], info["size"], "bytes")
        url = "https://files.deepseeksvc.com/api" + info["path"]
        print("url 带 ty=:", "ty=" in url)
        print("不带 ty  ->", json.dumps(js_call(sess, url), ensure_ascii=False))
        print("带 ty=r  ->", json.dumps(js_call(sess, url + ("&ty=r" if "?" in url else "?ty=r")), ensure_ascii=False))
        print("坏域名   ->", json.dumps(js_call(sess, "https://example.com/api/file?file_id=x"), ensure_ascii=False))
        print("空地址   ->", json.dumps(js_call(sess, "", "no-such-file-id"), ensure_ascii=False))
    finally:
        sess.close()


if __name__ == "__main__":
    main()
