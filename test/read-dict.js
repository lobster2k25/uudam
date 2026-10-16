// The built-in dictionary for Node tests and scripts: data/dict/ parts put together (as lookup.js loadDict does).
// readDict(dir = the uudam folder) → { version, kanji, words }
const fs = require('fs');
const path = require('path');

module.exports = function readDict(dir = path.join(__dirname, '..')) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const { version, parts } = read('data/dict/parts.json');
  return { version, kanji: read('data/dict/kanji.json'), words: [...Array(parts).keys()].flatMap((i) => read(`data/dict/words-${i}.json`)) };
};
