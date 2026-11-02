(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return { err: 'no textarea' };
  let box = ta;
  for (let i = 0; i < 3 && box; i++) box = box.parentElement;
  const send = (() => {
    let el = ta;
    for (let i = 0; i < 6 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const c = el.querySelectorAll('[role=button].ds-button--primary');
      if (c.length) return c[c.length - 1];
    }
    return null;
  })();
  const dump = (el) => el ? {
    cls: String(el.className || ''), disabled: el.getAttribute('aria-disabled'), tabindex: el.getAttribute('tabindex'),
    rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
    html: el.outerHTML.slice(0, 400)
  } : null;
  return { send: dump(send), docTitle: document.title, bodyBg: getComputedStyle(document.body).backgroundColor,
           hasDark: document.documentElement.className, lang: document.documentElement.lang };
})()
