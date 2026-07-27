import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider } from '../src/sources/chain.ts';

test('defaults are pinned', () => {
  assert.equal(DEFAULT_RPC, 'https://rpc.pharos.xyz');
  assert.equal(DEFAULT_CHAIN_ID, 1672);
});
test('provider constructs without throwing', () => {
  const p = makeProvider(DEFAULT_RPC, DEFAULT_CHAIN_ID);
  assert.ok(p);
});
