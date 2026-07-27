import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoToSec, dayDiff, windowState } from '../src/util/time.ts';

test('isoToSec parses tz iso', () => {
  assert.equal(isoToSec('2026-07-20T00:00:00+08:00'), 1784476800);
});
test('windowState open', () => {
  const s = windowState(100, 200, 150);
  assert.equal(s.isOpen, true);
  assert.equal(s.closesInDays, 0);
});
test('windowState before start', () => {
  const s = windowState(1000000, 2000000, 0);
  assert.equal(s.isOpen, false);
  assert.ok(s.opensInDays > 0);
  assert.equal(s.stale, false);
});
test('windowState fully past is stale', () => {
  const s = windowState(100, 200, 5000);
  assert.equal(s.isOpen, false);
  assert.equal(s.stale, true);
});
