import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('HTTP de venda e caixa compartilham o mesmo estado', async () => {
  const app = createApp(); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${app.address().port}`;
    assert.equal((await fetch(`${base}/buy`, { method: 'POST' })).status, 200);
    assert.match(await (await fetch(`${base}/cashier`)).text(), /data-testid="sales">1</);
  } finally { await new Promise(resolve => app.close(resolve)); }
});
