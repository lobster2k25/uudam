// Records the README demo (docs/demo.mp4 + docs/demo.gif): Uudam on a Creative Commons Japanese cooking video on YouTube.
// Visible Chrome (YouTube sends empty caption files to headless browsers), mouse driven by puppeteer with a drawn cursor,
// frames from the CDP screencast, joined with ffmpeg (see the end of this file).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { devCopy } = require("./checks");

const VIDEO = process.env.VIDEO || 'O6Qw4WdvY0w';
const START = +(process.env.START || 201);
const WORD = process.env.WORD || '生地'; // the word to hover (else the second word with kanji)
const frames = path.join(__dirname, "out", "demo-frames");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames);
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, pipe: true, enableExtensions: true,
    // 1920 CSS px wide at scale 1: the theater-mode player is about 1080p (the screencast ignores deviceScaleFactor).
    defaultViewport: { width: 1920, height: 1240 },
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled', '--lang=ja', '--window-size=1940,1360'],
  });
  await browser.installExtension(devCopy());
  await sleep(2000);
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.text().includes('jap-sub')) console.log('  ', m.text()); });
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}&t=${START}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.evaluate(() => { const p = document.getElementById('movie_player'); p.mute(); p.playVideo(); try { p.setPlaybackQualityRange('hd1080', 'hd1080'); p.setPlaybackQuality('hd1080'); } catch {} });
  // Wait out any ad, then seek to the start in the same video (no ad frames in the recording).
  for (let i = 0; i < 180; i++) {
    if (!(await page.evaluate(() => document.getElementById('movie_player').classList.contains('ad-showing')))) break;
    await page.evaluate(() => document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')?.click());
    await sleep(1000);
  }
  await page.evaluate((s) => { const p = document.getElementById('movie_player'); p.seekTo(s, true); p.playVideo(); try { p.setPlaybackQualityRange('hd1080', 'hd1080'); } catch {} }, START);
  await page.waitForSelector('.jap-sub-word', { timeout: 90000 });
  // Theater mode for a bigger player, and a drawn mouse cursor (screenshots have none).
  await page.keyboard.press('t').catch(() => {});
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '26'); svg.setAttribute('height', '26'); svg.setAttribute('viewBox', '0 0 24 24');
    const pth = document.createElementNS(NS, 'path');
    pth.setAttribute('d', 'M4 2 L4 20 L9 15 L12.5 22 L15.5 20.6 L12 13.8 L19 13.8 Z');
    pth.setAttribute('fill', '#fff'); pth.setAttribute('stroke', '#111'); pth.setAttribute('stroke-width', '1.6'); pth.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pth); c.appendChild(svg);
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' });
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    // Our popup sits above everything; keep the cursor above it too.
    setInterval(() => document.documentElement.appendChild(c), 200);
  });
  await sleep(2500);
  const player = await page.$eval('#movie_player', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  console.log('player', player);
  let mouse = { x: player.x + player.w * 0.7, y: player.y + player.h * 0.3 };
  await page.mouse.move(mouse.x, mouse.y);
  const glide = async (x, y, ms = 900) => {
    const steps = Math.max(12, Math.round(ms / 30));
    const from = { ...mouse };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(ms / steps);
    }
    mouse = { x, y };
  };

  // Screencast frames of the player area (plus room for the popup above it).
  const cdp = await page.createCDPSession();
  let n = 0;
  const times = [];
  cdp.on('Page.screencastFrame', async (f) => {
    fs.writeFileSync(path.join(frames, `f${String(n).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    times.push(f.metadata.timestamp);
    n++;
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1, maxWidth: 2560, maxHeight: 1600 });

  await page.addStyleTag({ content: '.ytp-chrome-bottom, .ytp-gradient-bottom, .ytp-chrome-top, .ytp-gradient-top { opacity: 0 !important; }' });
  await sleep(4500); // the line plays
  // A word with kanji in the current line.
  const target = await page.evaluate((want) => {
    const words = [...document.querySelectorAll('.jap-sub-word')].filter((w) => /[一-鿿]/.test(w.textContent));
    const w = words.find((x) => x.textContent.includes(want)) || words[Math.min(1, words.length - 1)] || document.querySelector('.jap-sub-word');
    const r = w.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.6, text: w.textContent };
  }, WORD);
  console.log('word', target.text);
  await glide(target.x, player.y + player.h * 0.45, 700); // above the line, then straight down onto the word
  await glide(target.x, target.y, 800);
  await page.waitForSelector('.jap-sub-popup', { timeout: 5000 });
  await sleep(2600); // paused, popup open
  const k = await page.$eval('.jap-sub-popup .jap-sub-k', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await glide(k.x, k.y, 1000);
  await sleep(400);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await page.waitForSelector('.jap-sub-strokes', { timeout: 10000 }).catch(() => {});
  await sleep(5200); // stroke order animation
  await glide(player.x + player.w * 0.85, player.y + player.h * 0.2, 1100); // leave: popup closes, video plays on
  await sleep(3500);
  await cdp.send('Page.stopScreencast');
  await sleep(500);
  await browser.close();
  console.log('frames', n, 'seconds', (times[times.length - 1] - times[0]).toFixed(1));
  fs.writeFileSync(path.join(frames, 'times.json'), JSON.stringify({ times, player }));
  // ffmpeg concat list: each frame shown for its real duration.
  const list = times.map((t, i) => `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${((times[i + 1] ?? t + 0.1) - t).toFixed(4)}\n`).join('');
  fs.writeFileSync(path.join(frames, 'list.txt'), `${list}file 'f${String(n - 1).padStart(5, '0')}.jpg'\n`);
// Then (crop = the player printed above, 16:9):
// ffmpeg -f concat -safe 0 -i test/out/demo-frames/list.txt -vf "crop=1904:1071:0:56,scale=1920:1080:flags=lanczos,fps=30,format=yuv420p" -c:v libx264 -crf 18 -preset slow -movflags +faststart docs/demo.mp4
// ffmpeg -i docs/demo.mp4 -vf "fps=15,scale=1280:-1:flags=lanczos,hqdn3d=3:3:6:6,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif
})().catch((e) => { console.error(e); process.exit(1); });
