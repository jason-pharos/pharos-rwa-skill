import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer } from '../src/update/checkVersion.ts';

test('newer patch', () => { assert.equal(isNewer('0.1.1', '0.1.0'), true); });
test('newer with v prefix', () => { assert.equal(isNewer('v1.0.0', '0.9.9'), true); });
test('equal not newer', () => { assert.equal(isNewer('1.2.3', '1.2.3'), false); });
test('older not newer', () => { assert.equal(isNewer('1.0.0', '1.1.0'), false); });
