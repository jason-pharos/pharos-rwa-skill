import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, headersFor } from '../src/util/http.ts';

test('rejects non-https', async () => {
  await assert.rejects(() => fetchJson('http://example.com'), /https/i);
});

test('headersFor Pharos API includes origin and referer', () => {
  const headers = headersFor('https://api.pharosnetwork.xyz/omni_port/harbor/summary');
  assert.equal(headers['accept'], 'application/json');
  assert.equal(headers['origin'], 'https://port.pharos.xyz');
  assert.equal(headers['referer'], 'https://port.pharos.xyz/');
});

test('headersFor other hosts excludes Pharos headers', () => {
  const headers = headersFor('https://raw.githubusercontent.com/example');
  assert.equal(headers['accept'], 'application/json');
  assert.equal(headers['origin'], undefined);
  assert.equal(headers['referer'], undefined);
});
