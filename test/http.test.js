import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../src/util/http.ts';

test('rejects non-https', async () => {
  await assert.rejects(() => fetchJson('http://example.com'), /https/i);
});
