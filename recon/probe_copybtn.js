(() => {
  const sr = document.getElementById('ds-outline-host').shadowRoot;
  if (sr.querySelector('.ho-panel').hidden) sr.querySelector('.ho-fab').click();
  const bar = sr.querySelector('.ho-question-bar');
  return {
    barHtml: bar ? bar.outerHTML.slice(0, 400) : null,
    copyBtns: sr.querySelectorAll('.ho-copy-btn').length,
    qBtn: !!sr.querySelector('.ho-copy-q'),
    aBtn: !!sr.querySelector('.ho-copy-a'),
    detailText: (sr.querySelector('.ho-detail') || {}).innerText ? sr.querySelector('.ho-detail').innerText.slice(0, 80) : null
  };
})()
