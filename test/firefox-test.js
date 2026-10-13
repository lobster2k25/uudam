// Installs the extension into a real (headless) Firefox and runs the checks in checks.js on the fake Netflix page.
// Needs `npm install` here once (puppeteer-core) and `node build.js`. Run: node test/firefox-test.js
// Screenshots go to test/out/.
const server = require('./serve');
const { devCopy, checks } = require('./checks');

const FIREFOX = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';

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
    await browser.installExtension(devCopy());
    failed = await checks(browser, 'firefox');
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
