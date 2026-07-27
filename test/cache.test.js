import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeCache, readCache } from '../src/util/cache.ts';

test('write then read within ttl', () => {
  writeCache('unit-test-x', { a: 1 });
  assert.deepEqual(readCache('unit-test-x', 3600), { a: 1 });
});
test('expired returns null', () => {
  writeCache('unit-test-y', { a: 2 });
  assert.equal(readCache('unit-test-y', -1), null);
});
test('missing returns null', () => {
  assert.equal(readCache('unit-test-missing-zzz', 3600), null);
});
