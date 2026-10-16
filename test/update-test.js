// End-to-end check of dictionary updates in a real (headless) Firefox: the add-on is installed with a nearly empty
// built-in dictionary marked 0.0.1 and GitHub access already granted; its background script downloads the latest
// mongol-dict release (dict-update.js), and the fake Netflix page must then find words that only the download has.
// Needs the network, `npm install` here once and `node build.js`. Run: node test/update-test.js
const fs = require('fs');
const path = require('path');
const server = require('./serve');
const { devCopy, checks } = require('./checks');
const U = require('../src/dict-update');

const FIREFOX = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';

function oldCopy() {
  const dir = devCopy();
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.host_permissions.push(...U.ORIGINS); // granted at install, so no prompt
  m.background.scripts.splice(m.background.scripts.indexOf('src/background.js') + 1, 0, 'test-hook.js');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  // Turn the daily check on, as the popup's checkbox does; background.js already ran its first check, so ask again.
  fs.writeFileSync(path.join(dir, 'test-hook.js'),
    'browser.storage.local.set({ dictAuto: true }).then(() => UudamDictUpdate.update(browser, "0.0.1"));\n');
  // Built-in dictionary: the real kanji, no words.
  fs.writeFileSync(path.join(dir, 'data', 'dict', 'parts.json'), JSON.stringify({ version: '0.0.1', parts: 1 }));
  fs.writeFileSync(path.join(dir, 'data', 'dict', 'words-0.json'), '[]');
  fs.writeFileSync(path.join(dir, 'data', 'dict-version.json'), JSON.stringify({ version: '0.0.1' }));
  return dir;
}

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  await new Promise((r) => server.listen(8765, r));
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true,
    defaultViewport: { width: 1280, height: 720 },
    extraPrefsFirefox: { 'extensions.webextensions.restrictedDomains': '', 'media.autoplay.default': 0 },
  });
  let failed = false;
  try {
    await browser.installExtension(oldCopy());
    // The download is ~8 MB; give it time before the page asks for the dictionary.
    await new Promise((r) => setTimeout(r, 30000));
    failed = await checks(browser, 'update');
  } catch (err) {
    failed = true;
    console.error('FAILED:', err.message);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? 'not ok' : 'ok');
  process.exit(failed ? 1 : 0);
})();
