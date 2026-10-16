// Fills vendor/ (kuromoji + its dictionary) and data/dict.json (our kanji + words) from ../mongol-dict.
// Run after `npm install` in mongol-dict, and again whenever the dictionary changes: node build.js
const fs = require('fs');
const path = require('path');
const { fromRelease } = require('./src/dict-update');

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
// Same shape as a dictionary update downloaded at run time (src/dict-update.js), from the same converter.
// The version tells the add-on whether a downloaded dictionary is newer than this built-in one.
const namesDir = path.join(dictRepo, 'ja-mn', 'names');
const { version, kanji, words } = fromRelease({
  version: JSON.parse(fs.readFileSync(path.join(dictRepo, 'package.json'), 'utf8')).version,
  kanji: read(path.join(dictRepo, 'ja-mn', 'kanji')),
  words: read(path.join(dictRepo, 'ja-mn', 'words')),
  names: fs.existsSync(namesDir) ? read(namesDir) : [],
});
const names = words.filter((w) => w.pos.startsWith('name-'));
fs.mkdirSync(path.join(ext, 'data'), { recursive: true });
fs.writeFileSync(path.join(ext, 'data', 'dict.json'), JSON.stringify({ version, kanji, words }));
fs.writeFileSync(path.join(ext, 'data', 'dict-version.json'), JSON.stringify({ version }));
console.log(`vendor/: kuromoji + dictionary; data/dict.json (mongol-dict ${version}): ${kanji.length} kanji, ${words.length - names.length} words, ${names.length} names`);

// English fallback from JMdict, a separate layer (see build-fallback.js).
require('./build-fallback')(ext);

// Kanji readings, parts, phonetic families and stroke paths from KanjiVG + Kanjium, a separate layer (see build-kanji.js).
require('./build-kanji')(ext, kanji);
