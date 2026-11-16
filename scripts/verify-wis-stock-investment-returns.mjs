import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/pages/teacher/components/points/wisStockInvestmentReturns.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { topWisStockHoldingReturns: top } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const row = (id, cost, pnl, extra = {}) => ({ studentKey: String(id), grade: '3', classNumber: '1',
  studentNumber: String(id), displayName: `학생${id}`, holdingCount: cost ? 1 : 0,
  holdingCostBasis: cost, holdingValue: cost + pnl, unrealizedPnl: pnl, stockCash: 10000,
  reservedCash: 500, realizedPnl: 99999, totalAssets: 10000 + cost + pnl, ...extra });
const inputs = [row(1, 100, 10), row(2, 200, 50), row(3, 1000, 200), row(4, 400, -100),
  row(5, 100, 0), row(6, 0, 0), row(7, 100, -100)];
const snapshot = structuredClone(inputs);
assert.deepEqual(top(inputs).map(item => [item.studentKey, item.returnPercent]), [
  ['2', 25], ['3', 20], ['1', 10], ['5', 0], ['4', -25],
]);
assert.deepEqual(inputs, snapshot, 'sort must not mutate subscribed projection');
assert.deepEqual(top(inputs.map(item => ({ ...item, stockCash: 0, realizedPnl: -99999 }))),
  top(inputs).map(item => ({ ...item, stockCash: 0, realizedPnl: -99999 })), 'cash and realized PnL cannot affect holdings ROI');
assert.deepEqual(top([row(3, 300, 30), row(2, 200, 20), row(1, 100, 10)]).map(item => item.studentKey), ['1', '2', '3']);
assert.deepEqual(top([row(1, 0, 0)]), []);
assert.deepEqual(top([]), []);
assert.deepEqual(top([row(1, 100, -100), row(2, 100, -10)]).map(item => item.returnPercent), [-10, -100]);
const maximum = Number.MAX_SAFE_INTEGER;
assert.deepEqual(top([row(1, maximum, -1), row(2, maximum - 1, -1)]).map(item => item.studentKey), ['1', '2'], 'exact fraction ranking at safe integer boundary');
assert(top([row(1, 1, maximum - 1)]).every(item => Number.isFinite(item.returnPercent)));
console.log('Investment holding returns: 8 groups passed; zero reads/writes.');
