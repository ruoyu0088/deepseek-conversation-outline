(async () => {
  // 打开一个带联网搜索的会话，观察"引用标注"在 DOM 里长什么样
  const id = '7aa99799-09f1-4e93-9bfd-cf55f85431ac';
  history.pushState({}, '', '/a/chat/s/' + id);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await new Promise((r) => setTimeout(r, 3500));
  const out = { url: location.href, title: document.title, suspects: [], sups: 0, anchors: 0 };
  for (const el of document.querySelectorAll('[class*="cite" i], [class*="ref" i], sup, [data-cite]')) {
    const t = (el.textContent || '').trim();
    if (el.getBoundingClientRect().width === 0 && el.getBoundingClientRect().height === 0) continue;
    if (out.suspects.length < 12) {
      out.suspects.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 60), text: t.slice(0, 30), html: el.outerHTML.slice(0, 160) });
    }
  }
  out.sups = document.querySelectorAll('sup').length;
  out.anchors = document.querySelectorAll('.ds-markdown a, [class*="markdown"] a').length;
  const md = document.querySelector('.ds-markdown');
  out.mdCls = md ? String(md.className) : null;
  out.mdSample = md ? md.innerHTML.slice(0, 600) : null;
  return out;
})()
