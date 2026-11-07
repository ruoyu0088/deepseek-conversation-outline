(async () => {
  // 在 file:// 页面里试一下直连签名地址：确认离线导出页确实拿不到附件正文
  const url = document.body.getAttribute("data-probe-url") || "";
  const out = { origin: location.origin, href: location.href.slice(0, 60) };
  if (!url) return Object.assign(out, { note: "no url" });
  try {
    const r = await fetch(url, { credentials: "omit" });
    out.result = { status: r.status, ct: r.headers.get("content-type") };
  } catch (e) {
    out.result = { error: String(e) };
  }
  return out;
})()
