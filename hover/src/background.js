// Background work for content.js: splits the text under the mouse into words with kuromoji, finds the
// word at the mouse, and looks it up in the full JMdict (English) and our Mongolian dictionary, with its kanji.
// Also saves words to Anki (src/anki.js) when the popup's Anki button is pressed.
// Everything is loaded once, here, so pages only carry the small content script.
const api = globalThis.browser || globalThis.chrome;
const L = globalThis.JapSubLookup;

const load = async (file) => (await fetch(api.runtime.getURL(file))).json();

const tokenizer = new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: api.runtime.getURL('vendor/dict/') })
    .build((err, t) => (err ? reject(err) : resolve(t)));
});

// Our Mongolian words + all of JMdict (the "fallback" layer in uudam, the main one here). The Mongolian part is
// a newer downloaded dictionary when there is one (vendor/dict-update.js), else the built-in data/dict/ (lookup.js loadDict).
const U = globalThis.UudamDictUpdate;
const bundledVersion = () => load('data/dict-version.json').then((v) => v.version, () => '0');
const jmdict = load('data/fallback-full/parts.json')
  .then((parts) => Promise.all([...Array(parts).keys()].map((i) => load(`data/fallback-full/${i}.json`))))
  .then((lists) => lists.flat());
const ourDict = () => bundledVersion().then((v) => U.savedIfNewer(v)).catch(() => null)
  .then((d) => d || L.loadDict(load));
let index = Promise.all([ourDict(), jmdict]).then(([dict, jm]) => L.buildIndex(dict, jm));

async function dictInfo() {
  const bundled = await bundledVersion();
  const got = await U.savedIfNewer(bundled);
  const s = await api.storage.local.get({ dictAuto: false, dictCheckedAt: 0 });
  return { version: got ? got.version : bundled, bundled, updated: !!got, auto: s.dictAuto, checkedAt: s.dictCheckedAt };
}

// After a download, the next lookup uses the new words (pages keep words they already looked up).
async function dictUpdate(daily) {
  const v = await bundledVersion();
  const res = await (daily ? U.daily(api, v) : U.update(api, v));
  if (res && res.status === 'updated') {
    const next = Promise.all([ourDict(), jmdict]).then(([dict, jm]) => L.buildIndex(dict, jm));
    await next;
    index = next;
  }
  return res;
}
dictUpdate(true).catch((err) => console.warn(`[uudam-hover] dictionary update failed: ${err && err.message ? err.message : err}`));
// GitHub access just granted on the options page: check right away.
api.permissions.onAdded.addListener((p) => {
  if ((p.origins || []).some((o) => U.ORIGINS.includes(o))) {
    dictUpdate(false).catch((err) => console.warn(`[uudam-hover] dictionary update failed: ${err.message}`));
  }
});

// Kanji for the popup's kanji rows: KANJIDIC2 (English, readings, strokes; see build.js) by character.
// Also in the shape lookup.js kanjiReadings() wants, to tell which reading the kanji has in a word.
const kanjidic = load('data/kanji.json').then((list) => {
  const byChar = new Map(list.map((k) => [k.k, k]));
  const readings = new Map(list.map((k) => [k.k, { on: k.on.map((r) => [r]), kun: k.kun.map((r) => r.split('.')) }]));
  return { byChar, readings };
}, () => ({ byChar: new Map(), readings: new Map() }));
const KANJI = /[㐀-鿿豈-﫿]/;

// The kanji of a word: [{ k, mn, origin, en, on, kun, s, g, j, used: { r, kind } }], used = its reading in this word.
function kanjiOf(form, ruby, idx, kd) {
  const used = L.kanjiReadings(ruby, kd.readings);
  return [...new Set([...form].filter((c) => KANJI.test(c)))].map((c) => {
    const ours = idx.kanji.get(c);
    const k = kd.byChar.get(c) || { en: [], on: [], kun: [] };
    return {
      k: c,
      mn: ours ? ours.meanings_mn : [],
      origin: ours && ours.origin_mn ? ours.origin_mn : '',
      en: k.en, on: k.on, kun: k.kun, s: k.s, g: k.g, j: k.j,
      used: used.get(c) || null,
    };
  });
}

// All the words in a stretch of page text (one sentence): [{ start, end, surface, form, reading, english,
// mongolian, parts }]. The page keeps them, so moving the mouse along the sentence needs no new lookup.
async function words(text) {
  const [t, idx, kd] = await Promise.all([tokenizer, index, kanjidic]);
  const tokens = t.tokenize(text);
  const out = [];
  let start = 0;
  for (const unit of L.attachGrammar(L.segment(tokens, idx), idx)) {
    const end = start + unit.surface.length;
    if (unit.lookable && text.slice(start, end) === unit.surface) {
      // English for every word, not only those without a Mongolian entry (as in uudam).
      let english = L.rankFallback(idx.fallback.get(unit.form) || idx.fallback.get(unit.surface) || [], unit.reading);
      // A phrase only our dictionary has (いい天気): English for its main word (天気).
      if (!english.length) english = englishInside(tokens, start, end, idx);
      const form = unit.entries[0] ? unit.entries[0].word : unit.form;
      const furigana = L.furigana(form, unit.reading);
      out.push({
        start,
        end,
        surface: unit.surface,
        form,
        reading: unit.reading,
        english,
        mongolian: unit.entries.map((e) => e.meanings_mn),
        parts: unit.parts.map((p) => p.surface),
        furigana,
        kanji: kanjiOf(form, furigana, idx, kd),
        // A long word in dictionary words before its kanji: 車椅子 → 車 + 椅子.
        split: L.splitWord(form, idx, unit.reading),
        // Grammar patterns of the sentence that this word is part of (〜てしまう in 食べてしまった).
        grammar: unit.grammar.map((g) => ({
          pattern: g.pattern, level: g.level, meanings: g.meanings_mn, attach: g.attach_mn, note: g.note_mn, example: g.examples[0] || null,
        })),
      });
    }
    start = end;
  }
  return out;
}

// The first token inside start..end that JMdict knows (いい天気 → 天気 when いい has no entry of its own).
function englishInside(tokens, start, end, idx) {
  let at = 0;
  let best = [];
  for (const t of tokens) {
    const from = at;
    at += t.surface_form.length;
    if (from < start || at > end) continue;
    const reading = t.reading && t.reading !== '*' ? L.toHiragana(t.reading) : null;
    const base = t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;
    const found = L.rankFallback(idx.fallback.get(base) || idx.fallback.get(t.surface_form) || [], reading);
    // Prefer a token with kanji: the content word, not a particle or いい.
    if (found.length && (!best.length || /[㐀-鿿]/.test(t.surface_form))) best = found;
    if (best.length && /[㐀-鿿]/.test(t.surface_form)) break;
  }
  return best;
}

// ---------- Anki ----------

const ankiSettings = async () => (await api.storage.local.get('anki')).anki || null;

// { state: 'off' } (not set up), { state: 'new' }, { state: 'saved' } (already in the deck) or { state: 'error', error }.
async function ankiCheck(word) {
  const settings = await ankiSettings();
  if (!UudamAnki.ready(settings)) return { state: 'off' };
  const [ok] = await UudamAnki.invoke('canAddNotes', { notes: [UudamAnki.note(settings, word)] });
  return { state: ok ? 'new' : 'saved' };
}

async function ankiAdd(word) {
  const settings = await ankiSettings();
  if (!UudamAnki.ready(settings)) return { state: 'off' };
  await UudamAnki.invoke('addNote', { note: UudamAnki.note(settings, word) });
  return { state: 'saved' };
}

const HANDLERS = {
  'hover-words': (msg) => words(msg.text),
  'anki-check': (msg) => ankiCheck(msg.word).catch((e) => ({ state: 'error', error: e.message })),
  'anki-add': (msg) => ankiAdd(msg.word).catch((e) => ({ state: 'error', error: e.message })),
  'anki-options': () => api.runtime.openOptionsPage(),
  'dict-info': () => dictInfo(),
  'dict-update': () => dictUpdate(false).catch((e) => ({ status: 'error', error: e.message })),
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return undefined;
  Promise.resolve(handler(msg)).then(sendResponse, (err) => {
    console.error(`[uudam-hover] ${err && err.message ? err.message : err}`);
    sendResponse(null);
  });
  return true; // answers later (works in Firefox and Chrome alike)
});
