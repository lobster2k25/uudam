// Builds data/fallback.json: English glosses from JMdict (© EDRDG, CC BY-SA 4.0) for words our own
// Mongolian dictionary doesn't have yet. It is a separate layer on purpose: nothing here goes into
// mongol-dict/ja-mn, and our entries are never written from it.
// data/fallback.json (loaded in every Netflix tab) keeps entries whose words appear in the subtitle frequency
// list or carry JMdict's "common" marks; data/fallback-full/ (background script, asked on demand) has all.
// Needs ../mongol-dict/ja-mn/sources/JMdict_e and word-freq.json (mongol-dict/ja-mn/tools/fetch-sources.sh, build-freq.js).
const fs = require('fs');
const path = require('path');

const MAX_SENSES = 4;
const MAX_GLOSSES = 4;
const COMMON = new Set(['news1', 'news2', 'ichi1', 'ichi2', 'spec1', 'spec2', 'gai1', 'gai2']);

function buildFallback(ext) {
  const sources = path.join(ext, '..', 'mongol-dict', 'ja-mn', 'sources');
  const jmdict = path.join(sources, 'JMdict_e');
  if (!fs.existsSync(jmdict)) {
    console.warn('fallback: sources/JMdict_e missing (run mongol-dict/ja-mn/tools/fetch-sources.sh); skipped');
    return;
  }
  const freq = new Set(JSON.parse(fs.readFileSync(path.join(sources, 'word-freq.json'), 'utf8')).map((e) => e.word));
  const xml = fs.readFileSync(jmdict, 'utf8');
  const all = (block, tag) => [...block.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);

  const out = [];
  const full = [];
  let start = xml.indexOf('<entry>');
  while (start >= 0) {
    const end = xml.indexOf('</entry>', start);
    const block = xml.slice(start, end);
    start = xml.indexOf('<entry>', end);

    const k = all(block, 'keb');
    const r = all(block, 'reb');
    const common = [...all(block, 'ke_pri'), ...all(block, 're_pri')].some((p) => COMMON.has(p));
    const frequent = common || k.some((w) => freq.has(w)) || (k.length === 0 && r.some((w) => freq.has(w)));

    const senses = [];
    let pos = [];
    let kana = k.length === 0;
    for (const s of block.split('<sense>').slice(1)) {
      const p = [...s.matchAll(/<pos>&([^;]+);<\/pos>/g)].map((m) => m[1]);
      if (p.length) pos = p; // a sense without <pos> keeps the previous sense's
      if (/<misc>&uk;<\/misc>/.test(s)) kana = true;
      const glosses = all(s, 'gloss').slice(0, MAX_GLOSSES);
      if (glosses.length && senses.length < MAX_SENSES) senses.push([pos[0] || '', glosses.join('; ')]);
    }
    if (!senses.length) continue;
    // k: kanji forms, r: readings, u: usually written in kana (so readings are lookup forms too), c: common.
    const e = { k, r, s: senses };
    if (kana) e.u = 1;
    if (common) e.c = 1;
    full.push(e);
    if (frequent) out.push(e);
  }
  fs.writeFileSync(path.join(ext, 'data', 'fallback.json'), JSON.stringify(out));
  // The full set is split into files under 5 MB (Mozilla's linter won't check bigger ones).
  const dir = path.join(ext, 'data', 'fallback-full');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const PART = 30000;
  const parts = Math.ceil(full.length / PART);
  for (let i = 0; i < parts; i++) fs.writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(full.slice(i * PART, (i + 1) * PART)));
  fs.writeFileSync(path.join(dir, 'parts.json'), JSON.stringify(parts));
  fs.rmSync(path.join(ext, 'data', 'fallback-full.json'), { force: true });
  console.log(`data/fallback.json: ${out.length} JMdict entries; data/fallback-full/: ${full.length} in ${parts} parts`);
}

module.exports = buildFallback;
if (require.main === module) buildFallback(__dirname);
