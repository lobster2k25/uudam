// Copies what the hover extension shares with uudam into hover/: kuromoji and its dictionary (vendor/),
// the lookup logic (src/lookup.js → vendor/lookup.js), our Mongolian words and the full JMdict (data/).
// Also writes data/kanji.json for the kanji rows in the popup: English meanings, readings, strokes, grade and
// JLPT level from KANJIDIC2 © EDRDG (CC BY-SA 4.0), with the jōyō readings from uudam's data/kanji.json
// (Kanjium, CC BY-SA 4.0) where it has them. The Mongolian kanji meanings stay in dict/ (ours).
// Run `node build.js` in the uudam folder first, then here: node build.js
const fs = require('fs');
const path = require('path');

const hover = __dirname;
const uudam = path.join(hover, '..');
const need = ['vendor/kuromoji.js', 'vendor/dict', 'data/dict/parts.json', 'data/fallback-full/parts.json'];
const missing = need.filter((f) => !fs.existsSync(path.join(uudam, f)));
if (missing.length) throw new Error(`missing in uudam: ${missing.join(', ')} (run node build.js there first)`);

for (const dir of ['vendor', 'data', 'icons']) fs.rmSync(path.join(hover, dir), { recursive: true, force: true });
fs.cpSync(path.join(uudam, 'vendor'), path.join(hover, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(uudam, 'src', 'lookup.js'), path.join(hover, 'vendor', 'lookup.js'));
// Dictionary updates from GitHub releases, shared with uudam (background script + the options page box).
for (const f of ['dict-update.js', 'dict-panel.js']) fs.copyFileSync(path.join(uudam, 'src', f), path.join(hover, 'vendor', f));
fs.mkdirSync(path.join(hover, 'data'));
fs.cpSync(path.join(uudam, 'data', 'dict'), path.join(hover, 'data', 'dict'), { recursive: true });
fs.copyFileSync(path.join(uudam, 'data', 'dict-version.json'), path.join(hover, 'data', 'dict-version.json'));
fs.cpSync(path.join(uudam, 'data', 'fallback-full'), path.join(hover, 'data', 'fallback-full'), { recursive: true });
// Hover's own icon (art/icon.svg → PNGs with art/make-icons.js); uudam's icons/ holds uudam's.
fs.mkdirSync(path.join(hover, 'icons'));
for (const f of fs.readdirSync(path.join(hover, 'art')).filter((n) => /^icon-\d+\.png$/.test(n))) {
  fs.copyFileSync(path.join(hover, 'art', f), path.join(hover, 'icons', f));
}
const kanji = buildKanji();
console.log(`hover/: vendor/ (kuromoji, lookup.js), data/ (dict/, fallback-full/${kanji ? `, kanji.json with ${kanji} kanji` : ''}), icons/`);

// data/kanji.json: [{ k, en: [meaning], on: [reading], kun: [reading], s: strokes, g: grade, j: JLPT, f: frequency }].
// kun readings keep KANJIDIC2's form: い.きる = い written with the kanji, きる as okurigana.
function buildKanji() {
  const file = path.join(uudam, '..', 'mongol-dict', 'ja-mn', 'sources', 'kanjidic2.xml');
  if (!fs.existsSync(file)) {
    console.warn('kanji: mongol-dict/ja-mn/sources/kanjidic2.xml missing (run mongol-dict/ja-mn/tools/fetch-sources.sh); no kanji.json');
    return 0;
  }
  const joyoFile = path.join(uudam, 'data', 'kanji.json');
  const joyo = new Map((fs.existsSync(joyoFile) ? JSON.parse(fs.readFileSync(joyoFile, 'utf8')) : []).map((k) => [k.k, k]));
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const all = (body, re) => [...body.matchAll(re)].map((m) => unescape(m[1]));
  const one = (body, re) => { const m = body.match(re); return m ? Number(m[1]) : undefined; };
  const out = [];
  for (const [, body] of fs.readFileSync(file, 'utf8').matchAll(/<character>([\s\S]*?)<\/character>/g)) {
    const en = all(body, /<meaning>(.*?)<\/meaning>/g); // English: the meanings without m_lang
    if (!en.length) continue;
    const k = body.match(/<literal>(.*?)<\/literal>/)[1];
    const j = joyo.get(k);
    const entry = {
      k,
      en,
      on: j ? j.on.map((r) => r[0]) : all(body, /<reading r_type="ja_on">(.*?)<\/reading>/g),
      kun: j ? j.kun.map((r) => (r[1] ? `${r[0]}.${r[1]}` : r[0])) : all(body, /<reading r_type="ja_kun">(.*?)<\/reading>/g),
      s: one(body, /<stroke_count>(\d+)<\/stroke_count>/),
      g: one(body, /<grade>(\d+)<\/grade>/),
      j: one(body, /<jlpt>(\d+)<\/jlpt>/),
      f: one(body, /<freq>(\d+)<\/freq>/),
    };
    for (const key of ['g', 'j', 'f']) if (entry[key] === undefined) delete entry[key];
    out.push(entry);
  }
  fs.writeFileSync(path.join(hover, 'data', 'kanji.json'), JSON.stringify(out));
  return out.length;
}
