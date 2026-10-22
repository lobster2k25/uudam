// Serves the extension folder for the test pages: node test/serve.js
//   http://localhost:8765/test/page.html  — overlay only, with stubbed extension APIs (any browser)
//   http://localhost:8765/watch/123       — fake Netflix watch page for the installed extension
//   http://localhost:8765/watch?v=yt1     — fake YouTube watch page (its captions come from /api/timedtext)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.vtt': 'text/vtt', '.ttml': 'application/ttml+xml', '.json3': 'application/json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.startsWith('/watch/')) rel = '/test/netflix.html';
  if (rel === '/watch') rel = '/test/youtube.html';
  if (rel === '/api/timedtext') rel = '/test/sample.json3';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
});
if (require.main === module) server.listen(8765, () => console.log('http://localhost:8765/test/page.html'));
module.exports = server;
