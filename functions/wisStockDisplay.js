'use strict';

const { wisStockIndexState } = require('./wisStockIndex');
const { HISTORY_LIMIT } = require('./wisStocks');

/** Teacher display projection. Never copy private model inputs or account metadata. */
function marketDisplay(market) {
  const updatedAtMs = Math.max(market.updatedAtMs || 0, ...market.stocks.map(stock => stock.updatedAtMs));
  const dayStart = Math.floor((updatedAtMs + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000;
  const index = wisStockIndexState(market, updatedAtMs);
  return {
    schemaVersion: 1, semesterId: market.semesterId, updatedAtMs,
    halted: !market.studentOpen || market.rules.halted,
    index: index.history.length ? { value: index.value, previousClose: index.previousClose } : null,
    stocks: market.stocks.map(stock => {
      const priorClose = stock.history.findLast(point => point.atMs < dayStart);
      const previousClose = priorClose?.price ?? stock.dayOpenPrice ?? stock.history[0]?.price ?? null;
      const first = stock.history[0], last = stock.history.at(-1), previous = stock.history.at(-2);
      // Older stocks have no listing timestamp. A truncated series cannot establish an IPO date.
      const listedAtMs = stock.listedAtMs ?? (stock.history.length < HISTORY_LIMIT
        && first?.price === stock.settings.initialPrice ? first.atMs : undefined);
      return { id: stock.id, name: stock.settings.name, price: stock.price, previousClose,
        ...(listedAtMs !== undefined ? { listedAtMs, listingPrice: stock.settings.initialPrice } : {}),
        ...(last?.price === stock.price ? { priceAtMs: last.atMs,
          ...(previous && previous.atMs < last.atMs ? { previousPrice: previous.price } : {}) } : {}) };
    }),
  };
}

function tradeDisplay(semesterId, account, stockName, order, atMs) {
  return {
    semesterId, classKey: `${account.grade}_${account.classNumber}`, atMs,
    displayName: account.displayName, stockName, side: order.side,
    quantity: order.quantity, unitPrice: order.unitPrice,
  };
}

module.exports = { marketDisplay, tradeDisplay };
