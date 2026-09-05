import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 5195;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local game port.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
let lastRequest = Date.now();
const server = createServer(async (request, response) => {
  lastRequest = Date.now();
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405); response.end(); return; }
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ game: 'zork', version: '1.0.0', port })); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || pathname.includes('\0')) { response.writeHead(403); response.end('Forbidden'); return; }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    if (request.method === 'HEAD') response.end(); else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === 'ENOENT' ? 404 : 400); response.end('This game file could not be opened.');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Zork is ready at http://127.0.0.1:${port}\n`));
server.on('error', error => { process.stderr.write(`Cannot start the game: ${error.message}\n`); process.exitCode = 1; });
// A visible game sends a local heartbeat. The helper retires after the game has
// been closed for 45 minutes, without leaving a permanent background service.
setInterval(() => { if (Date.now() - lastRequest > 45 * 60_000) server.close(); }, 60_000).unref();
