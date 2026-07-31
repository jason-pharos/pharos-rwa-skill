import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchR25Holdings } from '../src/sources/r25.ts';

/**
 * The R25 client used to return null for every kind of failure, which made an
 * outage indistinguishable from a clock-skewed host: the API validates
 * `x-timestamp` and answers 401 "Timestamp invalid" on EVERY call when the
 * machine's clock has drifted, and that reason never reached the caller. These
 * tests pin the reason to the thrown message.
 *
 * Each test restores globalThis.fetch itself; the client's internal rate
 * limiter (1.2s minimum interval) is why these use a single call apiece.
 */
function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => { globalThis.fetch = original; });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('a clock-skew 401 surfaces the API reason, not a bare null', async () => {
  await withFetch(
    async () => jsonResponse({ code: 'R0003_00001', success: false, message: 'Timestamp invalid', data: null }, 401),
    async () => {
      await assert.rejects(
        fetchR25Holdings('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6'),
        (e) => {
          assert.match(e.message, /Timestamp invalid/);
          assert.match(e.message, /R0003_00001/);
          return true;
        },
      );
    },
  );
});

test('a rate-limit rejection surfaces its reason too', async () => {
  await withFetch(
    async () => jsonResponse({ code: 'R0005_00001', success: false, message: 'System busy', data: null }, 200),
    async () => {
      await assert.rejects(
        fetchR25Holdings('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6'),
        /System busy/,
      );
    },
  );
});

test('a timeout says so and names the endpoint', async () => {
  await withFetch(
    async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); },
    async () => {
      await assert.rejects(
        fetchR25Holdings('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6'),
        (e) => {
          assert.match(e.message, /portfolio\/holdings/);
          assert.match(e.message, /no response within/);
          return true;
        },
      );
    },
  );
});

test('a success returns the data payload', async () => {
  await withFetch(
    async () => jsonResponse({ code: 'R9999_9999', success: true, message: 'Success', data: [{ vaultId: 'APC3M' }] }),
    async () => {
      const holdings = await fetchR25Holdings('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6');
      assert.deepEqual(holdings, [{ vaultId: 'APC3M' }]);
    },
  );
});

test('an empty holdings list is data, not a failure', async () => {
  // The real answer for an address with no R25 positions — it must not be
  // mistaken for an outage and must not throw.
  await withFetch(
    async () => jsonResponse({ code: 'R9999_9999', success: true, message: 'Success', data: [] }),
    async () => {
      assert.deepEqual(await fetchR25Holdings('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6'), []);
    },
  );
});
