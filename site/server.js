// The landing page as its own small service (its own Railway project). No dependencies.
//   PORT     set by Railway
//   POS_URL  where restaurants sign in, e.g. https://pos2.up.railway.app ("Sign in" goes to POS_URL)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POS_URL = String(process.env.POS_URL || '').replace(/\/+$/, '');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json' };
const HIDDEN = new Set(['/server.js', '/README.md', '/Dockerfile', '/railway.json']);

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health' || url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (url === '/signin' || url === '/login') { // the restaurant's sign-in screen lives on the POS
    if (!POS_URL) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sign in is not set up yet (POS_URL is missing).'); }
    res.writeHead(302, { Location: POS_URL + '/' }); return res.end();
  }
  const file = path.normalize(path.join(ROOT, url === '/' ? '/index.html' : url));
  if (!file.startsWith(ROOT + path.sep) || HIDDEN.has(url)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    res.end(data);
  });
}).listen(process.env.PORT || 8080, () => console.log(`HazelPOS site on port ${process.env.PORT || 8080}${POS_URL ? `, Sign in -> ${POS_URL}` : ' (POS_URL not set)'}`));
