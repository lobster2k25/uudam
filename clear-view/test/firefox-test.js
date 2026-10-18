// Loads Clear View into a real (headless) Firefox and checks it on a fake player page (test/player.html):
// a closed shadow root with a video, a dark shade and a full screen button, plus a background video like
// the ones on Apple TV's browse pages. Needs `npm install` in the repo root once (puppeteer-core).
// Run from the repo root: node clear-view/test/firefox-test.js
const fs = require('fs');
const http = require('http');
const path = require('path');

const FIREFOX = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const SRC = path.join(__dirname, '..');
const DEV = path.join(__dirname, 'out', 'addon');
const PORT = 8766;

// A copy of the add-on that runs on localhost instead of tv.apple.com (Firefox match patterns take no port)
function devCopy() {
  fs.rmSync(DEV, { recursive: true, force: true });
  for (const f of ['manifest.json', 'src', 'options', 'icons']) fs.cpSync(path.join(SRC, f), path.join(DEV, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(DEV, 'manifest.json'), 'utf8'));
  for (const c of m.content_scripts) c.matches = ['http://localhost/*'];
  fs.writeFileSync(path.join(DEV, 'manifest.json'), JSON.stringify(m, null, 2));
  return DEV;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(path.join(__dirname, 'player.html')));
  });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true,
    defaultViewport: { width: 1280, height: 1480 },
  });
  let fails = 0;
  const check = (name, cond, log) => {
    console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(log)));
    if (!cond) fails++;
  };
  try {
    await browser.installExtension(devCopy());
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await wait(1500);
    const take = () => page.evaluate(() => window.log.splice(0));
    const toggles = (l) => l.filter((x) => x === 'play' || x === 'pause').length;

    const bg = await page.evaluate(() => window.shadeBg());
    check('shade removed', bg === 'rgba(0, 0, 0, 0)', bg);
    await take();

    await page.mouse.move(600, 200); await page.mouse.move(610, 210);
    let l = await take();
    check('move in the top part is hidden from the player', !l.includes('player:mousemove'), l);

    await page.mouse.move(600, 650); await page.mouse.move(610, 660);
    l = await take();
    check('move in the bottom part reaches the player', l.includes('player:mousemove'), l);

    await wait(1300); l = await take();
    check('player is told "mouse left" after 1 s', l.some((x) => x.startsWith('player:mouseleave')), l);

    await page.mouse.move(1240, 680); await page.mouse.move(1241, 681); await wait(1300);
    l = await take();
    check('no "mouse left" while resting on a button', !l.some((x) => x.startsWith('player:mouseleave')), l);

    await page.mouse.move(600, 400); await page.mouse.click(600, 400); await wait(500);
    l = await take();
    check('single click: one play/pause, player sees no click', toggles(l) === 1 && !l.includes('player:click'), l);

    await page.mouse.click(600, 400, { count: 1 }); await page.mouse.click(600, 400, { count: 2 }); await wait(500);
    l = await take();
    check('double-click: full screen button, no play/pause', l.includes('fs-button') && toggles(l) === 0, l);

    await page.mouse.move(600, 1000); await page.mouse.move(610, 1010); await page.mouse.click(600, 1000); await wait(500);
    l = await take();
    check('background video is left alone', l.includes('bg:mousemove') && l.includes('bg:click') && toggles(l) === 0, l);
  } catch (err) {
    fails++;
    console.error('FAILED:', err.message);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fails ? `${fails} failed` : 'ok');
  process.exit(fails ? 1 : 0);
})();
