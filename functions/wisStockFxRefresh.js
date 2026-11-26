'use strict';

const { WIS_STOCK_FX_PATH, nextWisStockFxDocument, wisStockFxRateFromKrwPerUsd, wisStockFxDayKey } = require('./wisStockFx');

// One scheduled job reads one public USD reference rate per day for every
// class. Only the request date leaves Westory: no student, account or
// credential data is sent. A failed provider falls through to the next one.
const PROVIDERS = Object.freeze([
  {
    source: 'ECB 기준환율(Frankfurter)',
    url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW',
    parse: body => ({ krwPerUsd: body?.base === 'USD' ? body?.rates?.KRW : undefined, sourceDate: body?.date }),
  },
  {
    source: 'ExchangeRate-API 공개 환율',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: body => ({
      krwPerUsd: body?.result === 'success' && body?.base_code === 'USD' ? body?.rates?.KRW : undefined,
      sourceDate: Number.isSafeInteger(body?.time_last_update_unix)
        ? new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10) : undefined,
    }),
  },
]);

function createWisStockFxRefresh({ db, now = Date.now, fetchImpl = globalThis.fetch, providers = PROVIDERS, timeoutMs = 8000 }) {
  async function fetchQuote() {
    const failures = [];
    for (const provider of providers) {
      try {
        const response = await fetchImpl(provider.url, { headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 64 * 1024) throw new Error('response too large');
        const { krwPerUsd, sourceDate } = provider.parse(JSON.parse(text));
        wisStockFxRateFromKrwPerUsd(krwPerUsd);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate || '')) throw new Error('missing date');
        return { krwPerUsd, sourceDate, source: provider.source };
      } catch (error) {
        failures.push(`${provider.source}: ${error?.message || error}`);
      }
    }
    const error = new Error(`USD/KRW rate unavailable (${failures.join('; ')})`);
    error.reason = 'WIS_STOCK_FX_UNAVAILABLE';
    throw error;
  }

  async function refreshWisStockFxRate() {
    const ref = db.doc(WIS_STOCK_FX_PATH);
    // Skip the external call when today's rate is already stored (retries,
    // duplicate scheduler deliveries and manual reruns cost one read only).
    const existing = await ref.get();
    const fetchedAtMs = now();
    if (existing.exists && existing.data()?.dayKey === wisStockFxDayKey(fetchedAtMs)) return { changed: false };
    const quote = await fetchQuote();
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const next = nextWisStockFxDocument(snapshot.exists ? snapshot.data() : null, { ...quote, fetchedAtMs });
      if (!next) return { changed: false };
      tx.set(ref, next);
      return { changed: true, rate: next.rate, dayKey: next.dayKey, source: next.source };
    });
  }

  return { refreshWisStockFxRate, fetchQuote };
}

module.exports = { createWisStockFxRefresh, PROVIDERS };
