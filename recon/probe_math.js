(() => {
  const sr = document.getElementById('ds-outline-host').shadowRoot;
  const items = Array.from(sr.querySelectorAll('li.ho-item'));
  const detail = sr.querySelector('.ho-detail');
  const out = { turns: items.length, mathTotal: 0, mathVisible: 0, mathZero: 0, fallback: 0, sample: [] };
  for (let i = 0; i < items.length; i++) {
    items[i].click();
    const maths = Array.from(detail.querySelectorAll('math'));
    out.mathTotal += maths.length;
    for (const m of maths) {
      const r = m.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.mathVisible++; else out.mathZero++;
    }
    const fb = detail.querySelectorAll('.ho-math-fallback');
    out.fallback += fb.length;
    if (maths.length && out.sample.length < 3) {
      const first = maths[0];
      out.sample.push({
        turn: i + 1,
        text: (first.textContent || '').slice(0, 40),
        width: Math.round(first.getBoundingClientRect().width),
        annotation: (first.querySelector('annotation') || {}).textContent || ''
      });
    }
  }
  items[0] && items[0].click();
  return out;
})()
