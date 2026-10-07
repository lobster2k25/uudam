// Fills vendor/ (kuromoji + its dictionary) and data/dict.json (our kanji + words) from ../mongol-dict.
// Run after `npm install` in mongol-dict, and again whenever the dictionary changes: node build.js
const fs = require('fs');
const path = require('path');

const ext = __dirname;
const dictRepo = path.join(ext, '..', 'mongol-dict');
const kuromoji = path.join(dictRepo, 'node_modules', 'kuromoji');

let js = fs.readFileSync(path.join(kuromoji, 'build', 'kuromoji.js'), 'utf8');

// kuromoji builds dictionary URLs with path.join, which turns moz-extension:// into moz-extension:/.
const joins = /path\.join\(dic_path, /g;
if (!joins.test(js)) throw new Error('kuromoji.js changed: dictionary path join not found');
js = js.replace(joins, '(dic_path + ');

// Load with fetch and the browser's own gzip decoder (much faster than kuromoji's JavaScript one).
const loader = /BrowserDictionaryLoader\.prototype\.loadArrayBuffer = function \(url, callback\) \{[\s\S]*?\n\};/;
if (!loader.test(js)) throw new Error('kuromoji.js changed: browser dictionary loader not found');
js = js.replace(loader, `BrowserDictionaryLoader.prototype.loadArrayBuffer = function (url, callback) {
    fetch(url)
        .then(function (res) {
            if (!res.ok) throw new Error(res.status);
            return new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        })
        .then(function (buffer) { callback(null, buffer); }, function (err) { callback(new Error(url + ": " + err), null); });
};`);

// lodash's fallback global lookup uses the Function constructor, which Mozilla's linter flags.
js = js.replace("Function('return this')()", 'globalThis');

fs.rmSync(path.join(ext, 'vendor'), { recursive: true, force: true });
fs.mkdirSync(path.join(ext, 'vendor', 'dict'), { recursive: true });
fs.writeFileSync(path.join(ext, 'vendor', 'kuromoji.js'), js);
for (const f of fs.readdirSync(path.join(kuromoji, 'dict'))) {
  fs.copyFileSync(path.join(kuromoji, 'dict', f), path.join(ext, 'vendor', 'dict', f));
}

const read = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const kanji = read(path.join(dictRepo, 'ja-mn', 'kanji'))
  .map(({ kanji, meanings_mn, note_kind, note_mn, examples }) => ({ kanji, meanings_mn, note_kind, note_mn, examples }));
// Names (countries, places, surnames…) become word-shaped entries: the Mongolian name, then its description.
const namesDir = path.join(dictRepo, 'ja-mn', 'names');
const names = (fs.existsSync(namesDir) ? read(namesDir) : [])
  .map(({ id, word, reading, alt, kind, mn, desc_mn }) => ({
    id, word, reading, alt, pos: `name-${kind}`, meanings_mn: desc_mn ? [mn, desc_mn] : [mn], note_kind: '', note_mn: '',
  }));
const words = [...read(path.join(dictRepo, 'ja-mn', 'words')).map(({ status, ...e }) => e), ...names];
fs.mkdirSync(path.join(ext, 'data'), { recursive: true });
fs.writeFileSync(path.join(ext, 'data', 'dict.json'), JSON.stringify({ kanji, words }));
console.log(`vendor/: kuromoji + dictionary; data/dict.json: ${kanji.length} kanji, ${words.length - names.length} words, ${names.length} names`);

// English fallback from JMdict, a separate layer (see build-fallback.js).
require('./build-fallback')(ext);
