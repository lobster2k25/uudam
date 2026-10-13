// Makes the Chrome Web Store package: web-ext-artifacts/chrome/ (load it with "Load unpacked" to try it) and
// web-ext-artifacts/uudam-chrome-<version>.zip (upload this). Run after `node build.js`: node build-chrome.js
// The manifest drops what only Firefox reads (background "scripts", browser_specific_settings), so Chrome shows no warnings.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ext = __dirname;
const dist = path.join(ext, 'web-ext-artifacts'); // already git-ignored; web-ext build puts the Firefox zip here too
const out = path.join(dist, 'chrome');
const FILES = ['src', 'popup', 'icons', 'vendor', 'data', 'LICENSE'];

for (const f of ['vendor', 'data']) {
  if (!fs.existsSync(path.join(ext, f))) throw new Error(`${f}/ missing: run node build.js first`);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) fs.cpSync(path.join(ext, f), path.join(out, f), { recursive: true });

const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
delete m.browser_specific_settings;
m.background = { service_worker: m.background.service_worker };
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);

// A plain zip (deflate), so no zip tool is needed.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const parts = [];
const central = [];
let offset = 0;
for (const file of walk(out)) {
  const name = Buffer.from(path.relative(out, file).split(path.sep).join('/'));
  const data = fs.readFileSync(file);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(0x21, 12); // no time; date 1980-01-01
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(8, 10); head.writeUInt16LE(0x21, 14);
  head.writeUInt32LE(crc, 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
  parts.push(local, name, packed);
  central.push(head, name);
  offset += local.length + name.length + packed.length;
}
const dir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
const zip = path.join(dist, `uudam-chrome-${m.version}.zip`);
fs.writeFileSync(zip, Buffer.concat([...parts, dir, end]));
console.log(`web-ext-artifacts/chrome/ and ${path.relative(ext, zip)}: ${central.length / 2} files, ${(fs.statSync(zip).size / 1e6).toFixed(1)} MB`);
