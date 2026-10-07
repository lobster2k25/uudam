// Installs the extension into a real (headless) Firefox and checks it on the fake Netflix page:
// subtitles appear, Netflix's own are hidden, a word click opens the popup.
// Needs `npm install` here once (puppeteer-core) and `node build.js`. Run: node test/firefox-test.js
// Screenshots go to test/out/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('./serve');

const FIREFOX = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const ext = path.join(__dirname, '..');
const out = path.join(__dirname, 'out');

// A copy of the extension that also runs on localhost (the real one only matches netflix.com).
function devCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jap-sub-'));
  for (const f of ['manifest.json', 'src', 'popup', 'vendor', 'data']) fs.cpSync(path.join(ext, f), path.join(dir, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const local = 'http://localhost/*';
  m.host_permissions.push(local);
  for (const cs of m.content_scripts) cs.matches.push(local);
  for (const war of m.web_accessible_resources) war.matches.push(local);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  await new Promise((r) => server.listen(8765, r));
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true,
    defaultViewport: { width: 1280, height: 720 },
    extraPrefsFirefox: { 'extensions.webextensions.restrictedDomains': '', 'media.autoplay.default': 0 },
  });
  let failed = false;
  try {
    await browser.installExtension(devCopy());
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => { logs.push(m.text()); console.log(`  console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
    await page.goto('http://localhost:8765/watch/123');
    await page.waitForSelector('.jap-sub-word', { timeout: 30000 });
    const state = await page.evaluate(() => ({
      line: document.querySelector('.jap-sub-lines').innerText.replace(/\s+/g, ' '),
      netflixHidden: getComputedStyle(document.querySelector('.player-timedtext')).opacity === '0',
    }));
    console.log('subtitle:', state.line, '| Netflix subs hidden:', state.netflixHidden);
    await page.screenshot({ path: path.join(out, 'firefox-line.png') });
    // Hovering a word pauses the video and opens its popup.
    await page.hover('.jap-sub-word');
    await page.waitForSelector('.jap-sub-popup', { timeout: 5000 });
    console.log('popup:', (await page.$eval('.jap-sub-popup', (e) => e.innerText)).split('\n').slice(0, 3).join(' | '));
    const pausedOnHover = await page.$eval('video', (v) => v.paused);
    console.log('video paused on hover:', pausedOnHover);
    await page.screenshot({ path: path.join(out, 'firefox-popup.png') });
    // A kanji in the popup opens that kanji; "back" returns to the word.
    await page.hover('.jap-sub-popup .jap-sub-k');
    await page.click('.jap-sub-popup .jap-sub-k');
    await page.waitForSelector('.jap-sub-big-kanji', { timeout: 5000 });
    console.log('kanji view:', (await page.$eval('.jap-sub-popup', (e) => e.innerText)).split('\n').slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(out, 'firefox-kanji.png') });
    await page.click('.jap-sub-back');
    const backOk = !(await page.$('.jap-sub-big-kanji')) && !!(await page.$('.jap-sub-meanings'));
    // Leaving closes the popup and resumes playback.
    await page.mouse.move(200, 150);
    await new Promise((r) => setTimeout(r, 800));
    const closedOnLeave = !(await page.$('.jap-sub-popup'));
    const playingAgain = !(await page.$eval('video', (v) => v.paused));
    console.log('back to word:', backOk, '| closed on leave:', closedOnLeave, '| playing again:', playingAgain);
    // Alt+J turns our subtitles off (Netflix's come back) and on again.
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyJ'); await page.keyboard.up('Alt');
    await new Promise((r) => setTimeout(r, 300));
    const offOk = await page.evaluate(() => !document.querySelector('.jap-sub-word')
      && getComputedStyle(document.querySelector('.player-timedtext')).opacity === '1');
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyJ'); await page.keyboard.up('Alt');
    await page.waitForSelector('.jap-sub-word', { timeout: 5000 });
    console.log('Alt+J off then on:', offOk);
    if (!pausedOnHover || !backOk || !closedOnLeave || !playingAgain || !offOk) failed = true;

    // Words we lack show JMdict's English: 忖度 from the per-tab subset, rare 齟齬 from the background's full JMdict.
    await page.waitForFunction(() => document.querySelector('.jap-sub-lines').innerText.includes('齟齬'), { timeout: 30000 });
    const englishFor = async (word) => {
      const target = await page.evaluateHandle((w) => [...document.querySelectorAll('.jap-sub-word')].find((s) => s.textContent.startsWith(w)), word);
      await target.hover();
      await page.waitForFunction((w) => {
        const p = document.querySelector('.jap-sub-popup');
        return p && p.querySelector('.jap-sub-head-word').textContent.startsWith(w) && p.querySelector('.jap-sub-english');
      }, { timeout: 15000 }, word).catch(async (err) => {
        console.log(`  ${word}: popup shows`, await page.evaluate(() => (document.querySelector('.jap-sub-popup') || {}).innerText || 'nothing'));
        throw err;
      });
      return page.$eval('.jap-sub-popup', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 120));
    };
    const sontaku = await englishFor('忖度');
    const sogo = await englishFor('齟齬');
    console.log('忖度 popup:', sontaku);
    console.log('齟齬 popup:', sogo);
    await page.screenshot({ path: path.join(out, 'firefox-english.png') });
    if (!/surmise/.test(sontaku) || !/discrepancy|inconsistency|conflict/i.test(sogo)) failed = true;
    await page.mouse.move(200, 150);

    // Words from the whole track are logged as missing, including lines not yet on screen.
    const missLog = logs.find((l) => l.includes('words not in the dictionary')) || '';
    // Rare words from the sample's last line; pick others if the dictionary ever gains these.
    const expected = ['齟齬', '忖度'];
    // The speaker label （九条） must be stripped, not logged as 九 and 条.
    if (missLog.includes(' 九') || missLog.includes('条')) { console.log('speaker label leaked into words'); failed = true; }
    console.log('missing-word log has', expected.filter((w) => missLog.includes(w)).join(' '));
    if (!state.netflixHidden || !expected.every((w) => missLog.includes(w))) failed = true;

    // Second case: no manifest is visible; the subtitle file is caught from the player's own download.
    console.log('--- capture mode');
    logs.length = 0;
    const page2 = await browser.newPage();
    page2.on('console', (m) => { logs.push(m.text()); console.log(`  console.${m.type()}: ${m.text()}`); });
    await page2.goto('http://localhost:8765/watch/456?mode=capture');
    await page2.waitForSelector('.jap-sub-word', { timeout: 30000 });
    const caughtOk = logs.some((l) => l.includes('subtitles loaded (caught from the player)'));
    const missOk = logs.some((l) => l.includes('words not in the dictionary') && l.includes('齟齬'));
    console.log('caught from player:', caughtOk, '| whole-episode words logged:', missOk);
    if (!caughtOk || !missOk) failed = true;
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
