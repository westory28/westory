import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/pages/teacher/components/points/wisStockInvestmentReturns.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { topWisStockHoldingReturns: top, wisStockReturnObservations: history } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
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
const observed = [
  {atMs: 3000, holdingValue: 900, holdingCostBasis: 1000},
  {atMs: 1000, holdingValue: 1100, holdingCostBasis: 1000},
  {atMs: 2000, holdingValue: null, holdingCostBasis: null},
  {atMs: 4000, holdingValue: 0, holdingCostBasis: 0},
  {atMs: 5000, holdingValue: 0, holdingCostBasis: 1000},
];
const original = structuredClone(observed);
assert.deepEqual(history(observed).map(p=>[p.atMs,p.returnPercent]), [[1000,10],[2000,null],[3000,-10],[4000,null],[5000,-100]]);
assert.deepEqual(observed, original, 'history input is immutable');
assert.deepEqual(history([...observed, {atMs:1000,holdingValue:1200,holdingCostBasis:1000}]).map(p=>p.returnPercent), [20,null,-10,null,-100]);
assert.deepEqual(history([{atMs:0,holdingValue:1,holdingCostBasis:1}, {atMs:1000,holdingValue:Infinity,holdingCostBasis:1}, {atMs:1000,holdingValue:1,holdingCostBasis:null}]), []);
console.log('Investment holding returns: 12 groups passed; zero reads/writes.');
