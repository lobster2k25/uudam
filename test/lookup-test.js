// Checks segmentation, dictionary hits and furigana on sample subtitle lines. Run after build.js:
// node test/lookup-test.js
const path = require('path');
const assert = require('assert');
const kuromoji = require(path.join(__dirname, '..', '..', 'mongol-dict', 'node_modules', 'kuromoji'));
const L = require('../src/lookup');
const dict = require('../data/dict.json');

const index = L.buildIndex(dict);
const rubyText = (ruby) => ruby.map((r) => (r.rt ? `${r.text}(${r.rt})` : r.text)).join('');

kuromoji.builder({ dicPath: path.join(__dirname, '..', 'vendor', 'dict') }).build((err, tokenizer) => {
  if (err) throw err;
  const seg = (line) => L.segment(tokenizer.tokenize(line), index);

  for (const line of ['食べている人たちに対して、役に立つと思わなかった。', '取り戻すまで諦めない', 'テレビを見ていた', '危ない！伏せろ！']) {
    console.log(line);
    for (const u of seg(line)) {
      console.log(`  ${u.surface.padEnd(8, '　')} → ${u.form} ${u.reading || ''}  ${u.entries[0] ? u.entries[0].meanings_mn[0] : (u.lookable ? '(no entry)' : '')}  ${rubyText(u.ruby)}`);
    }
  }

  const units = seg('食べている人たちに対して、役に立つと思わなかった。');
  assert.deepStrictEqual(units.map((u) => u.surface), ['食べている', '人たち', 'に対して', '、', '役に立つ', 'と', '思わなかった', '。']);
  assert.strictEqual(units[0].form, '食べる');
  assert.strictEqual(units[6].form, '思う');
  assert.ok(units[6].parts.some((p) => p.form === 'ない'));
  assert.strictEqual(units[3].lookable, false);
  assert.strictEqual(rubyText(L.furigana('取り戻す', 'トリモドス')), '取(と)り戻(もど)す');
  assert.strictEqual(rubyText(L.furigana('見', 'ミ')), '見(み)');

  // Which reading each kanji has in a word (data/kanji.json from build-kanji.js).
  const kinfo = new Map(require('../data/kanji.json').map((e) => [e.k, e]));
  const kr = (word, reading) => [...L.kanjiReadings(L.furigana(word, reading), kinfo)].map(([k, x]) => `${k}${x.r}${x.kind === 'on' ? '音' : '訓'}`).join(' ');
  assert.strictEqual(kr('危ない', 'あぶない'), '危あぶ訓');
  assert.strictEqual(kr('学校', 'がっこう'), '学がっ音 校こう音');
  assert.strictEqual(kr('日本語', 'にほんご'), '日に音 本ほん音 語ご音');
  assert.strictEqual(kr('山道', 'やまみち'), '山やま訓 道みち訓');
  assert.strictEqual(kr('手紙', 'てがみ'), '手て訓 紙がみ訓'); // voiced: かみ → がみ
  assert.strictEqual(kr('今日', 'きょう'), ''); // read as a whole word, no split
  assert.strictEqual(rubyText(L.furigana('テレビ', 'テレビ')), 'テレビ');
  assert.ok(seg('危ない').every((u) => u.kanji.every((k) => k.meanings_mn.length)));
  // Readings of words missing from the dictionary are given in dictionary form, not as conjugated.
  const fake = { words: [], kanji: [] };
  const bare = L.buildIndex(fake);
  const readingOf = (line) => L.segment(tokenizer.tokenize(line), bare)[0].reading;
  assert.strictEqual(readingOf('名乗って'), 'なのる');
  assert.strictEqual(readingOf('確かめたい'), 'たしかめる');
  assert.strictEqual(readingOf('ひいた'), 'ひく');
  // Words we lack get JMdict's English (the per-tab subset), best reading match first.
  const withFallback = L.buildIndex(dict, require('../data/fallback.json'));
  const sontaku = L.segment(tokenizer.tokenize('忖度した'), withFallback)[0];
  assert.strictEqual(sontaku.entries.length, 0);
  assert.ok(sontaku.fallback[0].s[0][1].includes('surmise'));
  // JMdict also joins kanji compounds into one word: あの + 方 → あの方 "that person".
  const anokata = L.segment(tokenizer.tokenize('あの方'), L.buildIndex({ words: [], kanji: [] }, require('../data/fallback.json')))[0];
  assert.strictEqual(anokata.surface, 'あの方');
  assert.strictEqual(anokata.fallback[0].r[0], 'あのかた');
  console.log('ok');
});
