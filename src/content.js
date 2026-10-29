// Draws our own Japanese subtitle line over the Netflix or YouTube player: furigana, clickable words, and a
// popup with the Mongolian meaning and kanji breakdown. Subtitles come from the track that inject.js
// finds or catches; if there is none, we read the text the player itself is showing.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  const L = globalThis.JapSubLookup;
  // A request to background.js, which answers { value } or { error }.
  const ask = (msg) => api.runtime.sendMessage(msg).then((r) => {
    if (!r || 'error' in r) throw new Error(r ? r.error : 'no answer from the background script');
    return r.value;
  });
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
  // The subtitle track in use. `at`: when it arrived; `duration`: the video's length while it played, so
  // another title playing (a different length) is noticed even if the address bar does not change.
  let loaded = { key: null, cues: [] };
  let next = null; // a file caught while this title already had one: usually the next episode's, fetched early
  let requested = null;
  let drawing = false; // whether we draw the line now (the player's own subtitles are hidden only then)
  let ytTracks = null; // { videoId, tracks } from inject.js on YouTube
  const ytAsked = new Set(); // videos whose Japanese captions we already turned on

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
    // A newer dictionary the background script downloaded (dict-update.js), else the built-in one.
    const dict = ask({ type: 'dict' }).catch(() => null).then((d) => d || L.loadDict(load));
    const [dictData, fallback] = await Promise.all([dict, load('data/fallback.json').catch(() => [])]);
    index = L.buildIndex(dictData, fallback);
    shownText = null;
  })().catch((err) => console.error(`[jap-sub] failed to load dictionary: ${err && err.message ? err.message : err}`));

  // ---------- subtitle tracks ----------

  window.addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || !e.data.startsWith(TAG)) return;
    const msg = JSON.parse(e.data.slice(TAG.length));
    if (msg.type === 'tracks') tracks.set(msg.movieId, msg.tracks);
    if (msg.type === 'yt-tracks') ytTracks = msg;
    if (msg.type === 'subs' && msg.key === requested) {
      if (msg.error) console.warn(`[jap-sub] subtitle download failed: ${msg.error}`);
      else useSubs(msg.key, msg.text, 'from the track list');
    }
    // Netflix's own player downloaded a Japanese subtitle file (inject.js watches its requests).
    // A YouTube file for a video the viewer already left (it came late) is dropped.
    if (msg.type === 'captured' && msg.videoId && currentMovie() && msg.videoId !== currentMovie()) return;
    if (msg.type === 'captured' && !(loaded.key && loaded.key.endsWith(':list'))) takeCaptured(msg.text);
  });

  function parseSubs(text, cc) {
    const start = text.trimStart();
    const cues = start.startsWith('{') ? parseJson3(text) : start.startsWith('<') ? parseTtml(text, cc) : parseVtt(text, cc);
    if (!cues.length) console.warn(`[jap-sub] could not read the subtitle file; it starts: ${text.slice(0, 200)}`);
    return cues;
  }

  function takeCaptured(text) {
    const cues = parseSubs(text, false);
    if (!cues.length) return;
    const key = `${currentMovie() || 'any'}:captured`;
    // This title already has its file and the new one is a different script: Netflix fetched the next
    // episode early. Keep it for when that episode starts. (Same lines = the viewer switched to/from CC.)
    if (loaded.key === key && !loaded.provisional && !otherTitle(findVideo()) && !sameScript(loaded.cues, cues)) {
      next = { cues, at: Date.now() };
      console.info(`[jap-sub] caught another title's subtitle file (${cues.length} cues, probably the next episode); kept for when it starts`);
      return;
    }
    useCues(key, cues, 'caught from the player');
  }

  // Whether two files share many lines (Japanese characters only), i.e. are the same episode.
  function sameScript(a, b) {
    const lines = (cues) => new Set(cues.flatMap((c) => c.text.split('\n')).map((l) => l.replace(/[^぀-ヿ㐀-鿿]/g, '')).filter((l) => l.length >= 4));
    const x = lines(a);
    const y = lines(b);
    let common = 0;
    for (const l of x) if (y.has(l)) common++;
    return common / Math.max(1, Math.min(x.size, y.size)) > 0.3;
  }

  function useSubs(key, text, how) {
    const cues = parseSubs(text, key.includes('#cc'));
    if (cues.length) useCues(key, cues, how);
  }

  function useCues(key, cues, how) {
    console.info(`[jap-sub] Japanese subtitles loaded (${how}): ${cues.length} cues`);
    loaded = { key, cues, at: Date.now(), duration: null, provisional: false };
    // The whole track in one go, and every word we lack in it goes to the missing-word list.
    const lines = cues.flatMap((c) => c.text.split('\n'));
    tokenize(lines).then(() => logMisses(lines));
  }

  // Netflix /watch/123; YouTube /watch?v=abc, /shorts/abc, /embed/abc.
  const currentMovie = () => (location.pathname.match(/\/watch\/(\d+)/) || [])[1]
    || (location.pathname === '/watch' && new URLSearchParams(location.search).get('v'))
    || (location.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/) || [])[1];
  // The main video: on YouTube the page can hold other (preview) videos too.
  const findVideo = () => document.querySelector('#movie_player video') || document.querySelector('video');

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

  // True when the video is plainly not the one the loaded file was used with (its length differs).
  function otherTitle(video) {
    const d = video && video.duration;
    if (!loaded.cues.length || !Number.isFinite(d) || d <= 0) return false;
    if (loaded.duration == null) { loaded.duration = d; return false; }
    return Math.abs(d - loaded.duration) > 2;
  }

  // Another title started (new /watch id, or a video of another length): the loaded file must not follow it.
  function titleChanged(id, video) {
    const switched = !loaded.key.startsWith(`${id}:`);
    if (!switched && !otherTitle(video)) return;
    const key = `${id}:captured`;
    if (next && id !== 'any') {
      loaded = { key, cues: next.cues, at: Date.now(), duration: null, provisional: true };
      console.info(`[jap-sub] another title started; using the subtitle file caught for it earlier (${next.cues.length} cues)`);
    } else if (Date.now() - loaded.at < 15000) {
      // Caught just before the switch, so it belongs to the new title.
      loaded = { ...loaded, key, duration: null, provisional: true };
    } else if (switched) {
      console.info('[jap-sub] another title started; dropped the previous title\'s subtitles');
      loaded = { key: null, cues: [] };
    } else {
      return; // same address, other length (an ad?): the file is only set aside, see currentText()
    }
    next = null;
  }

  // YouTube: its caption files can only be fetched by its own player, so we switch the player to the
  // Japanese track (the uploader's if there is one, else the automatic one) and inject.js catches the file.
  function syncYouTube(id) {
    if (!ytTracks || ytTracks.videoId !== id || ytAsked.has(id) || (loaded.key && loaded.key.startsWith(`${id}:`))) return;
    const ja = ytTracks.tracks.filter((t) => /^ja/.test(t.language));
    const t = ja.find((x) => x.kind !== 'asr') || ja[0];
    ytAsked.add(id);
    if (!t) { console.info(`[jap-sub] this YouTube video has no Japanese captions (${id})`); return; }
    window.postMessage(TAG + JSON.stringify({ type: 'yt-show', language: t.language, kind: t.kind }), '*');
  }

  function syncTrack(video) {
    const id = currentMovie() || 'any';
    syncYouTube(id);
    if (loaded.key && loaded.key.endsWith(':captured')) titleChanged(id, video);
    if (id === 'any') next = null;
    const t = wantedTrack();
    if (!t) {
      if (loaded.key && !loaded.key.startsWith(`${id}:`)) loaded = { key: null, cues: [] };
      if (!loaded.cues.length && currentMovie() && Date.now() - pageStart > 15000) {
        warnOnce(`none:${id}`, `no Japanese subtitle file seen for ${id}: turn the player's Japanese subtitles on and reload the page. Reading on-screen subtitles until then`);
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
    s = s.trim();
    // A line of only punctuation (a lone 。 left from the line before, or from a dropped label) says nothing.
    return /^[\s。、．，.,!?！？…‥・「」『』―ー〜~\-]*$/.test(s) ? '' : s;
  }

  // YouTube's caption file (json3): events with a start, a length and text pieces. Automatic captions
  // come as overlapping two-line windows; each event is drawn as its own line, as YouTube does.
  function parseJson3(text) {
    let events;
    try { events = JSON.parse(text).events || []; } catch { return []; }
    const cues = [];
    for (const e of events) {
      const body = (e.segs || []).map((g) => g.utf8 || '').join('').split('\n').map((l) => cleanLine(l, false)).filter(Boolean).join('\n');
      if (body) cues.push({ start: (e.tStartMs || 0) / 1000, end: ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000, text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
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
    if (loaded.cues.length && !otherTitle(video)) {
      drawing = true;
      const t = video.currentTime;
      return loaded.cues.filter((c) => c.start <= t && t < c.end).map((c) => c.text).join('\n');
    }
    // No subtitle file: fall back to whatever the player is drawing (works for text subtitles only), but
    // only Japanese; anything else stays the player's own.
    const box = document.querySelector('.player-timedtext, .ytp-caption-window-container');
    const text = box ? box.innerText.split('\n').map((l) => cleanLine(l, false)).filter(Boolean).join('\n') : '';
    drawing = /[぀-ヿ㐀-鿿]/.test(text);
    return drawing ? text : '';
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
    const video = findVideo();
    if (!video || !index) {
      root.remove();
      document.documentElement.classList.remove('jap-sub-active');
      return;
    }
    const host = document.fullscreenElement || document.querySelector('.watch-video') || document.body;
    if (root.parentElement !== host) host.appendChild(root);
    placeOverPlayer(video);
    toggle.classList.toggle('jap-sub-off', !settings.enabled);
    toggle.classList.toggle('jap-sub-visible', hovering || Date.now() - mouseMovedAt < 3000);
    if (!settings.enabled) {
      document.documentElement.classList.remove('jap-sub-active');
      if (shownText !== '') render('');
      return;
    }
    syncTrack(video);
    const text = currentText(video);
    document.documentElement.classList.toggle('jap-sub-active', drawing);
    if (text !== shownText) render(text);
  }

  // On YouTube the video often does not fill the window: keep our line and button over the player.
  // (Netflix's player always fills it, so the stylesheet's places are used there.)
  function placeOverPlayer(video) {
    const player = video.closest('#movie_player');
    const r = player && player.getBoundingClientRect();
    if (!r || !r.width || (r.width >= innerWidth - 2 && r.height >= innerHeight - 2)) {
      if (lineBox.style.left) { lineBox.removeAttribute('style'); toggle.removeAttribute('style'); }
      return;
    }
    Object.assign(lineBox.style, {
      left: `${r.left + r.width / 2}px`,
      bottom: `${innerHeight - r.bottom + r.height * 0.12}px`,
      maxWidth: `${r.width * 0.9}px`,
      fontSize: `${Math.max(16, Math.min(44, r.width * 0.035))}px`,
    });
    Object.assign(toggle.style, {
      right: `${innerWidth - r.right + r.width * 0.025}px`,
      bottom: `${innerHeight - r.bottom + r.height * 0.2}px`,
    });
  }

  // Asks the background page to split lines into words; the results land in `tokens`.
  function tokenize(lines) {
    const todo = [...new Set(lines)].filter((l) => l && !tokens.has(l) && !pending.has(l));
    if (!todo.length) return Promise.resolve();
    todo.forEach((l) => pending.add(l));
    return ask({ type: 'tokenize', lines: todo }).then((result) => {
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
      const units = L.attachGrammar(L.segment(tokens.get(line), index), index);
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
    // Outside our elements. This also catches leaving without a pointerout, as when the popup redraws
    // smaller (← буцах) and the element under the pointer is gone.
    if (!inZone(e.target)) {
      if (hovering && !leaveTimer) leaveTimer = setTimeout(leaveZone, 300);
      return;
    }
    clearTimeout(leaveTimer);
    leaveTimer = null;
    if (hovering) return;
    hovering = true;
    const video = findVideo();
    if (video && !video.paused) { video.pause(); pausedByUs = true; }
  }, true);

  document.addEventListener('pointerout', (e) => {
    if (!hovering || inZone(e.relatedTarget)) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(leaveZone, 300); // time to cross the gap between a word and its popup
  }, true);

  function leaveZone() {
    leaveTimer = null;
    hovering = false;
    clearTimeout(hoverTimer);
    hideLookup();
    const video = findVideo();
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
    const headWord = unit.entries[0] ? unit.entries[0].word : unit.form;
    head.append(withKanji(headWord, 'jap-sub-head-word'));
    if (unit.reading) head.append(el('span', 'jap-sub-head-reading', unit.reading));
    const say = speakButton(headWord, 'Үгийг сонсох');
    if (say) head.append(say);
    const again = replayButton();
    if (again) head.append(again);
    out.push(head);

    if (!unit.entries.length) out.push(...fallbackView(unit));
    for (const e of unit.entries) {
      const box = el('div', 'jap-sub-entry');
      box.append(el('div', 'jap-sub-pos', POS_MN[e.pos] || e.pos));
      const ol = el('ol', 'jap-sub-meanings');
      for (const m of e.meanings_mn) ol.append(el('li', null, m));
      box.append(ol);
      if (e.note_mn) box.append(el('div', 'jap-sub-note', e.note_mn));
      for (const x of e.examples || []) box.append(exampleView(x));
      out.push(box);
    }

    // The bent form in one line: 食べ + られ + なかっ + た = идэвхгүй / чадах · үгүйсгэл · өнгөрсөн цаг.
    const notes = L.formNotes(unit.parts);
    const parts = unit.parts.filter((p) => p.entries.length);
    if (notes.length) {
      const box = el('div', 'jap-sub-form');
      const stem = unit.surface.slice(0, unit.surface.length - unit.parts.map((p) => p.surface).join('').length);
      box.append(el('span', 'jap-sub-form-label', 'Хэлбэр'), el('span', 'jap-sub-form-parts', [stem, ...unit.parts.map((p) => p.surface)].join(' + ')),
        el('span', 'jap-sub-form-notes', `= ${notes.join(' · ')}`));
      out.push(box);
    } else if (parts.length) {
      const box = el('div', 'jap-sub-parts');
      for (const p of parts) box.append(el('div', null, `+ ${p.surface} — ${p.entries[0].meanings_mn[0]}`));
      out.push(box);
    }

    // Grammar patterns this word is part of in the line (〜てしまう in 食べてしまった).
    if (unit.grammar && unit.grammar.length) {
      const box = el('div', 'jap-sub-grammar');
      box.append(el('div', 'jap-sub-section', 'Дүрэм'));
      for (const g of unit.grammar) {
        const item = el('div', 'jap-sub-grammar-item');
        const title = el('div', 'jap-sub-grammar-title');
        title.append(el('span', 'jap-sub-grammar-pattern', g.pattern), el('span', 'jap-sub-level', g.level));
        item.append(title, el('div', 'jap-sub-grammar-meaning', g.meanings_mn.join('; ')));
        if (g.attach_mn) item.append(el('div', 'jap-sub-grammar-attach', g.attach_mn));
        if (g.note_mn) item.append(el('div', 'jap-sub-note', g.note_mn));
        if (g.examples && g.examples[0]) item.append(exampleView(g.examples[0]));
        box.append(item);
      }
      out.push(box);
    }

    // A long word in dictionary words before its single kanji: 車椅子 → 車 + 椅子.
    const split = L.splitWord(headWord, index, unit.reading);
    if (split) {
      const box = el('div', 'jap-sub-split');
      box.append(el('div', 'jap-sub-section', `Бүрдэл: ${split.map((p) => p.text).join(' + ')}`));
      for (const p of split) {
        const row = el('div', 'jap-sub-split-row');
        row.append(withKanji(p.text, 'jap-sub-split-word'));
        if (p.reading) row.append(el('span', 'jap-sub-reading', p.reading));
        row.append(el('span', null, p.meaning));
        box.append(row);
      }
      out.push(box);
    }

    // Kanji outside the jōyō set have no entry of ours; leave them out rather than show an empty row.
    const kanji = unit.kanji.filter((k) => k.meanings_mn.length);
    if (kanji.length) {
      // The reading each kanji has in this word (危ない → 危 あぶ 訓), once the kanji layer has arrived.
      needKanji(kanji.map((k) => k.kanji));
      const known = new Map(kanji.map((k) => [k.kanji, kanjiInfo.get(k.kanji)]).filter(([, i]) => i));
      const used = L.kanjiReadings(unit.ruby, known);
      const box = el('div', 'jap-sub-kanji');
      for (const k of kanji) {
        const row = el('div', 'jap-sub-kanji-row');
        row.append(el('span', 'jap-sub-kanji-char', k.kanji));
        const r = used.get(k.kanji);
        if (r) {
          const tag = el('span', 'jap-sub-kanji-used');
          tag.append(el('span', 'jap-sub-reading', r.r), el('span', 'jap-sub-kanji-used-kind', r.kind === 'on' ? '音' : '訓'));
          tag.title = r.kind === 'on' ? 'Хятад дуудлага (音)' : 'Япон дуудлага (訓)';
          row.append(tag);
        }
        row.append(el('span', null, k.meanings_mn.join(', ')));
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

  function exampleView(x) {
    const ex = el('div', 'jap-sub-example');
    const ja = el('div', 'jap-sub-example-ja');
    ja.append(withKanji(x.ja));
    const say = speakButton(x.ja, 'Өгүүлбэрийг сонсох');
    if (say) ja.append(say);
    ex.append(ja, el('div', 'jap-sub-example-mn', x.mn));
    return ex;
  }

  // ---------- listening: the browser's own Japanese voice (speechSynthesis), no server ----------

  // The button only appears when the browser has a Japanese voice; without one it would read the text in English.
  let jaVoice = null;
  function findJaVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices().filter((v) => /^ja\b/i.test(v.lang));
    jaVoice = voices.find((v) => v.localService) || voices[0] || null;
  }
  if ('speechSynthesis' in window) {
    findJaVoice();
    speechSynthesis.addEventListener('voiceschanged', findJaVoice);
  }

  // ⟲ plays the subtitle line on screen again from its start (only when we have the subtitle file's timings).
  function replayButton() {
    const video = findVideo();
    if (!video || !loaded.cues.length || otherTitle(video)) return null;
    const t = video.currentTime;
    const cue = loaded.cues.filter((c) => c.start <= t && t < c.end).sort((a, b) => a.start - b.start)[0];
    if (!cue) return null;
    const b = el('button', 'jap-sub-say jap-sub-replay', '⟲');
    b.title = 'Энэ мөрийг дахин сонсох';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      hideLookup();
      // The replay plays on; leaving the subtitles afterwards must not pause or play it again.
      pausedByUs = false;
      hovering = false;
      clearTimeout(leaveTimer);
      leaveTimer = null;
      window.postMessage(TAG + JSON.stringify({ type: 'seek', time: Math.max(0, cue.start - 0.2) }), '*');
    });
    return b;
  }

  function speakButton(text, title) {
    if (!jaVoice) return null;
    const b = el('button', 'jap-sub-say', '🔊');
    b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = jaVoice;
      u.lang = jaVoice.lang;
      u.rate = 0.9;
      speechSynthesis.speak(u);
    });
    return b;
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
      ask({ type: 'jmdict', forms: [unit.form, unit.surface], reading: unit.reading }).then((found) => {
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

  // Readings, parts and strokes (KanjiVG + Kanjium) come from the background page, one kanji at a time.
  const kanjiInfo = new Map(); // kanji → info, or null when the background has none
  const KANJI_TYPES = {
    picto: ['Дүрс үсэг', 'Ямар нэг зүйлийн зургаас үүссэн.'],
    ideo: ['Тэмдэг үсэг', 'Санааг зураас, тэмдгээр илэрхийлсэн.'],
    compound: ['Нийлмэл утгат үсэг', 'Хэсгүүдийн утга нийлж шинэ утга болсон.'],
    phono: ['Утга-дуудлагын үсэг', 'Нэг хэсэг нь утгыг, нөгөө нь дуудлагыг заана.'],
    // The sources disagree on whether one part gives the sound, so we only name the parts.
    parts: ['Хэсгүүдээс бүтсэн', 'Дараах хэсгүүдээс бүтсэн ханз.'],
  };

  // Asks the background for kanji not seen yet; the popup is redrawn when they arrive.
  function needKanji(chars) {
    const todo = chars.filter((c) => !kanjiInfo.has(c));
    if (!todo.length) return;
    for (const c of todo) kanjiInfo.set(c, undefined); // asked
    const view = views[views.length - 1];
    ask({ type: 'kanji', kanji: todo }).then((list) => {
      todo.forEach((c, i) => kanjiInfo.set(c, (list && list[i]) || null));
      if (popup && views[views.length - 1] === view) drawPopup();
    }, () => todo.forEach((c) => kanjiInfo.set(c, null)));
  }

  function kanjiView(k) {
    const out = [];
    needKanji([k.kanji]);
    const info = kanjiInfo.get(k.kanji);

    const head = el('div', 'jap-sub-head jap-sub-kanji-head');
    const big = el('span', 'jap-sub-big-kanji', info ? null : k.kanji);
    if (info && info.d.length) {
      big.append(strokeSvg(info));
      big.title = 'Дахин зурах';
      big.classList.add('jap-sub-clickable');
      big.addEventListener('click', () => big.replaceChildren(strokeSvg(info)));
    } else if (info) {
      big.textContent = k.kanji;
    }
    const side = el('div', 'jap-sub-kanji-side');
    side.append(el('span', 'jap-sub-kanji-meanings', k.meanings_mn.join(', ')));
    if (info) side.append(el('span', 'jap-sub-hint', `${info.n} зураас · дарвал дахин зурна`));
    head.append(big, side);
    out.push(head);

    if (info) out.push(...readingsView(info), ...formationView(info, k));
    // Without the kanji layer, our explanation stands alone; then the learning tip, labelled so a memory
    // aid is never mistaken for history.
    if (!info && k.origin_mn) out.push(el('div', 'jap-sub-origin', k.origin_mn));
    if (k.note_mn) {
      const note = el('div', 'jap-sub-note');
      const label = { mnemonic: 'Санах арга', compare: 'Харьцуулах', usage: 'Хэрэглээ' }[k.note_kind];
      if (label) note.append(el('span', 'jap-sub-note-label', label), ' ');
      note.append(k.note_mn);
      out.push(note);
    }
    if (k.examples && k.examples.length) {
      const box = el('div', 'jap-sub-kanji-examples');
      for (const x of k.examples) {
        const row = el('div', 'jap-sub-kanji-example');
        row.append(withKanji(x.word, 'jap-sub-kanji-example-word'), el('span', 'jap-sub-head-reading', x.reading), el('span', null, `— ${x.mn}`));
        box.append(row);
      }
      out.push(box);
    }
    if (info) out.push(el('div', 'jap-sub-credit', 'KanjiVG © Ulrich Apel (CC BY-SA 3.0) · Kanjium (CC BY-SA 4.0)'));
    return out;
  }

  // The kanji drawn stroke by stroke (KanjiVG paths, 109×109), with each stroke's number at its start.
  function strokeSvg(info) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 109 109');
    svg.setAttribute('class', 'jap-sub-strokes');
    const ghost = document.createElementNS(NS, 'g');
    ghost.setAttribute('class', 'jap-sub-strokes-ghost');
    const ink = document.createElementNS(NS, 'g');
    ink.setAttribute('class', 'jap-sub-strokes-ink');
    const nums = document.createElementNS(NS, 'g');
    nums.setAttribute('class', 'jap-sub-strokes-nums');
    const step = Math.min(0.5, 6 / info.d.length); // long kanji draw faster, at most ~6 s in all
    info.d.forEach((d, i) => {
      const back = document.createElementNS(NS, 'path');
      back.setAttribute('d', d);
      ghost.append(back);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.style.animationDelay = `${i * step}s`;
      p.style.animationDuration = `${step * 0.9}s`;
      ink.append(p);
      const m = d.match(/^M\s*([-\d.]+)[,\s]+([-\d.]+)/);
      if (m) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', Math.max(2, Number(m[1]) - 6));
        t.setAttribute('y', Math.max(8, Number(m[2]) - 2));
        t.style.animationDelay = `${i * step}s`;
        t.textContent = String(i + 1);
        nums.append(t);
      }
    });
    svg.append(ghost, ink, nums);
    return svg;
  }

  // 音 (Chinese-derived) and 訓 (native Japanese) readings; okurigana in grey, rarer readings dimmed.
  function readingsView(info) {
    const box = el('div', 'jap-sub-readings');
    const row = (label, list, draw) => {
      if (!list.length) return;
      const r = el('div', 'jap-sub-reading-row');
      r.append(el('span', 'jap-sub-reading-label', label));
      const items = el('span', 'jap-sub-reading-list');
      list.forEach((x, i) => {
        if (i) items.append(el('span', 'jap-sub-reading-sep', '・'));
        const item = draw(x);
        if (x[x.length - 1] === 1) item.classList.add('jap-sub-reading-rare');
        items.append(item);
      });
      r.append(items);
      box.append(r);
    };
    row('音 Хятад', info.on, (x) => el('span', 'jap-sub-reading', x[0]));
    row('訓 Япон', info.kun, ([stem, oku]) => {
      const s = el('span', 'jap-sub-reading', stem);
      if (oku) s.append(el('span', 'jap-sub-okurigana', oku));
      return s;
    });
    return box.childNodes.length ? [box] : [];
  }

  // How the kanji was formed, its parts (氵 ус + 毎 дуудлага) and the kanji that share its phonetic part.
  function formationView(info, k) {
    const out = [];
    const type = KANJI_TYPES[info.type];
    const box = el('div', 'jap-sub-formation');
    if (type) {
      // Pictograph / ideograph / compound labels come from Kanjium alone and are sometimes wrong (原, 疑);
      // when we have our own explanation, only the label both sources agree on (meaning + sound) stays.
      if (!k.origin_mn || info.type === 'phono') box.append(el('div', 'jap-sub-formation-type', type[0]), el('div', 'jap-sub-hint', type[1]));
      // Pictographs and simple signs are not built from parts, so their KanjiVG groups (行 → 彳…) are left out.
      if ((info.type === 'compound' || info.type === 'phono' || info.type === 'parts') && info.parts.length) {
        const parts = el('div', 'jap-sub-formation-parts');
        info.parts.forEach((p, i) => {
          if (i) parts.append(el('span', 'jap-sub-plus', '+'));
          const chip = el('span', `jap-sub-part${p.role ? ` jap-sub-part-${p.role}` : ''}`);
          chip.append(el('span', 'jap-sub-part-char', p.c));
          // Only the radical's name is reliable as "the meaning here" (氵 ус). Other parts are modern shapes
          // whose own meaning is often not what they stand for (里: top 田 drawn like 日; 熊: 灬 legs, not fire);
          // the explanation below says what they are.
          const label = p.role === 'phon' ? 'дуудлага' : p.role === 'rad' ? p.mn : '';
          if (label) chip.append(el('span', 'jap-sub-part-mn', label));
          if (index.kanji.has(p.c)) {
            chip.classList.add('jap-sub-clickable');
            chip.addEventListener('click', () => openKanji(index.kanji.get(p.c)));
          }
          parts.append(chip);
        });
        box.append(parts);
      }
    }
    // Our own explanation of how the kanji was formed (mongol-dict origin_mn).
    // Its leading «Утга-дуудлагын үсэг:» is dropped when the same label is already shown above it.
    const shown = box.querySelector('.jap-sub-formation-type');
    const origin = shown ? k.origin_mn.replace(new RegExp(`^${shown.textContent}( гэж үздэг)?:\s*`), (m, hedge) => (hedge ? 'Гэж үздэг: ' : '')) : k.origin_mn;
    if (origin) box.append(el('div', 'jap-sub-origin', origin));
    if (box.childNodes.length) out.push(box);
    if (info.fam && info.fam.length > 1) {
      const box = el('div', 'jap-sub-family');
      box.append(el('div', 'jap-sub-hint', `${info.phon} хэсэгтэй, ойролцоо дуудлагатай ханз`));
      const list = el('div', 'jap-sub-family-list');
      for (const [c, on] of info.fam) {
        const item = el('span', `jap-sub-family-item${c === info.k ? ' jap-sub-family-self' : ''}`);
        item.append(el('span', 'jap-sub-family-char', c), el('span', 'jap-sub-family-on', on));
        if (c !== info.k && index.kanji.has(c)) {
          item.classList.add('jap-sub-clickable');
          item.addEventListener('click', () => openKanji(index.kanji.get(c)));
        }
        list.append(item);
      }
      box.append(list);
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
