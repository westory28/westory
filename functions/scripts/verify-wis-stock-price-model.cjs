const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { nextWisStockModelPrice, sampleWisStockPriceStep, wisStockPriceModelAnchor,
  wisStockSector, sampleWisStockMarketFactors, wisStockPreviousMarketReturn, wisStockMarketStress } = require('../wisStockPriceModel');
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

test('market limits scale both directions before rounding while preserving the default path and VALUE reference', () => {
  for (const growthProfile of ['HISTORICAL', 'VALUE']) {
    const s = stock({ growthProfile }), before = JSON.stringify(s), sampler = shaSampler('market-scale');
    let rises = 0, falls = 0;
    for (let slot = 0; slot < 240; slot++) {
      const base = sampleWisStockPriceStep(s, '2026-2', slot, '', sampler);
      assert.deepEqual(sampleWisStockPriceStep(s, '2026-2', slot, '', sampler, 1000), base);
      if (base.movementBps > 0) rises++;
      if (base.movementBps < 0) falls++;
      for (const limit of [1, 500, 2000, 3000, 6000]) {
        const scale = limit / 1000;
        const step = sampleWisStockPriceStep(s, '2026-2', slot, '', sampler, limit);
        assert(Math.abs(step.movementBps - base.movementBps * scale) <= 0.5 * scale + 0.5);
        assert.equal(step.referencePrice, base.referencePrice);
        assert.equal(step.regime, base.regime);
        assert.equal(step.shockBps, base.shockBps * scale);
        assert.equal(nextWisStockModelPrice(s, '2026-2', slot, '', sampler, limit), 10000 + step.movementBps);
      }
    }
    assert(rises > 10 && falls > 10);
    assert.equal(JSON.stringify(s), before);
  }
});

test('market scaling preserves explicit manual drift, validates its range, and bounds extreme moves', () => {
  for (const growthProfile of ['HISTORICAL', 'VALUE']) {
    for (const trendBps of [-300, 0, 300]) for (const limit of [1, 500, 1000, 6000]) {
      assert.equal(nextWisStockModelPrice(stock({ growthProfile, volatilityBps: 0, trendBps }), '2026-2', 0, '', undefined, limit), 10000 + trendBps);
    }
  }
  for (const limit of [0, 6001, 1.5, NaN, Infinity, null]) {
    assert.throws(() => nextWisStockModelPrice(stock({ volatilityBps: 0 }), '2026-2', 0, '', undefined, limit), RangeError);
  }
  for (const side of [0, 0.9]) {
    const sampler = key => key.endsWith(':occurs') ? 0 : key.endsWith(':side') ? side : 0.999;
    for (const limit of [500, 1000, 2000, 6000]) {
      const s = stock({ volatilityBps: 1000 }), cap = Math.min(6000, 3000 * limit / 1000);
      const step = sampleWisStockPriceStep(s, '2026-2', 100, '', sampler, limit);
      assert.equal(Math.abs(step.movementBps), cap);
      assert.equal(Math.sign(step.movementBps), side ? 1 : -1);
      assert.equal(nextWisStockModelPrice({ ...s, price: 999999 }, '2026-2', 100, '', sampler, limit) <= 1000000, true);
      assert.equal(nextWisStockModelPrice({ ...s, price: 1 }, '2026-2', 100, '', sampler, limit) >= 1, true);
    }
  }
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

test('catalog industry mapping links construction/steel and tech/electronics without relabeling historical companies', () => {
  const catalog = require('../wisStockCatalog.json');
  const classify = name => wisStockSector({ ...stock(), id: catalog.find(entry => entry.name === name).id });
  for (const name of ['움집홈즈', '한양건설', '인조인프라', '철든소재']) assert.equal(classify(name), 'CONSTRUCTION_STEEL');
  for (const name of ['담로링크', '별눈옵틱스', '고려베스트테크', '집현전일렉트로닉']) assert.equal(classify(name), 'TECH_ELECTRONICS');
  for (const name of ['매일증권', '해피인베스트먼트', '노론홀딩스', '상평페이']) assert.equal(classify(name), 'FINANCE');
  for (const name of ['돌끝테크', '농사직설푸드', '소힘모빌리티']) assert.equal(classify(name), 'OTHER');
  assert.equal(wisStockSector(stock({ name: '돌끝테크' })), 'OTHER');
  assert.equal(wisStockSector(stock({ name: '철든소재' })), 'CONSTRUCTION_STEEL');
  assert.equal(wisStockSector(stock({ name: '새제철' })), 'CONSTRUCTION_STEEL');
  assert.equal(wisStockSector(stock({ name: '새테크' })), 'TECH_ELECTRONICS');
  assert.equal(wisStockSector(stock({ name: '새은행' })), 'FINANCE');
  assert.equal(wisStockSector(stock({ name: '새테크', sector: '농업·식품' })), 'OTHER');
  assert.equal(catalog.filter(entry => wisStockSector({ ...stock(), id: entry.id }) === 'CONSTRUCTION_STEEL').length, 6);
  assert.equal(catalog.filter(entry => wisStockSector({ ...stock(), id: entry.id }) === 'TECH_ELECTRONICS').length, 4);
});

test('market and sector factors share calendar time across 1/6/24-hour instruments and retain scope boundaries', () => {
  const atMs = FIRST + 7 * HOUR, factors = [1, 6, 24].map(intervalHours => sampleWisStockMarketFactors(
    stock({ intervalHours, name: '새건설' }), '2026-2', Math.floor(atMs / (intervalHours * HOUR)), 'time-seed', { atMs }));
  assert.deepEqual(factors[0], factors[1]); assert.deepEqual(factors[1], factors[2]);
  const alignedAt = FIRST + 24 * HOUR;
  const aligned = [1, 6, 24].map(intervalHours => sampleWisStockMarketFactors(
    stock({ intervalHours, name: '새제철' }), '2026-2', alignedAt / (intervalHours * HOUR), 'time-seed'));
  assert.deepEqual(aligned[0], aligned[1]); assert.deepEqual(aligned[1], aligned[2]);
  assert.notDeepEqual(factors[0], sampleWisStockMarketFactors(stock({ name: '새건설' }), '2026-1', 0, 'time-seed', { atMs }));
  assert.notDeepEqual(factors[0], sampleWisStockMarketFactors(stock({ name: '새건설' }), '2026-2', 0, 'another-seed', { atMs }));
  assert.equal(factors[0].market, sampleWisStockMarketFactors(stock({ name: '새전자' }), '2026-2', 0, 'time-seed', { atMs }).market);
  for (const bad of [NaN, Infinity, -1]) assert.throws(() => sampleWisStockMarketFactors(stock(), '2026-2', 0, '', { atMs: bad }), RangeError);
  for (const bad of [NaN, Infinity, -0.1, 1]) assert.throws(() => sampleWisStockMarketFactors(stock(), '2026-2', 0, '', { sampler: () => bad }), RangeError);
});

test('private server samples produce stronger within-industry returns without forcing equal direction', () => {
  const { nextPrice } = require('../wisStocks');
  const catalog = require('../wisStockCatalog.json');
  const samples = ['한양건설', '철든소재', '고려베스트테크', '집현전일렉트로닉'].map(name => ({
    ...stock({ name }), id: catalog.find(entry => entry.name === name).id,
  }));
  const pairs = [], cross = [];
  for (let seed = 0; seed < 8; seed++) {
    const moves = samples.map(s => Array.from({ length: 2400 }, (_, slot) => nextPrice(s, '2026-2', slot, `sector-${seed}`) - 10000));
    const unrelated = correlation(moves[0], moves[2]); cross.push(unrelated);
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const related = correlation(moves[a], moves[b]); pairs.push(related);
      assert(related > 0.20 && related > unrelated + 0.15, `${seed}: related=${related}; different=${unrelated}`);
      const opposite = moves[a].filter((move, index) => move * moves[b][index] < 0).length;
      assert(opposite > 2400 * 0.15, 'Related stocks retain independent losses and gains');
      assert.notDeepEqual(moves[a], moves[b]);
    }
  }
  console.log(JSON.stringify({ sectorSeeds: 8, hourlySamplesPerSeed: 2400,
    linkedCorrelationRange: [Math.min(...pairs), Math.max(...pairs)], unrelatedCorrelationRange: [Math.min(...cross), Math.max(...cross)] }));
});

test('finance reacts more to the common market and to strictly prior committed index observations', () => {
  const atMs = FIRST + 3 * HOUR;
  const history = [{ atMs: FIRST, value: 1000 }, { atMs: FIRST + HOUR, value: 1050 },
    { atMs: FIRST + 3 * HOUR, value: 500 }, { atMs: FIRST + 4 * HOUR, value: 1 }];
  const index = { history }, before = JSON.stringify(index);
  assert(Math.abs(wisStockPreviousMarketReturn(index, atMs) - 500) < 0.000001);
  assert.equal(wisStockPreviousMarketReturn(undefined, atMs), 0);
  assert.equal(wisStockPreviousMarketReturn({ history: [history[0]] }, atMs), 0);
  assert.equal(JSON.stringify(index), before);
  const financial = stock({ name: '새증권' }), ordinary = stock({ name: '새식품' });
  const financialFactor = sampleWisStockMarketFactors(financial, '2026-2', 0, '', { atMs, sampler: () => 0.75 });
  const ordinaryFactor = sampleWisStockMarketFactors(ordinary, '2026-2', 0, '', { atMs, sampler: () => 0.75 });
  assert(financialFactor.contribution > ordinaryFactor.contribution * 2);
  const move = (s, priorMarketReturnBps) => sampleWisStockPriceStep(s, '2026-2', 100, '', () => 0.5, 1000,
    { atMs, priorMarketReturnBps, sampler: () => 0.5 }).movementBps;
  assert(move(financial, 500) > move(financial, 0)); assert(move(financial, 0) > move(financial, -500));
  assert.equal(move(ordinary, 500), move(ordinary, -500));
});

test('common volatility clusters and bounded selloff uncertainty decays without guaranteeing a rebound', () => {
  const index = { history: [{ atMs: FIRST, value: 1000 }, { atMs: FIRST + HOUR, value: 850 }] };
  const immediate = wisStockMarketStress(index, FIRST + 2 * HOUR), later = wisStockMarketStress(index, FIRST + 14 * HOUR);
  assert(immediate > 0 && immediate < 0.35); assert(later > 0 && later < immediate);
  assert.equal(wisStockMarketStress(index, FIRST + HOUR), 0, 'Same-tick observation is excluded');
  assert.equal(wisStockMarketStress(index, FIRST + 50 * HOUR), 0);
  assert.equal(wisStockMarketStress({ history: index.history.map((p, i) => ({ ...p, value: 1000 + i * 100 })) }, FIRST + 2 * HOUR), 0);
  const factors = Array.from({ length: 2400 }, (_, slot) => sampleWisStockMarketFactors(stock({ name: '새건설' }), '2026-2', slot, 'volatility'));
  const volatility = factors.map(f => f.volatilityScale);
  assert(correlation(volatility.slice(1), volatility.slice(0, -1)) > 0.95);
  assert(Math.min(...volatility) < 0.65 && Math.max(...volatility) > 1.5);
  for (const sampler of [() => 0.25, () => 0.75]) {
    const calm = sampleWisStockMarketFactors(stock({ name: '새건설' }), '2026-2', 0, '', { sampler });
    const stressed = sampleWisStockMarketFactors(stock({ name: '새건설' }), '2026-2', 0, '', { sampler, marketStress: immediate });
    assert(Math.abs(stressed.contribution) > Math.abs(calm.contribution));
    assert.equal(Math.sign(stressed.contribution), Math.sign(calm.contribution));
  }
  assert.equal(sampleWisStockPriceStep(stock({ name: '새증권', volatilityBps: 0, trendBps: 17 }), '2026-2', 0, '', undefined, 1000,
    { marketStress: immediate, priorMarketReturnBps: -1000, sampler: () => { throw Error('Must not sample a manually fixed price'); } }).movementBps, 17);
});

test('server prices are order-independent and only append a current observation after a missed interval', () => {
  const { advanceMarket, normalizeSettings, blankMarket } = require('../wisStocks');
  const atMs = FIRST + 25 * HOUR;
  const make = (id, name, extra = {}) => ({ ...stock(), id, settings: normalizeSettings({ ...stock({ name }).settings,
    description: '', period: '', automatic: true, ...extra }),
    updatedAtMs: FIRST, nextTickAtMs: FIRST + HOUR });
  const stocks = [make('a', '한양건설'), make('b', '새제철'), make('c', '새전자'), make('d', '새증권'),
    make('halt', '정지제철', { tradingStatus: 'HALTED' }), make('graduated', '졸업전자', { tradingStatus: 'GRADUATED' }),
    make('manual', '수동건설', { automatic: false })];
  const market = { ...blankMarket({ semesterId: '2026-2' }), stocks, priceSeed: 'a'.repeat(64),
    marketIndex: { history: [{ atMs: FIRST, value: 1000 }, { atMs: FIRST + HOUR, value: 900 }] } };
  const before = JSON.stringify(market), advanced = advanceMarket(market, atMs);
  const reordered = advanceMarket({ ...market, stocks: [...stocks].reverse() }, atMs);
  assert.deepEqual([...advanced.stocks].sort((a, b) => a.id.localeCompare(b.id)), [...reordered.stocks].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(JSON.stringify(market), before);
  assert.deepEqual(advanceMarket(market, atMs), advanced, 'Retry uses deterministic factors');
  assert.equal(advanceMarket(advanced, atMs), advanced, 'Already advanced interval remains a no-op');
  let changed = 0;
  for (let i = 0; i < stocks.length; i++) {
    const next = advanced.stocks[i], previous = stocks[i];
    assert.deepEqual(next.history.slice(0, previous.history.length), previous.history);
    assert.deepEqual(next.priceModel, previous.priceModel);
    if (i >= 4) assert.deepEqual(next, previous);
    if (next !== previous && !next.haltedUntilMs) {
      changed++;
      assert.equal(next.history.length, previous.history.length + 1);
      assert.equal(next.history.at(-1).atMs, atMs);
    }
  }
  assert(changed > 0);
});

test('CommonJS production bridge and ESM browser import expose the same pure pricing functions', async () => {
  const esm = await import('../wisStockPriceModel.mjs');
  assert.equal(esm.nextWisStockModelPrice, nextWisStockModelPrice);
  assert.equal(esm.sampleWisStockMarketFactors, sampleWisStockMarketFactors);
});
