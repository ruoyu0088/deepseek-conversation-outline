(() => {
  const sr = document.getElementById('ds-outline-host').shadowRoot;
  const items = Array.from(sr.querySelectorAll('li.ho-item'));
  const detail = sr.querySelector('.ho-detail');
  const rows = [];
  let attachTurns = 0;
  for (let i = 0; i < items.length; i++) {
    items[i].click();
    const q = detail.querySelector('.ho-question');
    const att = detail.querySelectorAll('.ho-attach');
    if (att.length) attachTurns++;
    const text = q ? q.textContent : '';
    if (/\[附件\]|\[图片\]/.test(text) || att.length) {
      rows.push({ i: i + 1, q: text.slice(0, 50), attachRows: att.length });
    }
  }
  items[0] && items[0].click();
  return { turns: items.length, attachTurns, withAttachmentInText: rows.length, sample: rows.slice(0, 6) };
})()
