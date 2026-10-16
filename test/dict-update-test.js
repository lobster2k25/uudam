// Checks src/dict-update.js: version order, the broken-download guard, and that the latest GitHub release turns
// into the same dictionary build.js makes (when both are the same version). Needs the network.
// Run after build.js: node test/dict-update-test.js
const assert = require('assert');
const U = require('../src/dict-update');
const bundled = require('../data/dict.json');

assert.ok(U.newer('0.5.10', '0.5.9'));
assert.ok(U.newer('1.0.0', '0.9.9'));
assert.ok(!U.newer('0.5.2', '0.5.2'));
assert.ok(!U.newer('0.5.1', '0.5.2'));
assert.ok(U.newer('0.5.2', undefined));

assert.throws(() => U.check({ version: '0.5.2', kanji: [], words: [] }), /too few kanji/);
assert.throws(() => U.check({ ...bundled, version: 'latest' }), /no version/);
assert.throws(() => U.check({ ...bundled, words: [...bundled.words, { word: 1 }] }), /bad word entry/);
assert.strictEqual(U.check(bundled), bundled);
console.log(`bundled: mongol-dict ${bundled.version}, ${bundled.words.length} words incl. names, ${bundled.kanji.length} kanji`);

(async () => {
  const get = async (url) => (await fetch(url)).json();
  const index = await get('https://github.com/lobster2k25/mongol-dict/releases/latest/download/mongol-dict-ja-mn-yomitan-index.json');
  const rel = await get('https://github.com/lobster2k25/mongol-dict/releases/latest/download/mongol-dict-ja-mn.json');
  const dict = U.check(U.fromRelease(rel));
  assert.strictEqual(dict.version, index.revision);
  console.log(`latest release: ${dict.version}, ${dict.words.length} words incl. names, ${dict.kanji.length} kanji`);
  if (dict.version === bundled.version) {
    // Same entries, maybe in another order (the release sorts by id, build.js by file).
    const key = (d) => d.words.map((w) => JSON.stringify(w)).sort().join('\n');
    assert.strictEqual(dict.words.length, bundled.words.length);
    assert.ok(key(dict) === key(bundled), 'release and build.js disagree');
    assert.deepStrictEqual(dict.kanji, bundled.kanji);
    console.log('release = build.js output');
  }
  console.log('ok');
})().catch((err) => { console.error(err); process.exit(1); });
