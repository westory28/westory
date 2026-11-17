import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('../src/lib/wisStockCandles.ts', import.meta.url));
const bundle = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm' });
const { buildWisStockCandles: candles } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const at = value => Date.parse(value + '+09:00');
const point = (time, price) => ({ atMs: at(time), price });
const values = candle => [candle.open, candle.high, candle.low, candle.close, candle.observations];

const observed = [point('2026-11-16T09:00:00', 100), point('2026-11-16T09:10:00', 140), point('2026-11-16T09:20:00', 80), point('2026-11-16T09:30:00', 120), point('2026-11-16T11:00:00', 90)];
const hourly = candles(observed, 'hour');
assert.equal(hourly.length, 2, 'No synthetic candle at 10:00');
assert.deepEqual(values(hourly[0]), [100, 140, 80, 120, 4]);
assert.deepEqual(values(hourly[1]), [90, 90, 90, 90, 1]);
assert.equal(hourly[1].startAtMs - hourly[0].startAtMs, 7_200_000);
assert.equal(hourly[0].firstAtMs, observed[0].atMs);
assert.equal(hourly[0].lastAtMs, observed[3].atMs);
assert.deepEqual(candles([...observed].reverse(), 'day').map(values), [[100, 140, 80, 90, 5]], 'Open/close follow timestamps, not input order');

const midnight = candles([point('2026-11-15T23:59:59.999', 100), point('2026-11-16T00:00:00', 200)], 'day');
assert.deepEqual(midnight.map(c => c.startAtMs), [at('2026-11-15T00:00:00'), at('2026-11-16T00:00:00')]);
assert.equal(midnight[0].endAtMs, midnight[1].startAtMs);
const monday = candles([point('2026-11-15T23:59:59.999', 100), point('2026-11-16T00:00:00', 200), point('2026-11-22T23:59:59.999', 300)], 'week');
assert.deepEqual(monday.map(c => c.startAtMs), [at('2026-11-09T00:00:00'), at('2026-11-16T00:00:00')]);
assert.deepEqual(values(monday[1]), [200, 300, 200, 300, 2]);

assert.deepEqual(candles([], 'day'), []);
assert.deepEqual(values(candles([point('2026-11-16T09:00:00', 12.345), point('2026-11-16T10:00:00', 12.345)], 'day')[0]), [12.345, 12.345, 12.345, 12.345, 2]);
const fractional = candles([point('2026-11-16T09:00:00', 1000.125), point('2026-11-16T10:00:00', 999.999), point('2026-11-16T11:00:00', 1001.456)], 'day')[0];
assert.deepEqual(values(fractional), [1000.125, 1001.456, 999.999, 1001.456, 3]);
const rolling = [point('2026-11-15T09:00:00', 900), point('2026-11-15T13:00:00', 110), point('2026-11-16T12:00:00', 120)];
const cutoff = rolling.at(-1).atMs - 86_400_000;
assert.deepEqual(candles(rolling.filter(p => p.atMs >= cutoff), 'day').map(values), [[110, 110, 110, 110, 1], [120, 120, 120, 120, 1]], 'Partial first bucket includes only the selected rolling window');
for (const interval of ['hour', 'day', 'week']) {
  const extremes = candles([{ atMs: 0, price: 1 }, { atMs: 8_640_000_000_000_000, price: Number.MAX_SAFE_INTEGER }], interval);
  assert(extremes.every(c => Object.values(c).every(Number.isFinite)));
  assert.equal(extremes.at(-1).endAtMs, 8_640_000_000_000_000);
}
console.log('PASS: observed OHLC, KST hour/day/Monday-week boundaries, empty gaps, single/flat/decimal data, partial windows and extreme dates.');
