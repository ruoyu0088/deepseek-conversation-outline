(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return { err: 'no textarea' };
  const chain = [];
  let el = ta;
  for (let i = 0; i < 5 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const r = el.getBoundingClientRect();
    chain.push({
      lvl: i + 1,
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 80),
      role: el.getAttribute('role'),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      nBtn: el.querySelectorAll('[role=button]').length
    });
  }
  const box = ta.parentElement.parentElement.parentElement;
  const br = box.getBoundingClientRect();
  const btns = [];
  for (const b of box.querySelectorAll('[role=button]')) {
    const r = b.getBoundingClientRect();
    const path = b.querySelector('path');
    btns.push({
      cls: String(b.className || '').slice(0, 90),
      aria: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
      rel: [Math.round(r.left - br.left), Math.round(r.top - br.top), Math.round(r.width), Math.round(r.height)],
      d: path ? String(path.getAttribute('d') || '').slice(0, 36) : '',
      text: (b.textContent || '').trim().slice(0, 16)
    });
  }
  return { chain: chain, boxCls: String(box.className || ''), boxSize: [Math.round(br.width), Math.round(br.height)], btns: btns };
})()
