import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listStock, reserve } from '../src/inventory.js';

test('reserving takes bags off the shelf', () => {
  const before = listStock().find((item) => item.sku === 'HUILA-250').roasted;
  reserve('HUILA-250', 2);
  const after = listStock().find((item) => item.sku === 'HUILA-250').roasted;
  assert.equal(after, before - 2);
});

test('reserving more than is roasted throws', () => {
  assert.throws(() => reserve('DECAF-250', 1), /Only 0 of DECAF-250 left/);
});

test('an unknown SKU throws', () => {
  assert.throws(() => reserve('NOPE', 1), /Unknown SKU/);
});
