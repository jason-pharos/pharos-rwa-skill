import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders } from '../src/logic/reminders.ts';

const mk = (vault, ap) => ({ vault, shares: '1', nav: 1, currentValue: 1, estimated: true, assumptions: {}, principal: 1, realizedYield: 0, depositedDurationDays: 1, lockEnd: '', expectedTotalYield: 0, actionPeriod: ap });

test('open and closing soon', () => {
  const r = buildReminders([mk('APC3M', { source: 'config', isOpen: true, opensInDays: null, closesInDays: 3, stale: false })]);
  assert.equal(r[0].urgency, 'closing-soon');
});
test('opening soon', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 5, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'opening-soon');
});
test('future', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 40, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'future');
});
test('unavailable → unknown', () => {
  const r = buildReminders([mk('APC3M', { source: 'unavailable', isOpen: false, opensInDays: null, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'unknown');
});
