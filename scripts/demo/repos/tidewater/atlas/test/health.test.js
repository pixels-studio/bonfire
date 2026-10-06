import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { server } from '../src/server.js';

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = 'http://localhost:' + server.address().port;
});
after(() => server.close());

test('/health reports the version and uptime', async () => {
  const response = await fetch(base + '/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.ok(body.uptimeSeconds >= 0);
});
