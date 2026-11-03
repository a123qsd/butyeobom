import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const files = new Map([
  ['/', ['../index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['../index.html', 'text/html; charset=utf-8']],
  ['/src/app.js', ['../src/app.js', 'text/javascript; charset=utf-8']],
  ['/src/transform.js', ['../src/transform.js', 'text/javascript; charset=utf-8']],
  ['/src/styles.css', ['../src/styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['../favicon.svg', 'image/svg+xml']],
]);

export function createPreviewServer() {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=()');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    const entry = files.get(pathname);
    if (!entry) { response.writeHead(404).end('Not found'); return; }
    try {
      const contents = await readFile(new URL(entry[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': entry[1] });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch {
      response.writeHead(500).end('Preview file unavailable');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('PORT must be an integer from 1 to 65535.\n');
    process.exitCode = 1;
  } else {
    const server = createPreviewServer();
    server.on('error', (error) => {
      const hint = error.code === 'EADDRINUSE' ? 'Choose a different PORT.' : 'Check local server permissions.';
      process.stderr.write(`Preview could not start (${error.code || 'unknown error'}). ${hint}\n`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      process.stdout.write(`붙여봄 preview: http://127.0.0.1:${port}\n`);
    });
  }
}
