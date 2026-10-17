// Runs in the add-on's own space. Reads the saved settings and hands them to page.js inside the page.
(() => {
  const DEFAULTS = { shade: true, zone: true, zonePct: 20, fastHide: true, hideMs: 1000, dblFull: true, smoothClick: true };

  function send(s) {
    // A plain string crosses safely from the add-on into the page.
    window.dispatchEvent(new CustomEvent('clear-view:settings', { detail: JSON.stringify(s) }));
  }
  async function load() {
    try { return Object.assign({}, DEFAULTS, await browser.storage.local.get(DEFAULTS)); }
    catch { return DEFAULTS; }
  }

  // page.js asks when it starts; we also send once on our own in case it started first.
  window.addEventListener('clear-view:hello', () => load().then(send));
  load().then(send);

  // The settings changed: send the new set right away.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') load().then(send);
  });
})();
