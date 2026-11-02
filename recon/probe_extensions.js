(() => {
  const texts = [];
  const walk = (root, depth) => {
    if (!root || depth > 12) return;
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'EXTENSIONS-ITEM') {
        const nameEl = el.shadowRoot && el.shadowRoot.querySelector('#name');
        const idEl = el.shadowRoot && el.shadowRoot.querySelector('#extension-id');
        texts.push({
          name: nameEl ? nameEl.textContent.trim() : null,
          id: idEl ? idEl.textContent.trim() : (el.getAttribute('id') || null),
          enabled: el.getAttribute('data-enabled') || (el.shadowRoot && el.shadowRoot.querySelector('#enableToggle') ? 'toggle' : '?')
        });
      }
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);
  return { url: location.href, items: texts, bodyLen: document.body.innerText.length,
           bodyHead: document.body.innerText.slice(0, 300) };
})()
