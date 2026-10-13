// Installs the extension into a real (headless) Chrome or Chromium and runs the checks in checks.js on the
// fake Netflix page. Needs `npm install` here once (puppeteer-core) and `node build.js`. Run: node test/chrome-test.js
// (CHROME=path/to/chrome to pick the browser). Screenshots go to test/out/.
const server = require('./serve');
const { devCopy, checks } = require('./checks');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  await new Promise((r) => server.listen(8765, r));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, enableExtensions: true,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-extension-debugging', ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean)],
  });
  let failed = false;
  try {
    await browser.installExtension(devCopy());
    failed = await checks(browser, 'chrome');
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
