// Shared, bounded teaching simulation; not a market forecast or a return promise.
// No clocks, I/O, random global state, or persisted per-tick state are needed.
const HOUR = 3_600_000;
const DAY = HOUR * 24;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => value * value * (3 - 2 * value);

// The browser uses this reproducible synthetic sampler. The server injects a
// SHA-256 sampler keyed by its private market seed; this hash is not cryptography.
function previewSampler(seed) {
  return key => {
    let value = 2166136261;
    for (const char of `${seed}\n${key}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
}

export function wisStockPriceModelAnchor(stock) {
  if (stock.priceModel) return { ...stock.priceModel };
  const first = stock.history?.find(point => Number.isSafeInteger(point.atMs)
    && point.atMs >= 0 && Number.isSafeInteger(point.price) && point.price > 0);
  return { version: 1, anchorAtMs: first?.atMs ?? stock.updatedAtMs ?? 0,
    anchorPrice: first?.price ?? stock.price };
}

export function sampleWisStockPriceStep(stock, semesterId, slot, priceSeed = '', sampler) {
  const settings = stock.settings;
  if (!Number.isSafeInteger(slot) || slot < 0 || !Number.isSafeInteger(stock.price) || stock.price <= 0
    || !Number.isSafeInteger(settings.volatilityBps) || settings.volatilityBps < 0 || settings.volatilityBps > 1000
    || !Number.isSafeInteger(settings.trendBps) || Math.abs(settings.trendBps) > 300
    || ![1, 6, 24].includes(settings.intervalHours)
    || !['HISTORICAL', 'VALUE'].includes(settings.growthProfile ?? 'HISTORICAL')) {
    throw new RangeError('Invalid stock price model input');
  }
  const source = sampler || previewSampler(`${priceSeed}\n${semesterId}\n${stock.id}\nwispi-price-v2`);
  const unit = key => {
    const value = source(key);
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid price sample');
    return value;
  };
  // Explicit zero-volatility settings retain the teacher's exact constant drift.
  // In particular 0 volatility + 0 trend remains completely stationary for VALUE.
  if (settings.volatilityBps === 0) return { movementBps: settings.trendBps,
    regime: 'MANUAL', volatilityScale: 0, shockBps: 0, referencePrice: null };
  const bell = key => (unit(`${key}:a`) + unit(`${key}:b`) + unit(`${key}:c`)) * 2 / 3 - 1;
  const blend = (channel, span, value) => {
    const index = Math.floor(slot / span), progress = smooth((slot % span) / span);
    return value(`${channel}:${index - 1}`) * (1 - progress) + value(`${channel}:${index}`) * progress;
  };
  const regimeAt = key => {
    const choice = unit(`${key}:kind`);
    if (choice < 0.4) return { kind: 'SIDEWAYS', tilt: 0 };
    if (choice < 0.65) return { kind: 'RISING', tilt: 0.4 + unit(`${key}:tilt`) * 0.45 };
    if (choice < 0.9) return { kind: 'FALLING', tilt: -(0.4 + unit(`${key}:tilt`) * 0.45) };
    return { kind: 'CORRECTION', tilt: 0 };
  };
  const regimeIndex = Math.floor(slot / 24), phase = smooth((slot % 24) / 24);
  const before = regimeAt(`regime:${regimeIndex - 1}`), after = regimeAt(`regime:${regimeIndex}`);
  const tilt = before.tilt * (1 - phase) + after.tilt * phase;
  const regime = phase < 0.5 ? before.kind : after.kind;
  const volatilityScale = blend('volatility', 36, key => 0.4 + unit(key) ** 2 * 1.4);
  const slowNoise = blend('noise', 4, bell), fastNoise = bell(`detail:${slot}`);
  const recent = (stock.history || []).slice(-24).filter(point => Number.isSafeInteger(point.price) && point.price > 0);
  const average = recent.length ? recent.reduce((sum, point) => sum + point.price, 0) / recent.length : stock.price;
  const vol = settings.volatilityBps;
  let referencePrice = null, pull = 0, drift = settings.trendBps;
  if (settings.growthProfile === 'VALUE') {
    const anchor = wisStockPriceModelAnchor(stock);
    if (anchor.version !== 1 || !Number.isSafeInteger(anchor.anchorAtMs) || anchor.anchorAtMs < 0
      || !Number.isSafeInteger(anchor.anchorPrice) || anchor.anchorPrice <= 0) throw new RangeError('Invalid price anchor');
    const days = Math.max(0, (slot * settings.intervalHours * HOUR - anchor.anchorAtMs) / DAY);
    // A calendar-based reference continues beyond the six-week lesson. The
    // realised price may remain below it, lose money, or reach a daily lower bound.
    const growthBpsPerDay = clamp(vol * 0.08, 12, 40);
    referencePrice = clamp(anchor.anchorPrice * Math.exp(Math.min(20, days * growthBpsPerDay / 10000)),
      settings.minimumPrice, settings.maximumPrice);
    pull = clamp((referencePrice / stock.price - 1) * 10000 * 0.045, -vol * 0.45, vol * 0.45);
    drift += growthBpsPerDay / 7;
  } else if (regime === 'CORRECTION') {
    pull = clamp((average / stock.price - 1) * 10000 * 0.08, -vol * 0.3, vol * 0.3);
  }
  // Rare news has a multi-step effect, rather than a one-point spike followed by
  // an equal and opposite bounce. Each event impulse decays over five slots.
  let shockBps = 0;
  const weights = [1, 0.5, 0.25, 0.12, 0.06];
  for (let age = 0; age < weights.length; age++) {
    const eventSlot = slot - age;
    if (eventSlot >= 0 && unit(`shock:${eventSlot}:occurs`) < 0.012) {
      shockBps += (unit(`shock:${eventSlot}:side`) < 0.5 ? -1 : 1)
        * vol * (1.5 + unit(`shock:${eventSlot}:size`) * 1.25) * weights[age];
    }
  }
  const movementBps = Math.round(clamp(drift + pull
    + vol * volatilityScale * (0.5 * tilt + 0.42 * slowNoise + 0.1 * fastNoise) + shockBps, -3000, 3000));
  return { movementBps, regime, volatilityScale, shockBps, referencePrice };
}

export function nextWisStockModelPrice(stock, semesterId, slot, priceSeed = '', sampler) {
  const { minimumPrice, maximumPrice } = stock.settings;
  if (!Number.isSafeInteger(minimumPrice) || !Number.isSafeInteger(maximumPrice)
    || minimumPrice < 1 || maximumPrice < minimumPrice || maximumPrice > 1_000_000) {
    throw new RangeError('Invalid stock price bounds');
  }
  const { movementBps } = sampleWisStockPriceStep(stock, semesterId, slot, priceSeed, sampler);
  return clamp(Math.round(stock.price * (10000 + movementBps) / 10000), minimumPrice, maximumPrice);
}
