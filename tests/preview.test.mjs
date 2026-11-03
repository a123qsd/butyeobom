import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPreviewServer } from '../scripts/serve.mjs';

test('preview serves only application assets and refuses submitted input', async (t) => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/package.json', '/README.md', '/tests/preview.test.mjs', '/%2e%2e/package.json', '/missing']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  const post = await fetch(origin, { method: 'POST', body: 'fictional sample' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  const favicon = await fetch(origin + '/favicon.svg');
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.equal(favicon.headers.get('cache-control'), 'no-store');
  assert.equal(favicon.headers.get('referrer-policy'), 'no-referrer');
});
