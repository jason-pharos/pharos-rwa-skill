import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegistry } from '../src/config/remoteConfig.ts';
import { DEFAULT_REGISTRY } from '../src/config/registry.ts';

test('override merges by id, keeps unknown defaults intact', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, {
    version: 1,
    vaults: [{ id: 'APC3M', apyFallback: 0.2 }],
  });
  const apc = merged.find((v) => v.id === 'APC3M');
  const pa = merged.find((v) => v.id === 'pALPHA');
  assert.equal(apc.apyFallback, 0.2);
  assert.equal(apc.coreVault, '0xD0428799FbC35557834d33121BA4472692c8908a'); // untouched
  assert.equal(pa.apyFallback, 0.14); // untouched
});

test('malformed override falls back to base', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, null);
  assert.equal(merged.length, DEFAULT_REGISTRY.length);
});
