// Clear View for Apple TV - runs inside the tv.apple.com page, before the page's own code.
// Settings come from bridge.js (the add-on's settings live in browser.storage).
//
// What it does:
//   1. Removes the dark shade drawn over the video when the controls show.
//   2. Only mouse moves in the bottom part of the video wake the controls.
//   3. Tells the player "the mouse left" after a short still time, so the controls hide fast.
//   4. Double-click the video to toggle full screen, without a pause/play stutter.

(() => {
  'use strict';
  if (window.__clearViewAppleTV) return;
  window.__clearViewAppleTV = true;

  const TAG = '[clear-view]';
  const AWAKE_MS = 3000;      // after a move in the bottom zone, let all moves through for this long
  const CURSOR_MS = 1500;     // keep the cursor visible this long after a move we hid from the player
  const CLICK_WAIT_MS = 300;  // a single click waits this long to see if it becomes a double-click

  const origAdd = EventTarget.prototype.addEventListener;
  const origAttach = Element.prototype.attachShadow;

  // Defaults; bridge.js sends the saved values.
  const settings = {
    shade: true,       // remove the dark background
    zone: true,        // only the bottom part of the video wakes the controls
    zonePct: 20,       // size of that bottom part, in %
    fastHide: true,    // tell the player "mouse left" after a short still time
    hideMs: 1000,      // that still time, in ms
    dblFull: true,     // double-click the video to toggle full screen
    smoothClick: true  // no pause/play stutter on double-click
  };

  // ---------- Reach inside the player ----------
  // Apple's player is built from closed shadow roots, which page CSS and scripts can't reach.
  // We open them so we can add our stylesheet and find the video. Nothing else is changed.
  const roots = new Set();
  Element.prototype.attachShadow = function (init) {
    const root = origAttach.call(this, Object.assign({}, init, { mode: 'open' }));
    roots.add(root);
    return root;
  };

  // Visit every element, including inside shadow roots
  function walk(root, fn) {
    for (const el of root.querySelectorAll('*')) {
      fn(el);
      if (el.shadowRoot) walk(el.shadowRoot, fn);
    }
  }
  function adopt(sheet, target) {
    try {
      if (!target.adoptedStyleSheets.includes(sheet)) target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    } catch {}
  }
  // Deepest element under a point, going inside shadow roots
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }
  function composedParent(el) {
    if (el.parentElement) return el.parentElement;
    const r = el.getRootNode();
    return r instanceof ShadowRoot ? r.host : null;
  }

  // ---------- Find the main video ----------
  let vCache = null, vTime = 0;
  function mainVideo(fresh) {
    const now = performance.now();
    if (!fresh && now - vTime < 500) return vCache;
    vTime = now;
    let best = null, area = 0;
    walk(document, el => {
      if (el.tagName === 'VIDEO') {
        const r = el.getBoundingClientRect();
        if (r.width * r.height > area) { area = r.width * r.height; best = el; }
      }
    });
    vCache = best;
    return best;
  }
  function videoRect(fresh) {
    const v = mainVideo(fresh);
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return r.width > 50 && r.height > 50 ? r : null;
  }
  const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  // ---------- 1. Remove the dark shade ----------
  function parseRGBA(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  // A dark or gradient layer (not an opaque black backdrop)
  function isShade(cs) {
    if (/gradient\(/.test(cs.backgroundImage)) return true;
    const c = parseRGBA(cs.backgroundColor);
    if (!c || c.a === 0) return false;
    return Math.max(c.r, c.g, c.b) < 90 && c.a * parseFloat(cs.opacity || '1') < 0.95;
  }
  // Big layers over the video that draw a shade on themselves or their ::before/::after
  function findShades() {
    const vr = videoRect(true);
    if (!vr) return [];
    const out = [];
    walk(document, el => {
      if (el.tagName === 'VIDEO' || el === document.documentElement || el === document.body) return;
      const r = el.getBoundingClientRect();
      if (r.width < vr.width * 0.4 || r.height < vr.height * 0.1) return;
      if (r.right < vr.left || r.left > vr.right || r.bottom < vr.top || r.top > vr.bottom) return;
      const where = [];
      if (isShade(getComputedStyle(el))) where.push('self');
      for (const p of ['::before', '::after']) {
        const ps = getComputedStyle(el, p);
        if (ps.content === 'none' || ps.content === 'normal') continue;
        if (isShade(ps)) where.push(p.slice(2));
      }
      if (where.length) out.push({ el, where });
    });
    return out;
  }

  const shadeSheet = new CSSStyleSheet();
  shadeSheet.replaceSync(`
    [data-cv-noshade~="self"] { background-image: none !important; background-color: transparent !important; }
    [data-cv-noshade~="before"]::before { background: none !important; }
    [data-cv-noshade~="after"]::after { background: none !important; }
  `);
  const marked = new Set();
  let shadeTimer = null;
  function applyShade() {
    if (!mainVideo()) return;
    for (const c of findShades()) {
      const tok = c.where.join(' ');
      if (c.el.getAttribute('data-cv-noshade') !== tok) c.el.setAttribute('data-cv-noshade', tok);
      marked.add(c.el);
    }
    for (const el of marked) {
      const root = el.getRootNode();
      adopt(shadeSheet, root instanceof ShadowRoot ? root : document);
    }
  }
  function startShade() { if (!shadeTimer) { applyShade(); shadeTimer = setInterval(applyShade, 1000); } }
  function stopShade() {
    clearInterval(shadeTimer); shadeTimer = null;
    for (const el of marked) el.removeAttribute('data-cv-noshade');
    marked.clear();
  }

  // ---------- Keep the cursor visible while moves are hidden from the player ----------
  // The player hides the cursor when it thinks the mouse is still. When we hide a move from it,
  // we show the cursor ourselves for a moment.
  const cursorSheet = new CSSStyleSheet();
  let cursorOn = false, cursorTimer = null;
  function showCursor() {
    if (!cursorOn) {
      cursorSheet.replaceSync('*, *::before, *::after { cursor: default !important; }');
      cursorOn = true;
      for (const t of [document, ...roots]) adopt(cursorSheet, t);
    }
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => { cursorSheet.replaceSync(''); cursorOn = false; }, CURSOR_MS);
  }

  // ---------- 2. Only the bottom of the video wakes the controls ----------
  let awakeUntil = 0;
  let needReenter = false;  // the player may think the mouse is outside, until we say "came back"

  function onMouse(e) {
    if (!e.isTrusted) return;
    const isMove = e.type === 'mousemove' || e.type === 'pointermove';
    const vr = settings.zone || isMove ? videoRect() : null;
    let blocked = false;

    if (settings.zone && vr && e.buttons === 0 && inside(vr, e.clientX, e.clientY)) {
      const now = performance.now();
      const line = vr.bottom - vr.height * (settings.zonePct / 100);
      if (e.clientY >= line) awakeUntil = now + AWAKE_MS;
      else if (now >= awakeUntil) {
        e.stopImmediatePropagation();
        blocked = true;
        if (isMove) showCursor();
        if (/over|enter/.test(e.type)) needReenter = true;
      }
    }

    if (!blocked && /over|enter/.test(e.type)) needReenter = false;
    if (!blocked && e.type === 'mousemove' && vr) {
      if (needReenter) reenter(e.clientX, e.clientY);
      scheduleHide(e.clientX, e.clientY);
    }
  }
  for (const t of ['mousemove', 'pointermove', 'mouseover', 'pointerover', 'mouseout', 'pointerout',
                   'mouseenter', 'pointerenter', 'mouseleave', 'pointerleave']) {
    origAdd.call(window, t, onMouse, { capture: true });
  }

  // ---------- 3. Hide faster: say "the mouse left" after a short still time ----------
  let lastX = 0, lastY = 0, hideTimer = null;
  function scheduleHide(x, y) {
    lastX = x; lastY = y;
    clearTimeout(hideTimer);
    hideTimer = settings.fastHide ? setTimeout(fakeLeave, settings.hideMs) : null;
  }
  function fakeLeave() {
    hideTimer = null;
    if (!settings.fastHide || !mainVideo()) return;
    const target = deepElementFromPoint(lastX, lastY);
    if (!target) return;
    const base = { clientX: lastX, clientY: lastY, relatedTarget: null, view: window };
    const ptr = { ...base, pointerType: 'mouse', isPrimary: true, pointerId: 1 };
    try {
      target.dispatchEvent(new PointerEvent('pointerout', { ...ptr, bubbles: true, composed: true }));
      target.dispatchEvent(new MouseEvent('mouseout', { ...base, bubbles: true, composed: true }));
      for (let el = target; el; el = composedParent(el)) {
        el.dispatchEvent(new PointerEvent('pointerleave', ptr));
        el.dispatchEvent(new MouseEvent('mouseleave', base));
      }
      document.dispatchEvent(new MouseEvent('mouseleave', base));
    } catch {}
    needReenter = true;
  }
  // Say "the mouse came back", so the next click or move works as normal
  function reenter(x, y) {
    needReenter = false;
    const target = deepElementFromPoint(x, y);
    if (!target) return;
    const chain = [];
    for (let el = target; el; el = composedParent(el)) chain.unshift(el); // outermost first
    const base = { clientX: x, clientY: y, relatedTarget: null, view: window };
    const ptr = { ...base, pointerType: 'mouse', isPrimary: true, pointerId: 1 };
    try {
      target.dispatchEvent(new PointerEvent('pointerover', { ...ptr, bubbles: true, composed: true }));
      for (const el of chain) el.dispatchEvent(new PointerEvent('pointerenter', ptr));
      target.dispatchEvent(new MouseEvent('mouseover', { ...base, bubbles: true, composed: true }));
      for (const el of chain) el.dispatchEvent(new MouseEvent('mouseenter', base));
      target.dispatchEvent(new PointerEvent('pointermove', { ...ptr, bubbles: true, composed: true }));
      target.dispatchEvent(new MouseEvent('mousemove', { ...base, bubbles: true, composed: true }));
    } catch {}
  }
  for (const t of ['pointerdown', 'mousedown']) {
    origAdd.call(window, t, e => {
      if (!e.isTrusted || !needReenter) return;
      const vr = videoRect();
      if (vr && inside(vr, e.clientX, e.clientY)) reenter(e.clientX, e.clientY);
    }, true);
  }

  // ---------- 4. Double-click the video for full screen ----------
  const FS_LABEL = /full\s*-?\s*screen|全画面|フルスクリーン|plein\s*écran|vollbild|pantalla\s*completa/i;
  const CLICKABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

  // Apple's own full screen button, if we can find it (only real buttons)
  function findFullscreenButton() {
    let found = null;
    walk(document, el => {
      if (found) return;
      const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'),
                     el.getAttribute('part'), el.getAttribute('class'), el.id].join(' ');
      if (!FS_LABEL.test(label)) return;
      found = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? el : el.closest('button,[role=button]');
    });
    return found;
  }
  // True when a click lands on the bare video area (not a button, slider or menu)
  function onVideoSurface(e) {
    const vr = videoRect();
    if (!vr || !inside(vr, e.clientX, e.clientY)) return false;
    for (const n of e.composedPath()) {
      if (!(n instanceof Element)) continue;
      if (CLICKABLE.has(n.tagName)) return false;
      const role = n.getAttribute('role');
      if (['button', 'slider', 'menuitem', 'menu', 'dialog'].includes(role)) return false;
      if (n.tagName === 'VIDEO') break;
    }
    return true;
  }

  // Apple's player reacts to each click of a double-click (pause, then play). So we keep clicks on the
  // bare video away from it, wait a moment, and if no second click comes we pause/play the video ourselves.
  let clickTimer = null, firstClickToggled = false;
  const smoothOn = () => settings.dblFull && settings.smoothClick;
  function togglePlay() {
    const v = mainVideo(true);
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    origAdd.call(window, t, e => {
      if (!smoothOn() || !e.isTrusted || e.button !== 0) return;
      if (onVideoSurface(e)) e.stopImmediatePropagation();
    }, true);
  }
  origAdd.call(window, 'click', e => {
    if (!smoothOn() || !e.isTrusted || e.button !== 0 || !onVideoSurface(e)) return;
    e.stopImmediatePropagation();
    if (e.detail <= 1) {
      clearTimeout(clickTimer);
      firstClickToggled = false;
      clickTimer = setTimeout(() => { clickTimer = null; togglePlay(); firstClickToggled = true; }, CLICK_WAIT_MS);
    } else if (e.detail === 2) {
      // Second click: cancel the waiting single click, or undo it if a slow double-click let it run.
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      else if (firstClickToggled) togglePlay();
      firstClickToggled = false;
    }
  }, true);

  origAdd.call(window, 'dblclick', e => {
    if (!settings.dblFull || !e.isTrusted || e.button !== 0 || !onVideoSurface(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const btn = findFullscreenButton();
    if (btn) { btn.click(); return; }
    // No button found: make the whole page full screen, so the controls stay with the video
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }, true);

  // ---------- Settings from bridge.js ----------
  function applySettings(next) {
    for (const k of Object.keys(settings)) {
      if (next && typeof next[k] === typeof settings[k]) settings[k] = next[k];
    }
    settings.zonePct = Math.min(60, Math.max(5, settings.zonePct));
    settings.hideMs = Math.min(10000, Math.max(200, settings.hideMs));
    if (settings.shade) startShade(); else stopShade();
    if (!settings.fastHide) { clearTimeout(hideTimer); hideTimer = null; }
  }
  origAdd.call(window, 'clear-view:settings', e => {
    try { applySettings(JSON.parse(e.detail)); } catch {}
  });
  window.dispatchEvent(new CustomEvent('clear-view:hello'));

  if (settings.shade) startShade();
  console.info(TAG, 'loaded');
})();
