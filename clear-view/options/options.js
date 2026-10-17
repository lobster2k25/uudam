const DEFAULTS = { shade: true, zone: true, zonePct: 20, fastHide: true, hideMs: 1000, dblFull: true, smoothClick: true };
const LIMITS = { zonePct: [5, 60], hideMs: [200, 10000] };
if (location.search.includes('popup')) document.body.classList.add('popup');
const saved = document.getElementById('saved');
let savedTimer = null;

function flashSaved() {
  saved.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('on'), 1500);
}

async function init() {
  const s = await browser.storage.local.get(DEFAULTS);
  for (const [k, v] of Object.entries(s)) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;

    el.addEventListener('change', async () => {
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else {
        const [lo, hi] = LIMITS[k];
        val = Math.min(hi, Math.max(lo, Math.round(Number(el.value) || DEFAULTS[k])));
        el.value = val;
      }
      await browser.storage.local.set({ [k]: val });
      flashSaved();
    });
  }
}
init();
