// Copies what the hover extension shares with uudam into hover/: kuromoji and its dictionary (vendor/),
// the lookup logic (src/lookup.js → vendor/lookup.js), our Mongolian words and the full JMdict (data/).
// Run `node build.js` in the uudam folder first, then here: node build.js
const fs = require('fs');
const path = require('path');

const hover = __dirname;
const uudam = path.join(hover, '..');
const need = ['vendor/kuromoji.js', 'vendor/dict', 'data/dict.json', 'data/fallback-full/parts.json'];
const missing = need.filter((f) => !fs.existsSync(path.join(uudam, f)));
if (missing.length) throw new Error(`missing in uudam: ${missing.join(', ')} (run node build.js there first)`);

for (const dir of ['vendor', 'data', 'icons']) fs.rmSync(path.join(hover, dir), { recursive: true, force: true });
fs.cpSync(path.join(uudam, 'vendor'), path.join(hover, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(uudam, 'src', 'lookup.js'), path.join(hover, 'vendor', 'lookup.js'));
fs.mkdirSync(path.join(hover, 'data'));
fs.copyFileSync(path.join(uudam, 'data', 'dict.json'), path.join(hover, 'data', 'dict.json'));
fs.cpSync(path.join(uudam, 'data', 'fallback-full'), path.join(hover, 'data', 'fallback-full'), { recursive: true });
fs.cpSync(path.join(uudam, 'icons'), path.join(hover, 'icons'), { recursive: true });
console.log('hover/: vendor/ (kuromoji, lookup.js), data/ (dict.json, fallback-full/), icons/');
