const { onCall } = require('firebase-functions/v2/https');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

function createWisStockTradingExports({ db,
  settlementServiceAccount = '177587430482-compute@developer.gserviceaccount.com' }) {
  const handlers = require('./wisStockTrading').createWisStockTrading({ db });
  const runtime = { region: 'us-central1', memory: '256MiB', minInstances: 0, maxInstances: 10,
    timeoutSeconds: 60, concurrency: 40 };
  const result = {};
  for (const name of ['getStudentWisStockState', 'getStudentWisStockHistory', 'getStudentWisStockBonus', 'claimStudentWisStockBonus', 'transferStudentWisStock',
    'placeStudentWisStockOrder', 'cancelStudentWisStockOrder']) result[name] = onCall(runtime, handlers[name]);
  result.archiveWisStockRankTrace = onDocumentWritten({ ...runtime, retry: true,
    document: 'years/{year}/semesters/{semester}/wis_stock_investment_boards/{boardId}',
  }, require('./wisStockRankTrace').createRankTraceWriter(db));
  result.getWisStockInvestmentHistory = onCall(runtime,
    require('./wisStockInvestmentHistory').createWisStockInvestmentHistory({ db }));
  result.settleWisStockOrderTask = onTaskDispatched({ ...runtime, maxInstances: 5,
    retryConfig: { maxAttempts: 10, minBackoffSeconds: 5, maxBackoffSeconds: 60, maxDoublings: 4 },
    rateLimits: { maxConcurrentDispatches: 20, maxDispatchesPerSecond: 20 },
    // Firebase applies task invokers to both the queue enqueuer and Cloud Run.
    // Keep the existing project runtime identity explicit so redeploying cannot
    // clear enqueue permission or make the settlement worker public.
    invoker: [settlementServiceAccount],
  }, handlers.settleWisStockOrderTask);
  result.onWisStockOrderCreated = onDocumentCreated({ ...runtime, retry: true,
    document: 'years/{year}/semesters/{semester}/wis_stock_orders/{orderId}',
  }, handlers.onWisStockOrderCreated);
  result.onWisStockMarketTradingWrite = onDocumentWritten({ ...runtime, retry: true,
    document: 'years/{year}/semesters/{semester}/wis_stock_markets/current',
  }, handlers.onWisStockMarketTradingWrite);
  result.onWisStockEnrollmentSlotWritten = onDocumentWritten({ ...runtime, retry: true,
    document: 'semester_enrollment_slots/{slotId}',
  }, handlers.onWisStockEnrollmentSlotWritten);
  result.recoverWisStockOrders = onSchedule({ ...runtime, maxInstances: 1,
    schedule: 'every 5 minutes', timeZone: 'Asia/Seoul',
  }, handlers.recoverWisStockOrders);
  return result;
}
module.exports = { createWisStockTradingExports };
