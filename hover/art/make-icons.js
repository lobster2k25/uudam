// Renders hover/art/icon.svg (and icon-small.svg for 16/32 px) to the PNG sizes the manifest uses (icon-16 … icon-128), in headless Chrome.
// Run after changing the SVG: node hover/art/make-icons.js   (CHROME=path/to/chrome to pick the browser)
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
// Small sizes use icon-small.svg (bigger 字, smaller pointer) so the 16 and 32 px toolbar icons stay readable.
const svgFor = (size) => (size <= 32 && fs.existsSync(path.join(__dirname, 'icon-small.svg')) ? read('icon-small.svg') : read('icon.svg'));

(async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 96, 128]) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${svgFor(size).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: path.join(__dirname, `icon-${size}.png`), omitBackground: true });
  }
  await browser.close();
  console.log('hover/art: icon-16/32/48/96/128.png');
})();
