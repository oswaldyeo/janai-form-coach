// Zero-dependency static file server for local use and the acceptance gate.
//   node scripts/serve.js [port]
// Serves the project root with the correct MIME types (incl. .webmanifest and
// ES modules). Not for production — dev/QA only.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('Not found'); return; }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Janai Form Coach dev server → http://localhost:${PORT}`);
});
