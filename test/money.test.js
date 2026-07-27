import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits, toNumber } from '../src/util/money.ts';

test('formatUnits handles 6 decimals', () => {
  assert.equal(formatUnits(2165073507606n, 6), '2165073.507606');
});
test('toNumber large value stays finite', () => {
  assert.equal(toNumber(44181088470000n, 6), 44181088.47);
});
