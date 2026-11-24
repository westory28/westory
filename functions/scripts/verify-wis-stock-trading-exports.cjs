const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createWisStockTradingExports } = require('../wisStockTradingExports');
const app = initializeApp({ projectId: 'demo-westory-stock-exports' });
const exported = createWisStockTradingExports({ db: getFirestore(app) });
const calls = ['getStudentWisStockState', 'getStudentWisStockHistory', 'getStudentWisStockBonus', 'claimStudentWisStockBonus', 'transferStudentWisStock', 'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'getWisStockInvestmentHistory'];
const triggers = { archiveWisStockRankTrace: 'years/{year}/semesters/{semester}/wis_stock_investment_boards/{boardId}',
  onWisStockOrderCreated: 'years/{year}/semesters/{semester}/wis_stock_orders/{orderId}',
  onWisStockMarketTradingWrite: 'years/{year}/semesters/{semester}/wis_stock_markets/current',
  onWisStockEnrollmentSlotWritten: 'semester_enrollment_slots/{slotId}' };
assert.deepEqual(Object.keys(exported).sort(), [...calls, ...Object.keys(triggers), 'settleWisStockOrderTask', 'recoverWisStockOrders'].sort());
for (const [name, handler] of Object.entries(exported)) {
  assert.equal(typeof handler, 'function');
  const e = handler.__endpoint;
  assert.equal(e.platform, 'gcfv2'); assert.deepEqual(e.region, ['us-central1']);
  assert.equal(e.availableMemoryMb, 256); assert.equal(e.minInstances, 0); assert.equal(e.timeoutSeconds, 60);
  if (calls.includes(name)) assert.ok(e.callableTrigger);
  if (triggers[name]) { assert.equal(e.eventTrigger.eventFilterPathPatterns.document, triggers[name]); assert.equal(e.eventTrigger.retry, true); }
}
const task = exported.settleWisStockOrderTask.__endpoint;
assert.deepEqual(task.taskQueueTrigger.invoker, ['177587430482-compute@developer.gserviceaccount.com']);
assert.equal(task.taskQueueTrigger.retryConfig.maxAttempts, 10);
assert.equal(task.taskQueueTrigger.rateLimits.maxConcurrentDispatches, 20);
assert.equal(exported.recoverWisStockOrders.__endpoint.scheduleTrigger.schedule, 'every 5 minutes');
const index = fs.readFileSync(require.resolve('../index'), 'utf8');
assert.ok(index.includes("Object.assign(exports, require('./wisStockTradingExports').createWisStockTradingExports({ db }));"));
deleteApp(app).then(() => console.log('PASS actual trading/history exports, private service identity, task retry, trigger paths and root entrypoint; network 0'));
