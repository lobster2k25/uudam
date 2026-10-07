// Draws our own Japanese subtitle line over the Netflix player: furigana, clickable words, and a
// popup with the Mongolian meaning and kanji breakdown. Subtitles come from the WebVTT track that
// inject.js finds; if there is none, we read the text Netflix itself is showing.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const L = globalThis.JapSubLookup;
  const TAG = 'jap-sub:';
  const POS_MN = {
    noun: 'нэр үг', pronoun: 'төлөөний үг', verb: 'үйл үг', 'adj-i': 'тэмдэг нэр (い)', 'adj-na': 'тэмдэг нэр (な)',
    adverb: 'дайвар үг', particle: 'нөхцөл', auxiliary: 'туслах үг', conjunction: 'холбоос үг',
    interjection: 'аялга үг', prenoun: 'тодотгол', prefix: 'угтвар', suffix: 'дагавар',
    counter: 'тоо ширхэг', expression: 'хэллэг',
    // Proper nouns from ja-mn/names (build.js turns their kind into pos "name-<kind>").
    'name-country': 'улс', 'name-region': 'бүс нутаг', 'name-place': 'газрын нэр', 'name-landmark': 'газрын нэр',
    'name-org': 'байгууллага', 'name-group': 'бүлэг, шашин', 'name-surname': 'овог', 'name-other': 'оноосон нэр',
  };
  // Parts of speech worth logging when our dictionary lacks them.
  const LOG_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '感動詞', '連体詞', '接続詞']);

  let settings = { enabled: true, furigana: true };
  let index = null;
  const tokens = new Map(); // subtitle line → kuromoji tokens from the background page
  const pending = new Set();
  let waitingForTokens = false;

  const tracks = new Map(); // movieId → track list from inject.js
  let loaded = { key: null, cues: [] }; // the subtitle track in use
  let requested = null;

  const root = document.createElement('div');
  root.id = 'jap-sub-root';
  const lineBox = document.createElement('div');
  lineBox.className = 'jap-sub-lines';
  root.appendChild(lineBox);
  let shownText = null;
  let popup = null;
  let pausedByUs = false;

  // ---------- setup ----------

  api.storage.local.get({ enabled: true, furigana: true }).then((s) => { settings = s; shownText = null; });
  api.storage.onChanged.addListener((changes) => {
    for (const k of ['enabled', 'furigana']) if (changes[k]) settings[k] = changes[k].newValue;
    shownText = null;
  });

  const dictReady = (async () => {
    const load = async (file) => (await fetch(api.runtime.getURL(file))).json();
    const [dict, fallback] = await Promise.all([load('data/dict.json'), load('data/fallback.json').catch(() => [])]);
    index = L.buildIndex(dict, fallback);
    shownText = null;
  })().catch((err) => console.error(`[jap-sub] failed to load dictionary: ${err && err.message ? err.message : err}`));

  // ---------- subtitle tracks ----------

  window.addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || !e.data.startsWith(TAG)) return;
    const msg = JSON.parse(e.data.slice(TAG.length));
    if (msg.type === 'tracks') tracks.set(msg.movieId, msg.tracks);
    if (msg.type === 'subs' && msg.key === requested) {
      if (msg.error) console.warn(`[jap-sub] subtitle download failed: ${msg.error}`);
      else useSubs(msg.key, msg.text, 'from the track list');
    }
    // Netflix's own player downloaded a Japanese subtitle file (inject.js watches its requests).
    if (msg.type === 'captured' && !(loaded.key && loaded.key.endsWith(':list'))) {
      useSubs(`${currentMovie() || 'any'}:captured`, msg.text, 'caught from the player');
      capturedAt = Date.now();
    }
  });

  let capturedAt = 0;

  function useSubs(key, text, how) {
    const cc = key.includes('#cc');
    const cues = text.trimStart().startsWith('<') ? parseTtml(text, cc) : parseVtt(text, cc);
    if (!cues.length) { console.warn(`[jap-sub] could not read the subtitle file; it starts: ${text.slice(0, 200)}`); return; }
    console.info(`[jap-sub] Japanese subtitles loaded (${how}): ${cues.length} cues`);
    loaded = { key, cues };
    // The whole track in one go, and every word we lack in it goes to the missing-word list.
    const lines = cues.flatMap((c) => c.text.split('\n'));
    tokenize(lines).then(() => logMisses(lines));
  }

  const currentMovie = () => (location.pathname.match(/\/watch\/(\d+)/) || [])[1];

  const warned = new Set();
  const warnOnce = (key, text) => { if (!warned.has(key)) { warned.add(key); console.warn(`[jap-sub] ${text}`); } };
  const pageStart = Date.now();

  function wantedTrack() {
    const id = currentMovie();
    const list = id ? tracks.get(id) : [...tracks.values()].pop();
    if (!list) return null;
    const ja = list.filter((t) => /^ja/.test(t.language) && !t.forced && t.url);
    const t = ja.find((x) => !x.cc) || ja[0];
    if (!t) warnOnce(`noja:${id}`, `no Japanese text subtitles offered for ${id}`);
    return t && { key: `${id || 'any'}:${t.language}${t.cc ? '#cc' : ''}:list`, url: t.url };
  }

  function syncTrack() {
    const id = currentMovie() || 'any';
    // A file caught just before the URL switched to the next episode belongs to the new one.
    if (loaded.key && loaded.key.endsWith(':captured') && !loaded.key.startsWith(`${id}:`)) {
      loaded = Date.now() - capturedAt < 15000 ? { ...loaded, key: `${id}:captured` } : { key: null, cues: [] };
    }
    const t = wantedTrack();
    if (!t) {
      if (loaded.key && !loaded.key.startsWith(`${id}:`)) loaded = { key: null, cues: [] };
      if (!loaded.cues.length && currentMovie() && Date.now() - pageStart > 15000) {
        warnOnce(`none:${id}`, `no Japanese subtitle file seen for ${id}: turn Netflix's Japanese subtitles on and reload the page. Reading on-screen subtitles until then`);
      }
      return;
    }
    if (t.key === loaded.key || t.key === requested) return;
    requested = t.key;
    window.postMessage(TAG + JSON.stringify({ type: 'fetch', key: t.key, url: t.url }), '*');
  }

  function parseVtt(text, cc) {
    const time = (s) => s.split(':').reduce((acc, p) => acc * 60 + parseFloat(p), 0);
    const cues = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => l.includes('-->'));
      if (at < 0) continue;
      const [start, end] = lines[at].split('-->').map((s) => time(s.trim().split(/\s+/)[0]));
      const body = lines.slice(at + 1).map((l) => cleanLine(l, cc)).filter(Boolean).join('\n');
      if (body) cues.push({ start, end, text: body });
    }
    return cues;
  }

  function cleanLine(line, cc) {
    let s = line.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&lrm;|&rlm;|[‎‏]/g, '')
      // Furigana written inline: 漢字(かんじ) → 漢字. We draw our own.
      .replace(/([㐀-鿿々])[（(][ぁ-ゖー]+[）)]/g, '$1');
    s = s.replace(/^[（(][^）)]{1,15}[）)]\s*/, ''); // speaker label: （九条）烏丸先生
    if (cc) s = s.replace(/[（(〔\[][^）)〕\]]*[）)〕\]]/g, ''); // sound labels
    return s.trim();
  }

  // IMSC/TTML: <p begin end> elements; times in ticks ("123t") or clock time; ruby text dropped.
  function parseTtml(text, cc) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const tt = doc.documentElement;
    const attr = (el, name) => {
      for (const a of el.attributes) if (a.localName === name) return a.value;
      return null;
    };
    const tickRate = Number(attr(tt, 'tickRate')) || 10000000;
    const frameRate = Number(attr(tt, 'frameRate')) || 30;
    const time = (s) => {
      if (!s) return 0;
      if (/t$/.test(s)) return parseInt(s, 10) / tickRate;
      if (/ms$/.test(s)) return parseFloat(s) / 1000;
      if (/s$/.test(s)) return parseFloat(s);
      const m = s.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)(?::(\d+))?$/);
      return m ? m[1] * 3600 + m[2] * 60 + Number(m[3]) + (m[4] ? m[4] / frameRate : 0) : 0;
    };
    // Ruby can be set on the span itself or through a referenced <style>.
    const rubyStyles = new Map([...doc.getElementsByTagNameNS('*', 'style')].map((s) => [attr(s, 'id'), attr(s, 'ruby')]));
    const ruby = (el) => attr(el, 'ruby') || (attr(el, 'style') || '').split(/\s+/).map((id) => rubyStyles.get(id)).find(Boolean);
    const textOf = (node) => [...node.childNodes].map((n) => {
      if (n.nodeType === 3) return n.data.replace(/\s*\n\s*/g, '');
      if (n.nodeType !== 1) return '';
      if (n.localName === 'br') return '\n';
      if (ruby(n) === 'text') return '';
      return textOf(n);
    }).join('');
    const cues = [];
    for (const p of doc.getElementsByTagNameNS('*', 'p')) {
      const body = textOf(p).split('\n').map((l) => cleanLine(l, cc)).filter(Boolean).join('\n');
      if (body) cues.push({ start: time(attr(p, 'begin')), end: time(attr(p, 'end')), text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  function currentText(video) {
    if (loaded.cues.length) {
      const t = video.currentTime;
      return loaded.cues.filter((c) => c.start <= t && t < c.end).map((c) => c.text).join('\n');
    }
    // No subtitle file: fall back to whatever Netflix is drawing (works for text subtitles only).
    const box = document.querySelector('.player-timedtext');
    return box ? box.innerText.split('\n').map((l) => cleanLine(l, false)).filter(Boolean).join('\n') : '';
  }

  // ---------- drawing ----------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Keeps Netflix from treating clicks on our elements as clicks on the video (play/pause).
  function shield(node) {
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) node.addEventListener(type, (e) => e.stopPropagation());
  }

  // On/off button on the player. It shows while the mouse moves, like Netflix's own controls.
  const toggle = el('button', 'jap-sub-toggle', '字');
  toggle.title = 'Uudam асаах / унтраах (Alt+J)';
  shield(toggle);
  toggle.addEventListener('click', () => setEnabled(!settings.enabled));
  root.append(toggle);
  let mouseMovedAt = 0;
  document.addEventListener('mousemove', () => { mouseMovedAt = Date.now(); }, true);

  function setEnabled(on) {
    settings.enabled = on;
    shownText = null;
    api.storage.local.set({ enabled: on });
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyJ') { e.preventDefault(); e.stopPropagation(); setEnabled(!settings.enabled); }
    if (e.key === 'Escape') hideLookup();
  }, true);

  function tick() {
    requestAnimationFrame(tick);
    const video = document.querySelector('video');
    if (!video || !index) {
      root.remove();
      document.documentElement.classList.remove('jap-sub-active');
      return;
    }
    const host = document.fullscreenElement || document.querySelector('.watch-video') || document.body;
    if (root.parentElement !== host) host.appendChild(root);
    toggle.classList.toggle('jap-sub-off', !settings.enabled);
    toggle.classList.toggle('jap-sub-visible', hovering || Date.now() - mouseMovedAt < 3000);
    document.documentElement.classList.toggle('jap-sub-active', settings.enabled);
    if (!settings.enabled) {
      if (shownText !== '') render('');
      return;
    }
    syncTrack();
    const text = currentText(video);
    if (text !== shownText) render(text);
  }

  // Asks the background page to split lines into words; the results land in `tokens`.
  function tokenize(lines) {
    const todo = [...new Set(lines)].filter((l) => l && !tokens.has(l) && !pending.has(l));
    if (!todo.length) return Promise.resolve();
    todo.forEach((l) => pending.add(l));
    return api.runtime.sendMessage({ type: 'tokenize', lines: todo }).then((result) => {
      todo.forEach((l, i) => { tokens.set(l, result[i]); pending.delete(l); });
      if (waitingForTokens) shownText = null;
    }, (err) => {
      todo.forEach((l) => pending.delete(l));
      console.error(`[jap-sub] tokenizer failed: ${err && err.message ? err.message : err}`);
    });
  }

  function render(text) {
    shownText = text;
    hideLookup();
    lineBox.textContent = '';
    const lines = text.split('\n').filter(Boolean);
    waitingForTokens = !lines.every((l) => tokens.has(l));
    if (waitingForTokens) { tokenize(lines); return; }
    for (const line of lines) {
      const div = el('div', 'jap-sub-line');
      const units = L.segment(tokens.get(line), index);
      for (const unit of units) div.appendChild(drawUnit(unit));
      lineBox.appendChild(div);
      logMisses([line]);
    }
  }

  function drawUnit(unit) {
    const span = el('span', unit.lookable ? 'jap-sub-word' : 'jap-sub-plain');
    if (unit.lookable && !unit.entries.length) span.classList.add('jap-sub-unknown');
    for (const r of unit.ruby) {
      if (r.rt && settings.furigana) {
        const ruby = el('ruby');
        ruby.append(r.text, el('rt', null, r.rt));
        span.appendChild(ruby);
      } else {
        span.append(r.text);
      }
    }
    if (unit.lookable) {
      // Resting on a word opens it; passing over words on the way to the popup does not.
      span.addEventListener('pointerenter', () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => showLookup(unit, span), popup ? 250 : 80);
      });
      span.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
      span.addEventListener('click', () => { clearTimeout(hoverTimer); showLookup(unit, span); });
    }
    shield(span);
    return span;
  }

  // ---------- hover: the video pauses while the mouse is on our subtitles or the popup ----------

  let hovering = false;
  let leaveTimer = null;
  let hoverTimer = null;
  const inZone = (node) => !!node && node.nodeType === 1 && (lineBox.contains(node) || (!!popup && popup.contains(node)));

  document.addEventListener('pointerover', (e) => {
    if (!inZone(e.target)) return;
    clearTimeout(leaveTimer);
    if (hovering) return;
    hovering = true;
    const video = document.querySelector('video');
    if (video && !video.paused) { video.pause(); pausedByUs = true; }
  }, true);

  document.addEventListener('pointerout', (e) => {
    if (!hovering || inZone(e.relatedTarget)) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(leaveZone, 300); // time to cross the gap between a word and its popup
  }, true);

  function leaveZone() {
    hovering = false;
    clearTimeout(hoverTimer);
    hideLookup();
    const video = document.querySelector('video');
    if (pausedByUs && video && video.paused) video.play();
    pausedByUs = false;
  }

  // A click outside closes the popup (Netflix's own click handling then does the rest).
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) hideLookup(); }, true);

  // ---------- popup: a word, or a kanji opened from it ----------

  let views = []; // what the popup shows; the last one is on screen, earlier ones are "back"
  let anchor = null;

  function showLookup(unit, span) {
    if (popup && anchor === span && views.length === 1) return;
    anchor = span;
    views = [{ unit }];
    drawPopup();
  }

  function openKanji(kanji) {
    views.push({ kanji });
    drawPopup();
  }

  function hideLookup() {
    if (popup) popup.remove();
    popup = null;
    views = [];
    anchor = null;
  }

  function drawPopup() {
    if (!popup) {
      popup = el('div', 'jap-sub-popup');
      shield(popup);
      root.append(popup);
    }
    const view = views[views.length - 1];
    popup.replaceChildren(...(views.length > 1 ? [backButton()] : []), ...(view.unit ? wordView(view.unit) : kanjiView(view.kanji)));
    popup.scrollTop = 0;
    place();
  }

  function place() {
    const a = anchor.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(innerWidth - p.width - 8, a.left + a.width / 2 - p.width / 2))}px`;
    // Above all subtitle lines (furigana included), so the popup never covers a line you may want next.
    const top = lineBox.getBoundingClientRect().top;
    popup.style.bottom = `${Math.min(innerHeight - p.height - 8, innerHeight - top + 8)}px`;
  }

  function backButton() {
    const b = el('button', 'jap-sub-back', '← буцах');
    b.addEventListener('click', () => { views.pop(); drawPopup(); });
    return b;
  }

  // Text in which every kanji we have an entry for can be clicked.
  function withKanji(text, cls) {
    const box = el('span', cls);
    for (const ch of text) {
      if (index.kanji.has(ch)) {
        const k = el('span', 'jap-sub-k', ch);
        k.addEventListener('click', () => openKanji(index.kanji.get(ch)));
        box.append(k);
      } else {
        box.append(ch);
      }
    }
    return box;
  }

  function wordView(unit) {
    const out = [];
    const head = el('div', 'jap-sub-head');
    head.append(withKanji(unit.entries[0] ? unit.entries[0].word : unit.form, 'jap-sub-head-word'));
    if (unit.reading) head.append(el('span', 'jap-sub-head-reading', unit.reading));
    out.push(head);

    if (!unit.entries.length) out.push(...fallbackView(unit));
    for (const e of unit.entries) {
      const box = el('div', 'jap-sub-entry');
      box.append(el('div', 'jap-sub-pos', POS_MN[e.pos] || e.pos));
      const ol = el('ol', 'jap-sub-meanings');
      for (const m of e.meanings_mn) ol.append(el('li', null, m));
      box.append(ol);
      if (e.note_mn) box.append(el('div', 'jap-sub-note', e.note_mn));
      if (e.example && e.example.ja) {
        const ex = el('div', 'jap-sub-example');
        const ja = el('div', 'jap-sub-example-ja');
        ja.append(withKanji(e.example.ja));
        ex.append(ja, el('div', 'jap-sub-example-mn', e.example.mn));
        box.append(ex);
      }
      out.push(box);
    }

    const parts = unit.parts.filter((p) => p.entries.length);
    if (parts.length) {
      const box = el('div', 'jap-sub-parts');
      for (const p of parts) box.append(el('div', null, `+ ${p.surface} — ${p.entries[0].meanings_mn[0]}`));
      out.push(box);
    }

    // Kanji outside the jōyō set have no entry of ours; leave them out rather than show an empty row.
    const kanji = unit.kanji.filter((k) => k.meanings_mn.length);
    if (kanji.length) {
      const box = el('div', 'jap-sub-kanji');
      for (const k of kanji) {
        const row = el('div', 'jap-sub-kanji-row');
        row.append(el('span', 'jap-sub-kanji-char', k.kanji), el('span', null, k.meanings_mn.join(', ')));
        if (index.kanji.has(k.kanji)) {
          row.classList.add('jap-sub-clickable');
          row.addEventListener('click', () => openKanji(k));
        }
        box.append(row);
      }
      out.push(box);
    }
    return out;
  }

  // JMdict parts of speech → our labels (only the common ones; others are left out).
  function jmPos(code) {
    if (/^v/.test(code)) return POS_MN.verb;
    if (/^aux/.test(code)) return POS_MN.auxiliary;
    return { n: POS_MN.noun, 'adj-i': POS_MN['adj-i'], 'adj-na': POS_MN['adj-na'], 'adj-no': POS_MN.noun, adv: POS_MN.adverb,
      exp: POS_MN.expression, int: POS_MN.interjection, prt: POS_MN.particle, conj: POS_MN.conjunction, pn: POS_MN.pronoun,
      suf: POS_MN.suffix, 'n-suf': POS_MN.suffix, pref: POS_MN.prefix, 'n-pref': POS_MN.prefix, ctr: POS_MN.counter }[code] || '';
  }

  // No Mongolian entry yet: show JMdict's English, from the per-tab subset or (rare words) the background.
  function fallbackView(unit) {
    if (!unit.fallback.length && !unit.askedFull) {
      unit.askedFull = true;
      api.runtime.sendMessage({ type: 'jmdict', forms: [unit.form, unit.surface], reading: unit.reading }).then((found) => {
        if (!found || !found.length) return;
        unit.fallback = found;
        const view = views[views.length - 1];
        if (popup && view && view.unit === unit) drawPopup();
      }, () => {});
    }
    if (!unit.fallback.length) return [el('div', 'jap-sub-missing', 'Толь бичигт одоохондоо алга.')];
    const out = [el('div', 'jap-sub-missing', 'Монгол тайлбар одоохондоо алга. Англи тайлбар:')];
    for (const e of unit.fallback) {
      const box = el('div', 'jap-sub-entry jap-sub-english');
      if (unit.fallback.length > 1) box.append(el('div', 'jap-sub-pos', [e.k[0], e.r[0]].filter(Boolean).join(' 【') + (e.k[0] ? '】' : '')));
      const ol = el('ol', 'jap-sub-meanings');
      for (const [pos, gloss] of e.s) {
        const li = el('li');
        if (jmPos(pos)) li.append(el('span', 'jap-sub-pos-inline', jmPos(pos)), ' ');
        li.append(gloss);
        ol.append(li);
      }
      box.append(ol);
      out.push(box);
    }
    out.push(el('div', 'jap-sub-credit', 'JMdict © EDRDG · CC BY-SA 4.0'));
    return out;
  }

  function kanjiView(k) {
    const out = [];
    const head = el('div', 'jap-sub-head');
    head.append(el('span', 'jap-sub-big-kanji', k.kanji), el('span', 'jap-sub-kanji-meanings', k.meanings_mn.join(', ')));
    out.push(head);
    if (k.note_mn) out.push(el('div', 'jap-sub-note', k.note_mn));
    if (k.examples && k.examples.length) {
      const box = el('div', 'jap-sub-kanji-examples');
      for (const x of k.examples) {
        const row = el('div', 'jap-sub-kanji-example');
        row.append(withKanji(x.word, 'jap-sub-kanji-example-word'), el('span', 'jap-sub-head-reading', x.reading), el('span', null, `— ${x.mn}`));
        box.append(row);
      }
      out.push(box);
    }
    return out;
  }

  // ---------- words we don't have yet ----------

  // Every line is counted once per page load, whether it came from the whole track or from the screen.
  const seenLines = new Set();
  let misses = {};
  let saveTimer = null;
  const missesReady = api.storage.local.get({ misses: {} }).then((s) => { misses = s.misses; });

  api.storage.onChanged.addListener((changes) => { if (changes.misses) misses = changes.misses.newValue || {}; });

  // People's names can't be dictionary entries; place and organisation names (東大) can.
  const isMiss = (u) => u.lookable && !u.entries.length && LOG_POS.has(u.pos) && !(u.proper && u.properKind === '人名');

  async function logMisses(lines) {
    await Promise.all([missesReady, dictReady]);
    const found = new Set();
    for (const line of lines) {
      if (seenLines.has(line) || !tokens.has(line)) continue;
      seenLines.add(line);
      for (const u of L.segment(tokens.get(line), index).filter(isMiss)) {
        const m = misses[u.form] || (misses[u.form] = { count: 0, reading: u.reading, line });
        m.count++;
        found.add(u.form);
      }
    }
    if (lines.length > 1) console.info(`[jap-sub] ${lines.length} subtitle lines, ${found.size} words not in the dictionary: ${[...found].slice(0, 30).join(' ')}`);
    if (!found.size) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.storage.local.set({ misses }), 2000);
  }

  requestAnimationFrame(tick);
})();
