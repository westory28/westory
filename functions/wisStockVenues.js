'use strict';

const { domesticSchedule, overseasSchedule } = require('./wisStockCatalogSchedule');

// Each venue is a separate set of canonical documents. The domestic values are
// the original literals, so its paths, triggers and receipts are unchanged.
// The overseas venue quotes in 유스: its student accounts hold only 유스, are
// funded by the daily exchange, and never touch the general Wis wallet.
const DOMESTIC = Object.freeze({
  id: 'DOMESTIC', unit: '위스', label: '국내',
  marketDoc: 'current', publicMarketDoc: 'market', publicStatusDoc: 'current',
  receipts: 'wis_stock_receipts', graduations: 'wis_stock_graduations',
  graduationReceipts: 'wis_stock_graduation_receipts',
  accounts: 'wis_stock_accounts', orders: 'wis_stock_orders', supplies: 'wis_stock_supplies', history: 'wis_stock_history',
  taskFunction: 'settleWisStockOrderTask', schedule: domesticSchedule,
  historyTrend: false, specialSessions: true, forecast: true,
  board: true, displayTrades: true, displayDoc: 'market', transfers: true, bonus: true, enrollmentSync: true,
});
const OVERSEAS = Object.freeze({
  id: 'OVERSEAS', unit: '유스', label: '해외',
  marketDoc: 'overseas', publicMarketDoc: 'overseas_market', publicStatusDoc: 'overseas_current',
  receipts: 'wis_stock_overseas_receipts', graduations: 'wis_stock_overseas_graduations',
  graduationReceipts: 'wis_stock_overseas_graduation_receipts',
  accounts: 'wis_stock_overseas_accounts', orders: 'wis_stock_overseas_orders', supplies: 'wis_stock_overseas_supplies',
  history: 'wis_stock_overseas_history',
  taskFunction: 'settleWisStockOverseasOrderTask', schedule: overseasSchedule,
  historyTrend: true, specialSessions: false, forecast: false,
  board: false, displayTrades: false, displayDoc: null, transfers: false, bonus: false, enrollmentSync: false,
  // A 유스 account starts small, so the domestic 500-Wis cash floor would block
  // every first purchase. All other limits copy the domestic market at launch.
  ruleOverrides: Object.freeze({ minimumCashReserve: 0 }),
});
const WIS_STOCK_VENUES = Object.freeze({ DOMESTIC, OVERSEAS });

module.exports = { DOMESTIC, OVERSEAS, WIS_STOCK_VENUES };
