// Initial teacher display only. No orders, accounts, wallets or ledger entries are written.
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const functionsRequire = createRequire(require.resolve('../functions/package.json'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { resolveCredential } = functionsRequire('./scripts/rebuild-wis-ranking-index.cjs');
const { readMarket } = functionsRequire('./wisStocks');
const { marketDisplay, tradeDisplay } = functionsRequire('./wisStockDisplay');
const { accountIdFor } = functionsRequire('./studentWisWallet');

const MAX_RECENT = 20;
const orderFields = ['semesterId', 'accountId', 'studentUid', 'stockId', 'side', 'quantity',
  'unitPrice', 'settledAtMs', 'status', 'automaticSettlement'];
const accountFields = ['semesterId', 'accountId', 'studentUid', 'grade', 'classNumber', 'displayName', 'boardEligible'];
const invalid = () => { throw Error('운영 자료의 학기·체결·학적 범위를 확인해 주세요.'); };

async function prepare(tx, db, apply) {
  const [pointer, config] = (await tx.getAll(db.doc('site_settings/semester_active'), db.doc('site_settings/config'),
    { fieldMask: ['semesterId', 'revision', 'year', 'semester'] })).map(doc => doc.data());
  if (!/^20\d{2}-[12]$/.test(pointer?.semesterId || '') || !Number.isSafeInteger(pointer.revision) || pointer.revision < 1) invalid();
  const semesterId = pointer.semesterId, [year, semester] = semesterId.split('-');
  if (String(config?.year) !== year || String(config?.semester) !== semester) invalid();
  const root = `years/${year}/semesters/${semester}`, scope = { year, semester, semesterId };
  const displayRef = db.doc(root + '/wis_stock_display/market');
  const [manifest, marketDoc, currentView] = await tx.getAll(db.doc('semester_manifests/' + semesterId),
    db.doc(root + '/wis_stock_markets/current'), displayRef);
  const active = manifest.data();
  if (active?.semesterId !== semesterId || active.revision !== pointer.revision || active.status !== 'ACTIVE'
    || active.readOnly || !marketDoc.exists) invalid();
  const market = readMarket(marketDoc, scope), quote = marketDisplay(market);
  const old = currentView.data(), names = new Map(market.stocks.map(s => [s.id, s.settings.name]));
  if (old && (old.semesterId !== semesterId || !Number.isSafeInteger(old.updatedAtMs))) invalid();
  const changeMarket = (!old || old.updatedAtMs <= quote.updatedAtMs) && !isDeepStrictEqual(old, quote);
  const accounts = new Map(), fills = [];
  const collection = db.collection(root + '/wis_stock_orders');
  let cursor, pages = 0, examined = 0, statusIndexed = true;
  while (fills.length < MAX_RECENT) {
    const remaining = MAX_RECENT - fills.length;
    let query = statusIndexed ? collection.where('status', '==', 'FILLED') : collection;
    query = query.orderBy('settledAtMs', 'desc').select(...orderFields).limit(remaining);
    if (cursor) query = query.startAfter(cursor);
    let page;
    try { page = await tx.get(query); }
    catch (error) {
      // Some projects have only the single-field settledAtMs index. It excludes pending orders
      // without a settlement time. Continue by cursor until 20 actual voluntary fills are found.
      if (!cursor && statusIndexed && error.code === 9 && /index/i.test(error.details || error.message)) {
        statusIndexed = false;
        continue;
      }
      throw error;
    }
    pages++; examined += page.size;
    const orders = page.docs.filter(doc => doc.data().status === 'FILLED' && !doc.data().automaticSettlement);
    const missing = new Set();
    for (const doc of orders) {
      const order = doc.data();
      if (!/^stockord_[a-f0-9]{64}$/.test(doc.id) || order.semesterId !== semesterId
        || !/^[A-Za-z0-9_-]{1,128}$/.test(order.studentUid) || order.accountId !== accountIdFor(semesterId, order.studentUid)
        || !names.has(order.stockId) || !['BUY', 'SELL'].includes(order.side)
        || ![order.quantity, order.unitPrice, order.settledAtMs].every(value => Number.isSafeInteger(value) && value > 0)) invalid();
      if (!accounts.has(order.accountId)) missing.add(order.accountId);
    }
    if (missing.size) {
      const documents = await tx.getAll(...[...missing].map(id => db.doc(root + '/wis_stock_accounts/' + id)),
        { fieldMask: accountFields });
      for (const doc of documents) accounts.set(doc.id, doc.data());
    }
    for (const doc of orders) {
      const order = doc.data(), account = accounts.get(order.accountId);
      if (!account || account.boardEligible === false) continue;
      if (account.studentUid !== order.studentUid || account.accountId !== order.accountId || account.semesterId !== semesterId
        || !/^[1-3]$/.test(account.grade) || !/^[1-9][0-9]?$/.test(account.classNumber)
        || typeof account.displayName !== 'string' || !account.displayName.trim() || account.displayName.length > 80) invalid();
      fills.push({ ref: db.doc(root + '/wis_stock_display_trades/' + doc.id),
        data: tradeDisplay(semesterId, account, names.get(order.stockId), order, order.settledAtMs) });
    }
    if (page.size < remaining) break;
    cursor = page.docs.at(-1);
  }
  const existing = fills.length ? await tx.getAll(...fills.map(item => item.ref), { fieldMask: ['semesterId'] }) : [];
  const missing = fills.filter((item, i) => !existing[i].exists);
  if (apply) {
    if (changeMarket) tx.set(displayRef, quote);
    for (const item of missing) tx.create(item.ref, item.data);
  }
  return { mode: apply ? 'apply' : 'dry-run', semesterId, statusIndexed, orderPages: pages, ordersExamined: examined,
    accountsRead: accounts.size, recentFills: fills.length, existingTrades: existing.length - missing.length,
    newTrades: missing.length, marketChanged: changeMarket, writes: apply ? Number(changeMarket) + missing.length : 0 };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--apply')) throw Error('지원하지 않는 인수입니다.');
  const apply = args.includes('--apply');
  const app = initializeApp({ projectId: 'history-quiz-yongsin', credential: await resolveCredential() });
  try {
    const db = getFirestore(app);
    const summary = await db.runTransaction(tx => prepare(tx, db, apply), apply ? { maxAttempts: 5 } : { readOnly: true });
    console.log(JSON.stringify(summary));
  } finally { await deleteApp(app); }
}
if (require.main === module) main().catch(error => {
  // Firestore errors can include document paths. Never print student identifiers or amounts.
  console.error('전광판 초기 자료를 준비하지 못했습니다.', { code: error.code || 'INVALID_DATA' });
  process.exitCode = 1;
});
module.exports = { prepare };
