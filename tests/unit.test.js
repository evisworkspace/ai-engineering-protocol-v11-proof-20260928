import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('venda reduz estoque e aparece no caixa', () => {
  const store = createStore();
  assert.equal(store.buy(), true);
  assert.deepEqual(store.snapshot(), { stock: 2, sales: 1 });
});

test('backup restaura estado', () => {
  const store = createStore(); store.buy(); const backup = store.backup(); store.reset(); store.restore(backup);
  assert.deepEqual(store.snapshot(), { stock: 2, sales: 1 });
});
