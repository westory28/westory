import catalog from './wisStockCatalog.json' with { type: 'json' };

const HOUR = 3_600_000;
const catalogSectors = new Map(catalog.map(entry => [entry.id, entry.sector]));
const catalogNames = new Map(catalog.map(entry => [entry.name, entry.sector]));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => value * value * (3 - 2 * value);

// Catalog industry takes precedence over branding: e.g. stone-tool maker
// 돌끝테크 is not an electronics company merely because its name ends in 테크.
export function wisStockSector(stock) {
  const name = String(stock.settings?.name ?? '').trim();
  const industry = catalogSectors.get(stock.id) ?? stock.settings?.sector ?? stock.sector ?? catalogNames.get(name);
  const text = String(industry ?? name).trim();
  if (/건설|철강|제철/.test(text)) return 'CONSTRUCTION_STEEL';
  if (/전자|(?:^|[·\s])IT(?:$|[·\s])|기술·학습|관측·과학 장비/i.test(text)
    || (industry === undefined && /테크|일렉트로닉|반도체|소프트웨어/.test(text))) return 'TECH_ELECTRONICS';
  if (/금융|투자|결제/.test(text)
    || (industry === undefined && /증권|은행|인베스트먼트|홀딩스|페이/.test(text))) return 'FINANCE';
  return 'OTHER';
}

// Reproducible synthetic preview only. Production injects a private SHA-256
// sampler with a market-wide prefix, separate from the stock-specific sampler.
export function wisStockPreviewSampler(seed) {
  return key => {
    let value = 2166136261;
    for (const char of `${seed}\n${key}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
}

// Use only committed observations before the current hourly tick. In particular,
// the current map's prices/index cannot influence later stocks in the same map.
// Legacy markets without an index start neutral; this function never reads I/O.
function priorObservations(index, atMs) {
  const beforeMs = Math.floor(atMs / HOUR) * HOUR;
  return (Array.isArray(index?.history) ? index.history : [])
    .filter(point => Number.isSafeInteger(point?.atMs) && point.atMs >= 0 && point.atMs < beforeMs
      && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.atMs - b.atMs);
}

export function wisStockPreviousMarketReturn(index, atMs) {
  const history = priorObservations(index, atMs);
  if (history.length < 2) return 0;
  return clamp((history.at(-1).value / history.at(-2).value - 1) * 10000, -1000, 1000);
}

export function wisStockMarketStress(index, atMs) {
  const history = priorObservations(index, atMs), hour = Math.floor(atMs / HOUR);
  let stress = 0;
  for (let i = 1; i < history.length; i++) {
    const ageHours = hour - history[i].atMs / HOUR;
    if (ageHours > 48) continue;
    const returnBps = (history[i].value / history[i - 1].value - 1) * 10000;
    // A prior selloff can temporarily increase uncertainty, never dictate the
    // next direction. It decays with real elapsed hours, capped at +35%.
    stress = Math.max(stress, clamp(-returnBps / 1000, 0, 1) * 0.35 * Math.exp(-ageHours / 12));
  }
  return stress;
}

export function sampleWisStockMarketFactors(stock, semesterId, slot, priceSeed = '', context = {}) {
  const atMs = context.atMs ?? slot * stock.settings.intervalHours * HOUR;
  const priorReturn = context.priorMarketReturnBps ?? 0;
  const marketStress = context.marketStress ?? 0;
  if (!Number.isSafeInteger(atMs) || atMs < 0 || !Number.isFinite(priorReturn)
    || !Number.isFinite(marketStress) || marketStress < 0 || marketStress > 0.35) {
    throw new RangeError('Invalid stock market factor input');
  }
  const hour = Math.floor(atMs / HOUR);
  const source = context.sampler || wisStockPreviewSampler(`${priceSeed}\n${semesterId}\nwispi-factors-v1`);
  const unit = key => {
    const value = source(key);
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid market factor sample');
    return value;
  };
  const bell = key => (unit(`${key}:a`) + unit(`${key}:b`) + unit(`${key}:c`)) * 2 / 3 - 1;
  const blend = (channel, span, value = bell) => {
    const index = Math.floor(hour / span), phase = smooth((hour % span) / span);
    return value(`${channel}:${index - 1}`) * (1 - phase) + value(`${channel}:${index}`) * phase;
  };
  // Calendar hours, not instrument slots: 1/6/24-hour stocks share the same
  // factors at the same real instant. No list order or stock id enters this seed.
  const market = 0.65 * blend('market', 24) + 0.35 * blend('market-detail', 4);
  const sector = wisStockSector(stock);
  const industry = ['CONSTRUCTION_STEEL', 'TECH_ELECTRONICS'].includes(sector)
    ? 0.65 * blend(`sector:${sector}`, 18) + 0.35 * blend(`sector-detail:${sector}`, 3) : 0;
  const volatilityScale = blend('market-volatility', 48, key => 0.55 + unit(key) ** 2 * 1.15) * (1 + marketStress);
  const priorMarket = clamp(priorReturn / 1000, -1, 1);
  // Shared calm/turbulent periods coexist with each instrument's own volatility
  // regime and idiosyncratic news. These are teaching coefficients, not measured
  // real-market correlations or a promise that related stocks move together.
  const contribution = volatilityScale * (sector === 'FINANCE' ? 0.7 * market + 0.25 * priorMarket
    : 0.3 * market + 0.95 * industry);
  return { sector, market, industry, volatilityScale, priorMarket, contribution,
    individualWeight: sector === 'OTHER' ? 0.8 : 0.6 };
}
