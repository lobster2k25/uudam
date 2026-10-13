// Loads the hover extension into headless Chromium and points at words on test/page.html with Shift held.
// Needs `npm install` in uudam once (puppeteer-core) and `node build.js` here. Run: node test/chromium-test.js
// Chromium wants a service worker, so the test copy gets one that loads the same background scripts.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const hover = path.join(__dirname, '..');
const out = path.join(__dirname, 'out');

function chromeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uudam-hover-'));
  for (const f of ['manifest.json', 'src', 'vendor', 'data', 'icons']) fs.cpSync(path.join(hover, f), path.join(dir, f), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'sw.js'), `importScripts(${m.background.scripts.map((s) => JSON.stringify(`/${s}`)).join(', ')});\n`);
  m.background = { service_worker: 'sw.js' };
  delete m.browser_specific_settings;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return dir;
}

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'page.html')));
});

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  await new Promise((r) => server.listen(8766, r));
  fs.mkdirSync(out, { recursive: true });
  const ext = chromeCopy();
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM, headless: true, pipe: true,
    args: ['--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    ignoreDefaultArgs: ['--disable-extensions'], defaultViewport: { width: 1000, height: 600 },
  });
  let failed = false;
  const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) failed = true; };
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(`  console.${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
    await page.goto('http://localhost:8766/');
    // The middle of the n-th character of an element's text.
    const charPos = (sel, text) => page.evaluate((s, t) => {
      const el = document.querySelector(s);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    }, sel, text);
    const popupText = () => page.evaluate(() => {
      const h = document.querySelector('uudam-hover');
      return h && h.isConnected ? h.shadowRoot.querySelector('.box').innerText.replace(/\s+/g, ' ') : null;
    });
    const highlighted = () => page.evaluate(() => {
      const h = CSS.highlights.get('uudam-hover');
      return h ? [...h].map((r) => r.toString()).join('') : null;
    });
    const point = async (sel, text, { shift = true } = {}) => {
      const p = await charPos(sel, text);
      await page.mouse.move(p.x, p.y - 1);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(p.x, p.y);
      // The first lookup waits for kuromoji and the dictionaries to load.
      await page.waitForFunction(() => document.querySelector('uudam-hover')?.isConnected, { timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      if (shift) await page.keyboard.up('Shift');
    };

    // Without Shift nothing happens.
    const p0 = await charPos('#p1', '図');
    await page.mouse.move(p0.x, p0.y);
    await new Promise((r) => setTimeout(r, 500));
    check('no popup without Shift', (await popupText()) === null);

    await point('#p1', '書');
    let t = await popupText();
    check('図書館 popup', /library/.test(t || ''), t);
    check('図書館 highlighted', (await highlighted()) === '図書館', await highlighted());
    await page.screenshot({ path: path.join(out, 'hover-library.png') });

    await point('#p1', '強');
    t = await popupText();
    check('勉強 popup (moved to the next word)', /study/.test(t || ''), t);

    // 読ん is in <b>, its ending で is outside: one word across two text nodes, shown as 読む.
    await point('#p2', '読');
    t = await popupText();
    check('読んでいました → 読む', /読む/.test(t || '') && /to read/.test(t || ''), t);
    check('highlight spans the tags', /^読んで/.test((await highlighted()) || ''), await highlighted());
    await page.screenshot({ path: path.join(out, 'hover-read.png') });

    // Moving away without Shift closes it.
    await page.mouse.move(900, 550, { steps: 5 });
    await new Promise((r) => setTimeout(r, 200));
    check('popup closes when the mouse leaves', (await popupText()) === null);

    // Pressing Shift while already resting on a word opens it.
    const p3 = await charPos('#p3', '天');
    await page.mouse.move(p3.x, p3.y);
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => document.querySelector('uudam-hover')?.isConnected, { timeout: 5000 }).catch(() => {});
    t = await popupText();
    // Our dictionary has いい天気 as one phrase (Mongolian only); English then comes for the word under the mouse.
    check('Shift press on 天気', /weather/.test(t || ''), t);
    await page.screenshot({ path: path.join(out, 'hover-weather.png') });
    await page.keyboard.press('Escape');
    check('Escape closes it', (await popupText()) === null);

    // English text: nothing.
    await point('#p4', 'E');
    check('no popup on English text', (await popupText()) === null);
  } catch (e) {
    console.error(e);
    failed = true;
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
})();
