import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shippingCents, taxCents, total } from '../src/pricing.js';

const order = (country, ...items) => ({ shipTo: { country }, items });

test('orders of $60 or more ship free', () => {
  const big = order('US', { sku: 'GUJI-250', qty: 4, unitCents: 1650 });
  assert.equal(shippingCents(big), 0);
});

test('smaller orders pay for shipping by country', () => {
  const small = { sku: 'HUILA-250', qty: 1, unitCents: 1500 };
  assert.equal(shippingCents(order('US', small)), 595);
  assert.equal(shippingCents(order('DE', small)), 1495);
});

test('tax follows the destination country', () => {
  const item = { sku: 'GUJI-250', qty: 2, unitCents: 1650 };
  assert.equal(taxCents(order('US', item)), 239);
  assert.equal(taxCents(order('GB', item)), 660);
  assert.equal(taxCents(order('JP', item)), 0);
});

test('the total adds subtotal, shipping and tax', () => {
  const item = { sku: 'GUJI-250', qty: 2, unitCents: 1650 };
  assert.equal(total(order('US', item)), 3300 + 595 + 239);
});
