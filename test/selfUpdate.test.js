import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/update/selfUpdate.ts';

test('sha256 of "abc" is known digest', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
