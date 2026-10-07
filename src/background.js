// Background work for content.js, in the extension's own page:
// - splits Japanese text into words with kuromoji (Firefox content scripts can't load its dictionary);
// - looks up rare words in the full JMdict (English) when the per-tab subset has nothing.
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

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'tokenize') {
    return tokenizer.then((t) => msg.lines.map((line) => t.tokenize(line)
      .map((tok) => Object.fromEntries(FIELDS.map((f) => [f, tok[f]])))));
  }
  if (msg.type === 'jmdict') {
    return fullJmdict().then((map) => L.rankFallback(msg.forms.map((f) => map.get(f)).find(Boolean) || [], msg.reading));
  }
  return undefined;
});
