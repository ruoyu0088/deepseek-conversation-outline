(async () => {
  // 1) 从当前会话接口里拿一个真实的 FILE 片段
  const tok = (() => { try { return JSON.parse(localStorage.getItem('userToken') || '{}').value || null; } catch (e) { return null; } })();
  const r = await fetch('/api/v0/chat/history_messages?chat_session_id=' + location.pathname.split('/').pop(),
    { credentials: 'include', headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  const j = await r.json();
  const msgs = j.data.biz_data.chat_messages || [];
  const files = [];
  for (const m of msgs) for (const f of (m.fragments || [])) if (f.type === 'FILE') for (const x of f.files) files.push(x);
  if (!files.length) return { err: 'no FILE fragment in this conversation' };
  const f = files[0];
  const base = 'https://files.deepseeksvc.com/api' + f.signed_path;
  const out = { file: { id: f.id, name: f.file_name, size: f.file_size, is_image: f.is_image }, tries: [] };
  const tryUrl = async (label, url, creds) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { credentials: creds || 'omit', mode: 'cors', headers: { accept: '*/*' } });
      const ct = res.headers.get('content-type') || '';
      let body = '';
      try { body = await res.text(); } catch (e) { body = 'READ_ERR ' + e; }
      out.tries.push({ label, status: res.status, ct, len: body.length, ms: Date.now() - t0,
                       head: body.slice(0, 60), tail: body.slice(-30) });
    } catch (e) {
      out.tries.push({ label, err: String(e) });
    }
  };
  await tryUrl('signed_path', base);
  await tryUrl('signed_path+ty=r', base + '&ty=r');
  await tryUrl('signed_path+ty=r (include)', base + '&ty=r', 'include');
  return out;
})()
