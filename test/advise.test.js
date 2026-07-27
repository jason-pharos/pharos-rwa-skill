import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvice } from '../src/logic/advise.ts';

const market = [
  { name: 'APC3M', apy: '14%', apyValue: 0.14, tvl: 44000000, minimumInvestment: ['2 USD'], assetClass: 'Fixed Income & Credit', topPick: true, icon: '' },
  { name: 'pALPHA', apy: '14%', apyValue: 0.14, tvl: 16000000, minimumInvestment: ['0.1 USD'], assetClass: 'Fixed Income & Credit', topPick: false, icon: '' },
  { name: 'GPCI', apy: '12%', apyValue: 0.12, tvl: 15000000, minimumInvestment: ['0 USD'], assetClass: 'Fixed Income & Credit', topPick: false, icon: '' },
];
const positions = [{ vault: 'APC3M', shares: '100', nav: 1.03, currentValue: 103, estimated: true, assumptions: {}, principal: 100, realizedYield: 3, depositedDurationDays: 7, lockEnd: '', expectedTotalYield: 4, actionPeriod: { source: 'config', isOpen: false, opensInDays: null, closesInDays: null, stale: false } }];

test('gapVaults excludes held, includes others', () => {
  const b = buildAdvice(market, positions);
  assert.deepEqual(b.heldVaultIds, ['APC3M']);
  const gapNames = b.gapVaults.map((v) => v.name).sort();
  assert.deepEqual(gapNames, ['GPCI', 'pALPHA']);
  assert.equal(b.topPicks.length, 1);
  assert.equal(b.topPicks[0].name, 'APC3M');
});
