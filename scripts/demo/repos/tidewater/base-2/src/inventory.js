const stock = new Map([
  ['GUJI-250', { name: 'Ethiopia Guji, 250 g', roasted: 38, greenKg: 42 }],
  ['HUILA-250', { name: 'Colombia Huila, 250 g', roasted: 54, greenKg: 60 }],
  ['HUILA-1K', { name: 'Colombia Huila, 1 kg', roasted: 12, greenKg: 60 }],
  ['SUMATRA-250', { name: 'Sumatra Mandheling, 250 g', roasted: 7, greenKg: 18 }],
  ['DECAF-250', { name: 'Swiss Water Decaf, 250 g', roasted: 0, greenKg: 9 }],
]);

export function listStock() {
  return [...stock].map(([sku, item]) => ({ sku, ...item }));
}

/** Takes roasted bags off the shelf; throws when there are too few. */
export function reserve(sku, qty) {
  const item = stock.get(sku);
  if (!item) throw new RangeError('Unknown SKU ' + sku + '.');
  if (item.roasted < qty) throw new RangeError('Only ' + item.roasted + ' of ' + sku + ' left.');
  item.roasted -= qty;
}
