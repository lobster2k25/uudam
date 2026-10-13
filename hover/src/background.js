// Background work for content.js: splits the text under the mouse into words with kuromoji, finds the
// word at the mouse, and looks it up in the full JMdict (English) and our Mongolian dictionary.
// Everything is loaded once, here, so pages only carry the small content script.
const api = globalThis.browser || globalThis.chrome;
const L = globalThis.JapSubLookup;

const load = async (file) => (await fetch(api.runtime.getURL(file))).json();

const tokenizer = new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: api.runtime.getURL('vendor/dict/') })
    .build((err, t) => (err ? reject(err) : resolve(t)));
});

// Our Mongolian words + all of JMdict (the "fallback" layer in uudam, the main one here).
const index = Promise.all([
  load('data/dict.json'),
  load('data/fallback-full/parts.json')
    .then((parts) => Promise.all([...Array(parts).keys()].map((i) => load(`data/fallback-full/${i}.json`))))
    .then((lists) => lists.flat()),
]).then(([dict, jmdict]) => L.buildIndex(dict, jmdict));

// All the words in a stretch of page text (one sentence): [{ start, end, surface, form, reading, english,
// mongolian, parts }]. The page keeps them, so moving the mouse along the sentence needs no new lookup.
async function words(text) {
  const [t, idx] = await Promise.all([tokenizer, index]);
  const tokens = t.tokenize(text);
  const out = [];
  let start = 0;
  for (const unit of L.segment(tokens, idx)) {
    const end = start + unit.surface.length;
    if (unit.lookable && text.slice(start, end) === unit.surface) {
      // English for every word, not only those without a Mongolian entry (as in uudam).
      let english = L.rankFallback(idx.fallback.get(unit.form) || idx.fallback.get(unit.surface) || [], unit.reading);
      // A phrase only our dictionary has (いい天気): English for its main word (天気).
      if (!english.length) english = englishInside(tokens, start, end, idx);
      out.push({
        start,
        end,
        surface: unit.surface,
        form: unit.entries[0] ? unit.entries[0].word : unit.form,
        reading: unit.reading,
        english,
        mongolian: unit.entries.map((e) => e.meanings_mn),
        parts: unit.parts.map((p) => p.surface),
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

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'hover-words') return undefined;
  words(msg.text).then(sendResponse, (err) => {
    console.error(`[uudam-hover] ${err && err.message ? err.message : err}`);
    sendResponse(null);
  });
  return true; // answers later (works in Firefox and Chrome alike)
});
