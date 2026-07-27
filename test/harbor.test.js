import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApy } from '../src/sources/harbor.ts';

test('parseApy plain percent', () => { assert.equal(parseApy('14%'), 0.14); });
test('parseApy target prefix', () => { assert.equal(parseApy('Target APY 8.5%'), 0.085); });
test('parseApy lowercase target', () => { assert.equal(parseApy('target APY 15%'), 0.15); });
test('parseApy unparseable', () => { assert.equal(parseApy(''), null); });
