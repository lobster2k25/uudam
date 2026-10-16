// Rebuilds everything after the dictionary changes: pulls ../mongol-dict, builds uudam (node build.js here),
// then the hover extension (node build.js in hover/), and prints how many words went in.
// Usage: node rebuild-all.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const run = (cmd, args, cwd) => {
  console.log(`\n> ${cmd} ${args.join(' ')}   (${path.relative(path.join(here, '..'), cwd) || '.'})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
};

run('git', ['pull', '--ff-only', 'origin', 'main'], path.join(here, '..', 'mongol-dict'));
run(process.execPath, ['build.js'], here);
run(process.execPath, ['build.js'], path.join(here, 'hover'));

const readDict = require('./test/read-dict');
const count = (dir) => {
  const { kanji, words } = readDict(dir);
  return `${words.filter((w) => !String(w.pos || '').startsWith('name')).length} words, ${kanji.length} kanji`;
};
console.log(`\nuudam data/dict/: ${count(here)}`);
console.log(`hover data/dict/: ${count(path.join(here, 'hover'))}`);
console.log('Done. Reload the add-ons: Firefox about:debugging → Reload, Chrome chrome://extensions → reload.');
