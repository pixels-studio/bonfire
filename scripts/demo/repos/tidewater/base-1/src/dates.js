/** The date printed on an invoice, as YYYY-MM-DD. */
export function formatInvoiceDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Whole days between two timestamps, rounded down. */
export function daysBetween(from, to) {
  return Math.floor((new Date(to) - new Date(from)) / 86_400_000);
}
