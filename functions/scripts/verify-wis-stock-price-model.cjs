const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { nextWisStockModelPrice, sampleWisStockPriceStep, wisStockPriceModelAnchor } = require('../wisStockPriceModel');
const HOUR = 3600000, FIRST = Date.parse('2026-11-16T00:00:00Z');
const stock = (patch = {}) => ({ id: 'stock_000000000000000000000001', price: 10000,
  priceModel: { version: 1, anchorAtMs: FIRST, anchorPrice: 10000 }, history: [{ atMs: FIRST, price: 10000 }],
  settings: { initialPrice: 10000, minimumPrice: 1, maximumPrice: 1000000, volatilityBps: 300,
    trendBps: 0, intervalHours: 1, growthProfile: 'HISTORICAL', ...patch } });
const shaSampler = seed => key => Number.parseInt(createHash('sha256').update(`${seed}\n${key}`).digest('hex').slice(0, 8), 16) / 4294967296;
function correlation(a, b) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const am = mean(a), bm = mean(b);
  return a.reduce((sum, value, i) => sum + (value - am) * (b[i] - bm), 0)
    / Math.sqrt(a.reduce((sum, value) => sum + (value - am) ** 2, 0) * b.reduce((sum, value) => sum + (value - bm) ** 2, 0));
}
test('pure shared model is deterministic, scope/seed-specific and never mutates its input', () => {
  const s = stock(), before = JSON.stringify(s), slot = Math.floor(FIRST / HOUR);
  const a = Array.from({ length: 100 }, (_, i) => nextWisStockModelPrice(s, '2026-2', slot + i, 'seed-a'));
  assert.deepEqual(a, Array.from({ length: 100 }, (_, i) => nextWisStockModelPrice(s, '2026-2', slot + i, 'seed-a')));
  assert.notDeepEqual(a, Array.from({ length: 100 }, (_, i) => nextWisStockModelPrice(s, '2026-1', slot + i, 'seed-a')));
  assert.notDeepEqual(a, Array.from({ length: 100 }, (_, i) => nextWisStockModelPrice(s, '2026-2', slot + i, 'seed-b')));
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(wisStockPriceModelAnchor(s), s.priceModel);
  assert.deepEqual(wisStockPriceModelAnchor({ ...s, priceModel: undefined }), s.priceModel);
});
test('regimes persist, returns are correlated, volatility clusters and shocks are uncommon', () => {
  const s = stock(), sampler = shaSampler('shape-check');
  const steps = Array.from({ length: 2400 }, (_, i) => sampleWisStockPriceStep(s, '2026-2', i, '', sampler));
  const moves = steps.map(step => step.movementBps), absolute = moves.map(Math.abs);
  assert.deepEqual(new Set(steps.map(step => step.regime)), new Set(['RISING', 'FALLING', 'CORRECTION', 'SIDEWAYS']));
  assert(correlation(moves.slice(1), moves.slice(0, -1)) > 0.3);
  assert(correlation(absolute.slice(1), absolute.slice(0, -1)) > 0.2);
  assert(steps.filter((step, i) => i && step.regime === steps[i - 1].regime).length / steps.length > 0.9);
  assert(Math.max(...steps.map(step => step.volatilityScale)) > 1.2);
  assert(Math.min(...steps.map(step => step.volatilityScale)) < 0.5);
  const strong = steps.filter(step => Math.abs(step.shockBps) > 400).length;
  assert(strong > 5 && strong < steps.length * 0.08);
});
test('a single news impulse decays across five slots without an automatic opposite spike', () => {
  const sampler = key => key === 'shock:100:occurs' ? 0 : key.endsWith(':occurs') ? 0.9 : 0.6;
  const effects = Array.from({ length: 7 }, (_, age) => sampleWisStockPriceStep(stock(), '2026-2', 100 + age, '', sampler).shockBps);
  assert(effects[0] > 0); assert.deepEqual(effects.slice(5), [0, 0]);
  for (let i = 1; i < 5; i++) assert(effects[i] > 0 && effects[i] < effects[i - 1]);
});
test('VALUE has a growing reference beyond six weeks and multi-seed long-run growth with short losses', () => {
  const ratios = [], shortRatios = [], decreases = [];
  for (let seed = 0; seed < 64; seed++) {
    const s = stock({ growthProfile: 'VALUE' }), sampler = shaSampler(`value-seed-${seed}`);
    let down = 0;
    for (let day = 0; day < 168; day++) {
      if (day % 7 > 4) continue;
      const opening = s.price;
      for (let hour = 0; hour < 7; hour++) {
        const at = FIRST + (day * 24 + hour) * HOUR;
        const proposed = nextWisStockModelPrice(s, '2026-2', Math.floor(at / HOUR), '', sampler);
        const price = Math.max(Math.ceil(opening * 0.7), Math.min(Math.floor(opening * 1.3), proposed));
        if (price < s.price) down++;
        s.price = price; s.history.push({ atMs: at, price }); s.history = s.history.slice(-120);
      }
      if (day === 39) shortRatios.push(s.price / 10000);
    }
    decreases.push(down); ratios.push(s.price / 10000);
  }
  ratios.sort((a, b) => a - b);
  assert(ratios[32] > 1.3 && ratios[32] < 2.0);
  assert(ratios.filter(ratio => ratio > 1).length >= 58);
  assert(shortRatios.some(ratio => ratio < 1));
  assert(Math.min(...decreases) > 200);
  const s = stock({ growthProfile: 'VALUE' });
  const six = sampleWisStockPriceStep(s, '2026-2', Math.floor(FIRST / HOUR) + 42 * 24, 'reference').referencePrice;
  const twentyFour = sampleWisStockPriceStep(s, '2026-2', Math.floor(FIRST / HOUR) + 168 * 24, 'reference').referencePrice;
  assert(twentyFour > six && six > 10000);
  console.log(JSON.stringify({ valueSeeds: 64, horizonWeeks: 24, medianRatio: ratios[32], minRatio: ratios[0], maxRatio: ratios[63], shortLosses: shortRatios.filter(ratio => ratio < 1).length, minimumDownTicks: Math.min(...decreases) }));
});
test('VALUE can fall to the daily lower limit, and a price below its reference has recovery pressure', () => {
  const s = stock({ growthProfile: 'VALUE', volatilityBps: 1000 });
  const sample = sampleWisStockPriceStep(s, '2026-2', Math.floor(FIRST / HOUR), '', () => 0);
  assert.equal(sample.movementBps, -3000);
  assert.equal(nextWisStockModelPrice(s, '2026-2', Math.floor(FIRST / HOUR), '', () => 0), 7000);
  const at = Math.floor(FIRST / HOUR) + 90 * 24, middle = stock({ growthProfile: 'VALUE' });
  const fallen = { ...middle, price: 7000 }, high = { ...middle, price: 20000 };
  assert(sampleWisStockPriceStep(fallen, '2026-2', at, 'same').movementBps > sampleWisStockPriceStep(high, '2026-2', at, 'same').movementBps);
});
test('explicit zero volatility/trend stops both profiles; integer bounds and invalid inputs fail closed', () => {
  for (const growthProfile of ['HISTORICAL', 'VALUE']) {
    for (const slot of [0, 100, 1000000000]) assert.equal(nextWisStockModelPrice(stock({ growthProfile, volatilityBps: 0 }), '2026-2', slot), 10000);
    assert.equal(nextWisStockModelPrice(stock({ growthProfile, volatilityBps: 0, trendBps: 300 }), '2026-2', 0), 10300);
  }
  for (const price of [1, 2, 999999, 1000000]) {
    const s = { ...stock({ volatilityBps: 1000 }), price };
    for (let slot = 0; slot < 100; slot++) {
      const result = nextWisStockModelPrice(s, '2026-2', slot, 'limits');
      assert(Number.isSafeInteger(result) && result >= 1 && result <= 1000000);
    }
  }
  for (const invalid of [NaN, Infinity, -0.1, 1]) assert.throws(() => nextWisStockModelPrice(stock(), '2026-2', 0, '', () => invalid), RangeError);
  assert.throws(() => nextWisStockModelPrice(stock({ growthProfile: 'guaranteed' }), '2026-2', 0), RangeError);
});

test('VALUE growth direction also holds across low/high configured volatility rather than one chosen seed', () => {
  for (const volatilityBps of [120, 600, 1000]) {
    const ratios = [];
    for (let seed = 0; seed < 24; seed++) {
      const s = stock({ growthProfile: 'VALUE', volatilityBps }), sampler = shaSampler(`range-${seed}`);
      for (let day = 0; day < 168; day++) {
        if (day % 7 > 4) continue;
        const opening = s.price;
        for (let hour = 0; hour < 7; hour++) {
          const at = FIRST + (day * 24 + hour) * HOUR;
          s.price = Math.max(Math.ceil(opening * 0.7), Math.min(Math.floor(opening * 1.3),
            nextWisStockModelPrice(s, '2026-2', Math.floor(at / HOUR), '', sampler)));
          s.history.push({ atMs: at, price: s.price }); s.history = s.history.slice(-120);
        }
      }
      ratios.push(s.price / 10000);
    }
    ratios.sort((a, b) => a - b);
    assert(ratios[12] > 1.1, `volatility ${volatilityBps}: ${ratios[12]}`);
    assert(ratios.filter(ratio => ratio > 1).length >= 20);
  }
});
