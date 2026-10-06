import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysBetween, formatInvoiceDate } from '../src/dates.js';

test('an invoice date is the calendar day of the order', () => {
  assert.equal(formatInvoiceDate('2025-03-14T10:30:00Z'), '2025-03-14');
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2025-03-01T08:00:00Z', '2025-03-04T07:00:00Z'), 2);
});
