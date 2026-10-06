import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrder, getOrder, listOrders } from '../src/orders.js';

test('orders list newest first', () => {
  const [first, second] = listOrders();
  assert.ok(first.placedAt >= second.placedAt);
});

test('listing can be narrowed to one status', () => {
  const shipped = listOrders({ status: 'shipped' });
  assert.ok(shipped.length > 0);
  assert.ok(shipped.every((order) => order.status === 'shipped'));
});

test('an order carries its totals', () => {
  const order = getOrder('ord_1001');
  assert.equal(order.totalCents, order.subtotalCents + order.shippingCents + order.taxCents);
});

test('an order needs an email and an item', () => {
  assert.throws(() => createOrder({ email: 'nope', items: [] }), /valid email/);
  assert.throws(() => createOrder({ email: 'a@b.co', items: [] }), /at least one item/);
});
