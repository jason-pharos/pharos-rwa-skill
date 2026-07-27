import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnvelope } from '../src/index.ts';

test('envelope ok true when no errors', () => {
  const e = makeEnvelope({ x: 1 }, []);
  assert.equal(e.ok, true);
  assert.deepEqual(e.data, { x: 1 });
  assert.ok(typeof e.generatedAt === 'string');
});
test('envelope ok false when errors present', () => {
  const e = makeEnvelope({ x: 1 }, [{ scope: 'APC3M', error: 'boom' }]);
  assert.equal(e.ok, false);
});
test('envelope carries updateAvailable when provided', () => {
  const e = makeEnvelope({}, [], { current: '0.1.0', latest: '0.2.0' });
  assert.equal(e.updateAvailable.latest, '0.2.0');
});
