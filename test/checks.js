// The checks shared by firefox-test.js and chrome-test.js: on the fake Netflix page (test/netflix.html),
// subtitles appear, Netflix's own are hidden, a word opens its popup, kanji open, English fallback, capture mode;
// then the fake YouTube page (test/youtube.html).
const fs = require('fs');
const os = require('os');
const path = require('path');

const ext = path.join(__dirname, '..');
const out = path.join(__dirname, 'out');
// A copy of the extension that also runs on localhost (the real one only matches netflix.com).
function devCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jap-sub-'));
  for (const f of ['manifest.json', 'src', 'popup', 'icons', 'vendor', 'data']) fs.cpSync(path.join(ext, f), path.join(dir, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const local = 'http://localhost/*';
  m.host_permissions.push(local);
  for (const cs of m.content_scripts) cs.matches.push(local);
  for (const war of m.web_accessible_resources) war.matches.push(local);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}


// Runs every check in `browser` (the extension already installed); screenshots are named `<name>-*.png`.
// Returns true if any check failed.
async function checks(browser, name) {
  let failed = false;
  fs.mkdirSync(out, { recursive: true });
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
  await page.screenshot({ path: path.join(out, `${name}-line.png`) });
  // Hovering a word pauses the video and opens its popup.
  await page.hover('.jap-sub-word');
  await page.waitForSelector('.jap-sub-popup', { timeout: 5000 });
  console.log('popup:', (await page.$eval('.jap-sub-popup', (e) => e.innerText)).split('\n').slice(0, 3).join(' | '));
  const pausedOnHover = await page.$eval('video', (v) => v.paused);
  console.log('video paused on hover:', pausedOnHover);
  // Each kanji row shows the reading it has in this word (危ない → 危 あぶ 訓).
  await page.waitForSelector('.jap-sub-kanji-used', { timeout: 10000 });
  console.log('kanji row reading:', await page.$eval('.jap-sub-kanji-row', (e) => e.innerText.replace(/\s+/g, ' ')));
  await page.screenshot({ path: path.join(out, `${name}-popup.png`) });
  // A kanji in the popup opens that kanji; "back" returns to the word.
  await page.hover('.jap-sub-popup .jap-sub-k');
  await page.click('.jap-sub-popup .jap-sub-k');
  await page.waitForSelector('.jap-sub-big-kanji', { timeout: 5000 });
  // Readings and stroke order arrive from the background page (data/kanji.json).
  await page.waitForSelector('.jap-sub-strokes', { timeout: 10000 });
  const strokes = await page.$$eval('.jap-sub-strokes-ink path', (p) => p.length);
  const readings = await page.$eval('.jap-sub-readings', (e) => e.innerText.replace(/\s+/g, ' '));
  console.log('kanji view:', (await page.$eval('.jap-sub-popup', (e) => e.innerText)).split('\n').slice(0, 3).join(' | '));
  console.log('kanji strokes:', strokes, '| readings:', readings);
  // Jump to the end of the stroke animation (waiting is not possible: the fake video's line changes).
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: path.join(out, `${name}-kanji.png`) });
  // A part of the kanji (危 → 厄) opens that kanji; "back" returns to the first one.
  const partOk = !!(await page.$('.jap-sub-part.jap-sub-clickable'));
  if (partOk) {
    await page.click('.jap-sub-part.jap-sub-clickable');
    await page.waitForFunction(() => document.querySelectorAll('.jap-sub-strokes').length === 1
      && document.querySelector('.jap-sub-kanji-meanings').textContent !== 'аюултай', { timeout: 5000 });
    await page.click('.jap-sub-back');
  }
  console.log('kanji part opens:', partOk);
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
  await page.screenshot({ path: path.join(out, `${name}-english.png`) });
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

  // Another title starts (Netflix changes the address without reloading) and no Japanese file comes:
  // the old file must go, and Netflix's own (non-Japanese) subtitles must show again.
  console.log('--- another title');
  await new Promise((r) => setTimeout(r, 16000)); // past the grace period for files caught just before a switch
  await page2.evaluate(() => history.pushState(null, '', '/watch/789'));
  await new Promise((r) => setTimeout(r, 1000));
  const dropped = logs.some((l) => l.includes('dropped the previous title'));
  const netflixShown = await page2.evaluate(() => !document.documentElement.classList.contains('jap-sub-active'));
  const ourLine = await page2.$eval('.jap-sub-lines', (e) => e.textContent);
  console.log('old file dropped:', dropped, '| Netflix subs shown:', netflixShown, '| our line empty:', ourLine === '');
  if (!dropped || !netflixShown || ourLine !== '') failed = true;

  // YouTube: the extension switches the player to the uploader's Japanese captions (not the automatic
  // ones), catches the file the player downloads, hides YouTube's own captions and draws over the player.
  console.log('--- YouTube');
  logs.length = 0;
  const page3 = await browser.newPage();
  page3.on('console', (m) => { logs.push(m.text()); console.log(`  console.${m.type()}: ${m.text()}`); });
  page3.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
  await page3.goto('http://localhost:8765/watch?v=yt1');
  await page3.waitForSelector('.jap-sub-word', { timeout: 30000 });
  const yt = await page3.evaluate(() => {
    const line = document.querySelector('.jap-sub-line').getBoundingClientRect();
    const player = document.getElementById('movie_player').getBoundingClientRect();
    return {
      picked: window.picked,
      line: document.querySelector('.jap-sub-lines').innerText.replace(/\s+/g, ' '),
      ytHidden: getComputedStyle(document.querySelector('.ytp-caption-window-container')).opacity === '0',
      overPlayer: line.left >= player.left && line.right <= player.right && line.top >= player.top && line.bottom <= player.bottom,
    };
  });
  const ytCaught = logs.some((l) => l.includes('subtitles loaded (caught from the player)'));
  console.log('picked:', JSON.stringify(yt.picked), '| subtitle:', yt.line, '| caught:', ytCaught,
    '| YouTube captions hidden:', yt.ytHidden, '| line over the player:', yt.overPlayer);
  await page3.screenshot({ path: path.join(out, `${name}-youtube.png`) });
  if (!yt.picked || yt.picked.languageCode !== 'ja' || yt.picked.kind || !ytCaught || !yt.ytHidden || !yt.overPlayer) failed = true;
  return failed;
}

module.exports = { devCopy, checks };
