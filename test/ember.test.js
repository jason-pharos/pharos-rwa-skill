import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchEmberPositionValue } from '../src/sources/ember.ts';

const VAULT_ID = '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f';
const ROW = { vaultId: VAULT_ID, positionValueUsdE9: '1000000000', totalYieldUsdE9: '0', realizedYieldUsdE9: '0', unrealizedYieldUsdE9: '0', shares: '1', status: 'SYNC' };

/** Stub Ember API; resolves with the request URLs it saw. */
async function withStubApi(handler, run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(handler(req)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = process.env.PHAROS_API_BASE;
  process.env.PHAROS_API_BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    return { result: await run(), seen };
  } finally {
    if (prev === undefined) delete process.env.PHAROS_API_BASE; else process.env.PHAROS_API_BASE = prev;
    await new Promise((r) => server.close(r));
  }
}

test('address is checksummed — the API returns [] for a lower-cased address', async () => {
  const { result, seen } = await withStubApi(() => [ROW], () =>
    fetchEmberPositionValue('0x68c8c1b8ca4c82b922675b25b8e1867b5c3d0fb6', VAULT_ID));
  assert.ok(seen[0].includes('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6'), seen[0]);
  assert.ok(seen[0].includes(`vaultId=${VAULT_ID}`), seen[0]);
  assert.equal(result.positionValueUsdE9, '1000000000');
});

test('no position in the vault → null', async () => {
  const { result } = await withStubApi(() => [], () =>
    fetchEmberPositionValue('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6', VAULT_ID));
  assert.equal(result, null);
});

test('another vault in the response is never attributed to this one', async () => {
  const { result } = await withStubApi(() => [{ ...ROW, vaultId: 'some-other-vault' }], () =>
    fetchEmberPositionValue('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6', VAULT_ID));
  assert.equal(result, null);
});
