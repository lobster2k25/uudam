// Hold Shift and point at Japanese text: the word under the mouse gets a highlight and a popup with its
// reading and English meaning (and the Mongolian one when our dictionary has it). The page text around the
// mouse goes to the background page, which splits it into words and looks the word up.
(() => {
  if (window.uudamHover) return; // the script can be injected twice into the same frame
  window.uudamHover = true;
  const api = globalThis.browser || globalThis.chrome;
  const JAPANESE = /[぀-ヿ㐀-鿿豈-﫿々〆ｦ-ﾟ]/;
  const CONTEXT = 120; // at most this many characters of the sentence on each side of the mouse
  const STOPS = /[。！？!?\n]/; // the context is cut at sentence ends
  const SKIP = 'rt, rp, script, style, noscript, textarea, input, select, [contenteditable=""], [contenteditable="true"]';
  const JM_POS = {
    n: 'noun', pn: 'pronoun', 'adj-i': 'i-adjective', 'adj-na': 'na-adjective', 'adj-no': 'noun (の)', adv: 'adverb',
    exp: 'expression', int: 'interjection', prt: 'particle', conj: 'conjunction', ctr: 'counter',
    suf: 'suffix', 'n-suf': 'suffix', pref: 'prefix', 'n-pref': 'prefix',
  };
  const posLabel = (code) => (/^v/.test(code) ? 'verb' : /^aux/.test(code) ? 'auxiliary' : JM_POS[code] || '');

  let mouse = null; // last mouse position { x, y }
  let shown = null; // { ranges, rects } of the word in the popup
  let want = null; // { ctx, offset } the mouse is on now, while its sentence is being looked up
  let frame = 0;
  // Sentence text → its words from the background. Moving within a sentence then needs no round trip.
  const sentences = new Map();
  let host = null;
  let box = null;

  // ---------- the text under the mouse ----------

  // The character under (x, y): { node, offset } in a text node, or null when the mouse is not on a character.
  function charAt(x, y) {
    let node;
    let offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode;
      offset = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer;
      offset = r.startOffset;
    } else {
      return null;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement || node.parentElement.closest(SKIP)) return null;
    // The caret sits between two characters; the mouse is on whichever one's box holds the point.
    const range = document.createRange();
    for (const i of [offset, offset - 1]) {
      if (i < 0 || i >= node.data.length) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      for (const r of range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return JAPANESE.test(node.data[i]) ? { node, offset: i } : null;
      }
    }
    return null;
  }

  // The nearest ancestor that is not inline, so the text around the mouse comes from the same paragraph.
  function blockOf(node) {
    let el = node.parentElement;
    for (let i = 0; el && i < 10; i++, el = el.parentElement) {
      if (!getComputedStyle(el).display.startsWith('inline')) return el;
    }
    return el || node.parentElement;
  }

  // The text around the mouse as one string, with a map back to the page's text nodes.
  // Returns { text, offset, pieces: [{ node, at }] } where `at` is where the node's text starts in `text`.
  function contextAt(hit) {
    // Walk outwards from the mouse's text node until there is enough text on each side (not the whole
    // block: on some pages that is the whole page).
    const walker = document.createTreeWalker(blockOf(hit.node), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [hit.node];
    let before = hit.offset;
    walker.currentNode = hit.node;
    // A node with a sentence end is the last one taken (the sentence is cut out of the text below).
    for (let n = hit.node; before < CONTEXT && !STOPS.test(n.data.slice(0, n === hit.node ? hit.offset : undefined));) {
      n = walker.previousNode();
      if (!n) break;
      nodes.unshift(n);
      before += n.data.length;
    }
    let after = hit.node.data.length - hit.offset;
    walker.currentNode = hit.node;
    for (let n = hit.node; after < CONTEXT && !STOPS.test(n.data.slice(n === hit.node ? hit.offset : 0));) {
      n = walker.nextNode();
      if (!n) break;
      nodes.push(n);
      after += n.data.length;
    }

    let text = '';
    const pieces = [];
    for (const n of nodes) {
      pieces.push({ node: n, at: text.length });
      text += n.data;
    }
    let offset = pieces.find((p) => p.node === hit.node).at + hit.offset;
    // The sentence the mouse is in (at most CONTEXT characters each side), so the text stays the same
    // while the mouse moves along it and its words can be reused.
    let from = Math.max(0, offset - CONTEXT);
    let to = Math.min(text.length, offset + CONTEXT);
    for (let k = offset - 1; k >= from; k--) if (STOPS.test(text[k])) { from = k + 1; break; }
    for (let k = offset; k < to; k++) if (STOPS.test(text[k])) { to = k; break; }
    for (const p of pieces) p.at -= from;
    text = text.slice(from, to);
    offset -= from;
    return { text, offset, pieces };
  }

  // Page ranges for characters start..end of a context (a word can span several text nodes).
  function rangesFor(ctx, start, end) {
    const out = [];
    for (const p of ctx.pieces) {
      const a = Math.max(start, p.at);
      const b = Math.min(end, p.at + p.node.data.length);
      if (a >= b) continue;
      const r = document.createRange();
      r.setStart(p.node, a - p.at);
      r.setEnd(p.node, b - p.at);
      out.push(r);
    }
    return out;
  }

  // ---------- lookup ----------

  function lookAt(x, y) {
    if (host && host.contains(document.elementFromPoint(x, y))) return;
    const hit = charAt(x, y);
    if (!hit) { want = null; return; }
    if (shown && shown.ranges.some((r) => r.startContainer === hit.node && hit.offset >= r.startOffset && hit.offset < r.endOffset)) return;
    const ctx = contextAt(hit);
    const words = sentences.get(ctx.text);
    if (Array.isArray(words)) { showAt(ctx, words, ctx.offset); return; }
    want = { ctx, offset: ctx.offset };
    if (words) return; // already asked
    sentences.set(ctx.text, 'asked');
    if (sentences.size > 200) sentences.delete(sentences.keys().next().value);
    api.runtime.sendMessage({ type: 'hover-words', text: ctx.text }).then((list) => {
      sentences.set(ctx.text, list || []);
      // Show the word the mouse is on by now, if it is still in this sentence.
      if (want && want.ctx.text === ctx.text) showAt(want.ctx, list || [], want.offset);
    }, () => sentences.delete(ctx.text));
  }

  function showAt(ctx, words, offset) {
    want = null;
    const word = words.find((w) => offset >= w.start && offset < w.end);
    if (!word) return;
    const ranges = rangesFor(ctx, word.start, word.end);
    if (ranges.length) show(word, ranges);
  }

  // At most one lookup per animation frame.
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (mouse) lookAt(mouse.x, mouse.y);
    });
  }

  // ---------- popup ----------

  const STYLE = `
    :host { all: initial; }
    .box {
      position: fixed; z-index: 2147483647; box-sizing: border-box;
      width: max-content; min-width: 180px; max-width: min(400px, calc(100vw - 16px)); max-height: 50vh; overflow-y: auto;
      padding: 12px 14px; border-radius: 10px; background: #1c1c1e; color: #f2f2f2;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); border: 1px solid #3a3a3c;
      font: 15px/1.45 "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif; text-align: left;
    }
    .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
    .word { font-size: 26px; font-weight: 600; }
    .reading { color: #ffe58a; font-size: 16px; }
    .from { color: #aeaeb2; font-size: 13px; margin-bottom: 6px; }
    .entry + .entry { margin-top: 8px; padding-top: 8px; border-top: 1px solid #3a3a3c; }
    .entry-head { color: #aeaeb2; font-size: 13px; }
    ol { margin: 2px 0 0; padding-left: 20px; }
    li { margin: 1px 0; }
    .pos { color: #8e8e93; font-size: 12px; font-style: italic; margin-right: 4px; }
    .section { color: #8e8e93; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 10px; }
    .none { color: #aeaeb2; }
    .credit { color: #636366; font-size: 11px; margin-top: 10px; }
  `;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show(word, ranges) {
    if (!host) {
      host = document.createElement('uudam-hover');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      box = el('div', 'box');
      shadow.append(style, box);
    }
    if (!host.isConnected) document.documentElement.append(host);

    const parts = [];
    const head = el('div', 'head');
    const w = el('span', 'word', word.form);
    head.append(w);
    if (word.reading && word.reading !== word.form) head.append(el('span', 'reading', word.reading));
    parts.push(head);
    if (word.surface !== word.form) parts.push(el('div', 'from', `${word.surface} → ${word.form}`));

    for (const e of word.english) {
      const entry = el('div', 'entry');
      if (word.english.length > 1) entry.append(el('div', 'entry-head', e.k[0] ? `${e.k[0]}【${e.r[0]}】` : e.r[0]));
      const ol = el('ol');
      for (const [pos, gloss] of e.s) {
        const li = el('li');
        if (posLabel(pos)) li.append(el('span', 'pos', posLabel(pos)));
        li.append(gloss);
        ol.append(li);
      }
      entry.append(ol);
      parts.push(entry);
    }
    if (word.mongolian.length) {
      parts.push(el('div', 'section', 'Монгол'));
      const ol = el('ol');
      for (const m of word.mongolian.flat()) ol.append(el('li', null, m));
      parts.push(ol);
    }
    if (!word.english.length && !word.mongolian.length) parts.push(el('div', 'none', 'No dictionary entry.'));
    if (word.english.length) parts.push(el('div', 'credit', 'JMdict © EDRDG · CC BY-SA 4.0'));
    box.replaceChildren(...parts);
    box.scrollTop = 0;

    highlight(ranges);
    const rects = ranges.flatMap((r) => [...r.getClientRects()]);
    shown = { ranges, rects };
    place(rects);
  }

  // Under the word, or above it when there is no room below.
  function place(rects) {
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = Math.min(...rects.map((r) => r.left));
    box.style.left = '0px';
    box.style.top = '0px';
    const b = box.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, left))}px`;
    const below = bottom + 6;
    box.style.top = `${below + b.height <= innerHeight - 8 || top - b.height - 6 < 8 ? below : top - b.height - 6}px`;
  }

  function hide() {
    if (host) host.remove();
    highlight([]);
    shown = null;
    want = null;
  }

  // The word's highlight: the CSS Custom Highlight API leaves the page's DOM and selection alone.
  let highlightStyle = null;
  function highlight(ranges) {
    if (!globalThis.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    if (!ranges.length) { CSS.highlights.delete('uudam-hover'); return; }
    if (!highlightStyle) {
      highlightStyle = document.createElement('style');
      highlightStyle.textContent = '::highlight(uudam-hover) { background-color: rgba(255, 214, 10, 0.45); color: inherit; }';
    }
    if (!highlightStyle.isConnected) (document.head || document.documentElement).append(highlightStyle);
    CSS.highlights.set('uudam-hover', new Highlight(...ranges));
  }

  // Whether (x, y) is on the shown word (a little margin) or on the popup.
  function nearShown(x, y) {
    if (!shown) return false;
    if (box && host.isConnected) {
      const b = box.getBoundingClientRect();
      if (x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 8 && y <= b.bottom + 8) return true;
    }
    return shown.rects.some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 8);
  }

  // ---------- events ----------

  addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) schedule();
    else if (shown && !nearShown(e.clientX, e.clientY)) hide();
  }, { passive: true, capture: true });

  addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !e.repeat && mouse) lookAt(mouse.x, mouse.y);
    else if (e.key === 'Escape' && shown) hide();
  }, true);

  addEventListener('mousedown', (e) => { if (shown && !(host && e.composedPath().includes(host))) hide(); }, true);
  addEventListener('scroll', () => { if (shown) hide(); }, { passive: true, capture: true });
  addEventListener('blur', () => { if (shown) hide(); });
})();
