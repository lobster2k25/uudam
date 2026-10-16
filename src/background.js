// Background work for content.js, in the extension's background page (Firefox) or service worker (Chrome, see sw.js):
// - splits Japanese text into words with kuromoji (Firefox content scripts can't load its dictionary);
// - looks up rare words in the full JMdict (English) when the per-tab subset has nothing;
// - hands out one kanji's readings, parts and stroke paths (data/kanji.json, 2.4 MB, loaded on first use).
const api = globalThis.browser || globalThis.chrome;
const L = globalThis.JapSubLookup;
const FIELDS = ['surface_form', 'pos', 'pos_detail_1', 'pos_detail_2', 'basic_form', 'reading'];

const tokenizer = new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: api.runtime.getURL('vendor/dict/') })
    .build((err, t) => (err ? reject(err) : resolve(t)));
}).catch((err) => { throw new Error(`kuromoji failed to load: ${err && err.message ? err.message : err}`); });

// The full JMdict is ~23 MB, so it is only loaded the first time a rare word is looked up.
let jmdict = null;
const load = async (file) => (await fetch(api.runtime.getURL(file))).json();
const fullJmdict = () => (jmdict ||= load('data/fallback-full/parts.json')
  .then((parts) => Promise.all([...Array(parts).keys()].map((i) => load(`data/fallback-full/${i}.json`))))
  .then((lists) => L.fallbackIndex(lists.flat()))
  .catch(() => new Map()));

let kanjiData = null;
const kanjiInfo = () => (kanjiData ||= load('data/kanji.json').then((list) => new Map(list.map((e) => [e.k, e]))).catch(() => new Map()));

// Dictionary updates (dict-update.js): the built-in dictionary's version, and a newer downloaded one if there is one.
const U = globalThis.UudamDictUpdate;
const bundledVersion = () => load('data/dict-version.json').then((v) => v.version, () => '0');
const dictInfo = async () => {
  const bundled = await bundledVersion();
  const got = await U.savedIfNewer(bundled);
  const s = await api.storage.local.get({ dictAuto: false, dictCheckedAt: 0 });
  return { version: got ? got.version : bundled, bundled, updated: !!got, auto: s.dictAuto, checkedAt: s.dictCheckedAt };
};
const dailyUpdate = () => bundledVersion().then((v) => U.daily(api, v))
  .catch((err) => console.warn(`[jap-sub] dictionary update failed: ${err && err.message ? err.message : err}`));
dailyUpdate();
// GitHub access just granted from the popup (which Firefox may have closed meanwhile): check right away.
api.permissions.onAdded.addListener((p) => {
  if ((p.origins || []).some((o) => U.ORIGINS.includes(o))) {
    bundledVersion().then((v) => U.update(api, v)).catch((err) => console.warn(`[jap-sub] dictionary update failed: ${err.message}`));
  }
});

const handlers = {
  // The downloaded dictionary for content.js, or null to use the built-in data/dict.json.
  dict: () => { dailyUpdate(); return bundledVersion().then((v) => U.savedIfNewer(v)); },
  dictInfo,
  dictUpdate: () => bundledVersion().then((v) => U.update(api, v)),
  tokenize: (msg) => tokenizer.then((t) => msg.lines.map((line) => t.tokenize(line)
    .map((tok) => Object.fromEntries(FIELDS.map((f) => [f, tok[f]]))))),
  jmdict: (msg) => fullJmdict().then((map) => L.rankFallback(msg.forms.map((f) => map.get(f)).find(Boolean) || [], msg.reading)),
  // One kanji → its entry or null; a list → a list of entries/nulls in the same order.
  kanji: (msg) => kanjiInfo().then((map) => (Array.isArray(msg.kanji) ? msg.kanji.map((k) => map.get(k) || null) : map.get(msg.kanji) || null)),
};

// Answers through sendResponse, wrapped as { value } or { error } (content.js's ask() unwraps it): Chrome does
// not take a returned Promise as the answer, Firefox takes both.
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = handlers[msg.type];
  if (!handle) return undefined;
  handle(msg).then((value) => sendResponse({ value }),
    (err) => sendResponse({ error: err && err.message ? err.message : String(err) }));
  return true;
});
