import { readFileSync } from 'node:fs';
import { subtotal, shippingCents, taxCents, total } from './pricing.js';

const STATUSES = ['placed', 'roasting', 'packed', 'shipped', 'delivered'];
const orders = JSON.parse(
  readFileSync(new URL('../data/orders.json', import.meta.url), 'utf8'),
);

export function withTotals(order) {
  return {
    ...order,
    subtotalCents: subtotal(order),
    shippingCents: shippingCents(order),
    taxCents: taxCents(order),
    totalCents: total(order),
  };
}

/** Every order, newest first, optionally only those with one status. */
export function listOrders({ status } = {}) {
  return orders
    .filter((order) => !status || order.status === status)
    .toSorted((a, b) => b.placedAt.localeCompare(a.placedAt))
    .map(withTotals);
}

export function getOrder(id) {
  const order = orders.find((item) => item.id === id);
  return order && withTotals(order);
}

export function createOrder(input) {
  if (!input.email?.includes('@')) throw new RangeError('A valid email is needed.');
  if (!Array.isArray(input.items) || !input.items.length)
    throw new RangeError('An order needs at least one item.');
  const order = {
    id: 'ord_' + (1000 + orders.length + 1),
    customer: input.customer,
    email: input.email,
    status: 'placed',
    placedAt: new Date().toISOString(),
    shipTo: input.shipTo,
    items: input.items,
  };
  orders.push(order);
  return withTotals(order);
}

export { STATUSES };
