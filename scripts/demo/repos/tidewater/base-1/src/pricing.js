const TAX_RATES = { US: 0.0725, CA: 0.05, GB: 0.2, DE: 0.19 };
const FREE_SHIPPING_FROM_CENTS = 6000;

export function lineTotal(item) {
  return item.qty * item.unitCents;
}

export function subtotal(order) {
  return order.items.reduce((sum, item) => sum + lineTotal(item), 0);
}

/** Orders of $60 or more ship free; otherwise the rate depends on the country. */
export function shippingCents(order) {
  if (subtotal(order) >= FREE_SHIPPING_FROM_CENTS) return 0;
  return order.shipTo.country === 'US' ? 595 : 1495;
}

export function taxCents(order) {
  const rate = TAX_RATES[order.shipTo.country] ?? 0;
  return Math.round(subtotal(order) * rate);
}

export function total(order) {
  return subtotal(order) + shippingCents(order) + taxCents(order);
}

export function formatMoney(cents) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}
