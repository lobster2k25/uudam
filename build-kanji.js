// Builds data/kanji.json: for each of our kanji, the jōyō on/kun readings, how the character was formed,
// its parts (radical, phonetic part), the other kanji that share its phonetic part, and its stroke paths.
// A separate layer, like build-fallback.js: the facts come from KanjiVG © Ulrich Apel (CC BY-SA 3.0) and
// Kanjium © Uros Ozvatic (CC BY-SA 4.0); nothing here goes into mongol-dict/ja-mn. The Mongolian part names come
// from our own kanji entries and mongol-dict/ja-mn/radicals.json.
// Needs ../mongol-dict/ja-mn/sources/kanjivg.xml and kanjium-kanjidict.txt (mongol-dict/ja-mn/tools/fetch-sources.sh).
const fs = require('fs');
const path = require('path');

const TYPES = { Pictograph: 'picto', Ideograph: 'ideo', 'Compound ideograph': 'compound', 'Phono-semantic compound': 'phono' };

function buildKanji(ext, kanjiList) {
  const ja = path.join(ext, '..', 'mongol-dict', 'ja-mn');
  const kvgFile = path.join(ja, 'sources', 'kanjivg.xml');
  const kjmFile = path.join(ja, 'sources', 'kanjium-kanjidict.txt');
  if (!fs.existsSync(kvgFile) || !fs.existsSync(kjmFile)) {
    console.warn('kanji: sources/kanjivg.xml or kanjium-kanjidict.txt missing (run mongol-dict/ja-mn/tools/fetch-sources.sh); skipped');
    return;
  }
  const ours = new Map(kanjiList.map((k) => [k.kanji, k]));
  const radFile = path.join(ja, 'radicals.json');
  const radicals = new Map((fs.existsSync(radFile) ? JSON.parse(fs.readFileSync(radFile, 'utf8')) : []).map((r) => [r.radical, r.name_mn]));

  // Kanjium: kanji radical radvar phonetic idc type reg_on reg_kun …
  const kjm = new Map();
  for (const line of fs.readFileSync(kjmFile, 'utf8').split('\n')) {
    const [kanji, radical, radvar, phonetic, , type, regOn, regKun] = line.split('\t');
    if (kanji) kjm.set(kanji, { radical, radvar, phonetic, type, regOn, regKun });
  }
  const list = (s) => (s || '').split('、').map((x) => x.trim()).filter(Boolean);
  // "ショウ*" → ["ショウ", 1]: the asterisk marks the rarer jōyō readings.
  const on = (s) => list(s).map((r) => (r.endsWith('*') ? [r.slice(0, -1), 1] : [r]));
  // "い（きる）" → ["い", "きる"]: the part written with the kanji, then the okurigana.
  const kun = (s) => list(s).map((r) => {
    const rare = r.endsWith('*');
    const m = r.replace(/\*$/, '').match(/^([^（]*)(?:（([^）]*)）)?$/);
    const out = [m[1], m[2] || ''];
    return rare ? [...out, 1] : out;
  });

  const xml = fs.readFileSync(kvgFile, 'utf8');
  const missing = new Map();
  const nameOf = (c, original) => {
    // The original form first: 阝 is 阜 (hill) on the left but 邑 (village) on the right.
    for (const x of [original, c]) {
      if (x && ours.has(x)) return ours.get(x).meanings_mn[0];
      if (x && radicals.has(x)) return radicals.get(x);
    }
    return '';
  };

  const out = [];
  for (const k of ours.keys()) {
    const id = `kvg:kanji_${k.codePointAt(0).toString(16).padStart(5, '0')}`;
    const start = xml.indexOf(`<kanji id="${id}">`);
    if (start < 0) { console.warn(`kanji: ${k} not in KanjiVG`); continue; }
    const block = xml.slice(start, xml.indexOf('</kanji>', start));

    // Parse the group tree: the top group is the kanji itself; its named children are the parts.
    const rootNode = { attrs: {}, kids: [] };
    const stack = [rootNode];
    const d = [];
    for (const m of block.matchAll(/<g\b([^>]*)>|<\/g>|<path\b([^>]*)\/>/g)) {
      if (m[0] === '</g>') { stack.pop(); continue; }
      if (m[2] !== undefined) { d.push(m[2].match(/\bd="([^"]+)"/)[1]); continue; }
      const node = { attrs: Object.fromEntries([...m[1].matchAll(/kvg:(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])), kids: [] };
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    }
    const top = rootNode.kids[0];
    const parts = [];
    // Groups without an element name only position other groups; their named children count instead.
    const collect = (node) => {
      for (const g of node.kids) {
        if (!g.attrs.element) { collect(g); continue; }
        const c = g.attrs.element;
        const role = g.attrs.phon ? 'phon' : g.attrs.radical ? 'rad' : '';
        const mn = nameOf(c, g.attrs.original);
        if (!mn && !ours.has(c)) missing.set(c, (missing.get(c) || 0) + 1);
        parts.push({ c, role, mn });
      }
    };
    if (top) collect(top);

    const info = kjm.get(k) || {};
    const e = { k, n: d.length, on: on(info.regOn), kun: kun(info.regKun), type: TYPES[info.type] || '', parts, d };
    if (info.phonetic) e.phon = info.phonetic;
    out.push(e);
  }

  // Kanji sharing a phonetic part: 青 → 清 晴 精 静 請 情 (each with its first on reading).
  const byPhon = new Map();
  for (const e of out) if (e.phon) (byPhon.get(e.phon) || byPhon.set(e.phon, []).get(e.phon)).push(e);
  const outBy = new Map(out.map((e) => [e.k, e]));
  for (const [p, fam] of byPhon) if (outBy.has(p) && !fam.includes(outBy.get(p))) fam.unshift(outBy.get(p)); // 毎 heads 海 悔
  for (const e of out) {
    const fam = e.phon ? byPhon.get(e.phon) : [];
    if (fam.length >= 2) e.fam = fam.map((x) => [x.k, x.on[0] ? x.on[0][0] : '']);
  }

  fs.writeFileSync(path.join(ext, 'data', 'kanji.json'), JSON.stringify(out));
  const size = fs.statSync(path.join(ext, 'data', 'kanji.json')).size;
  console.log(`data/kanji.json: ${out.length} kanji (${(size / 1e6).toFixed(1)} MB), ${out.filter((e) => !e.on.length && !e.kun.length).length} without readings`);
  if (missing.size) {
    console.log(`kanji: ${missing.size} part shapes without a Mongolian name (shown bare): ` +
      [...missing].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([c, n]) => `${c}${n}`).join(' '));
  }
}

module.exports = buildKanji;
if (require.main === module) {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'dict.json'), 'utf8'));
  buildKanji(__dirname, dict.kanji);
}
