import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RPC, DEFAULT_CHAIN_ID, DEFAULT_ETHEREUM_RPC,
  makeProvider, resolveSourceRpc, sumSourceBalances,
} from '../src/sources/chain.ts';

test('defaults are pinned', () => {
  assert.equal(DEFAULT_RPC, 'https://rpc.pharos.xyz');
  assert.equal(DEFAULT_CHAIN_ID, 1672);
  assert.equal(DEFAULT_ETHEREUM_RPC, 'https://ethereum-rpc.publicnode.com');
});
test('provider constructs without throwing', () => {
  const p = makeProvider(DEFAULT_RPC, DEFAULT_CHAIN_ID);
  assert.ok(p);
});

test('resolveSourceRpc uses env override when set', () => {
  const src = { chainId: 1, rpcUrlEnv: 'TEST_ETH_RPC_XYZ', rpcUrl: 'https://default.example', token: '0x0' };
  delete process.env.TEST_ETH_RPC_XYZ;
  assert.equal(resolveSourceRpc(src), 'https://default.example');
  process.env.TEST_ETH_RPC_XYZ = 'https://override.example';
  assert.equal(resolveSourceRpc(src), 'https://override.example');
  delete process.env.TEST_ETH_RPC_XYZ;
});

test('resolveSourceRpc: per-chain override beats env and default', () => {
  const src = { chainId: 1672, rpcUrlEnv: 'TEST_PHAROS_RPC_XYZ', rpcUrl: 'https://default.example', token: '0x0' };
  process.env.TEST_PHAROS_RPC_XYZ = 'https://env.example';
  // explicit per-chain override (e.g. --rpc) wins over env + default
  assert.equal(resolveSourceRpc(src, { 1672: 'https://flag.example' }), 'https://flag.example');
  // override for a different chain does NOT apply
  assert.equal(resolveSourceRpc(src, { 1: 'https://other.example' }), 'https://env.example');
  delete process.env.TEST_PHAROS_RPC_XYZ;
});

test('sumSourceBalances sums same-decimals sources (pALPHA case: 6+6)', () => {
  const ok = [
    { chainId: 1672, token: '0xa', raw: 100_000000n, decimals: 6, human: '100' },
    { chainId: 1, token: '0xb', raw: 50_000000n, decimals: 6, human: '50' },
  ];
  const { totalRaw, decimals } = sumSourceBalances(ok, 6);
  assert.equal(decimals, 6);
  assert.equal(totalRaw, 150_000000n); // 150 shares total
});

test('sumSourceBalances normalizes differing decimals to first source', () => {
  const ok = [
    { chainId: 1672, token: '0xa', raw: 1_000000n, decimals: 6, human: '1' },   // 1.0
    { chainId: 1, token: '0xb', raw: 2_000000000000000000n, decimals: 18, human: '2' }, // 2.0 → scaled down to 6
  ];
  const { totalRaw, decimals } = sumSourceBalances(ok, 6);
  assert.equal(decimals, 6);
  assert.equal(totalRaw, 3_000000n); // 1 + 2 = 3 shares at 6 decimals
});

test('sumSourceBalances with empty ok returns 0 and fallback decimals', () => {
  const { totalRaw, decimals } = sumSourceBalances([], 6);
  assert.equal(totalRaw, 0n);
  assert.equal(decimals, 6);
});
