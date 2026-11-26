// Only trusted market-management transactions can create these durable jobs.
// Graduation is a zero-fee liquidation at the frozen final quote, never a
// deletion of positions. Account, supply, order, board and receipt commit once.
const { isDeepStrictEqual } = require('node:util');
const { tagWisStockBonusOrder, applyWisStockBonusOrder } = require('./wisStockBonusAccounting');
const { DOMESTIC } = require('./wisStockVenues');
function createWisStockGraduation(deps) {
  const { db, now, mutate, scopeOf, rootPath, accountPath, orderPath, hash, fail, sum, multiply,
    validateAccount, readMarket, supplyFor, portfolioFor, reservationsFor, applyOrder,
    cancelWisStockOrder, prepareBoard, history, enqueue, FieldPath, venue = DOMESTIC } = deps;
  // Venue collections: the domestic values are the original literals.
  const jobRefFor = (scope, stockId) => db.doc(`${venue.graduations}/${scope.semesterId}_${stockId}`);
  const validJob = (job, scope, stockId) => job?.schemaVersion === 1 && job.semesterId === scope.semesterId
    && job.year === scope.year && job.semester === scope.semester && job.stockId === stockId
    && Number.isSafeInteger(job.unitPrice) && job.unitPrice >= 1 && job.unitPrice <= 1000000
    && Number.isSafeInteger(job.atMs) && job.atMs > 0 && ['PENDING', 'COMPLETE'].includes(job.status);

  async function settleAccount(scope, stockId, accountId) {
    return mutate(scope, async tx => {
      const accountRef = db.doc(`${rootPath(scope)}/${venue.accounts}/${accountId}`);
      const receiptRef = db.doc(`${rootPath(scope)}/${venue.graduationReceipts}/${hash(`${stockId}\n${accountId}`)}`);
      const [jobSnap, accountSnap, marketSnap, receiptSnap] = await tx.getAll(jobRefFor(scope, stockId), accountRef,
        db.doc(`${rootPath(scope)}/wis_stock_markets/${venue.marketDoc}`), receiptRef);
      const job = jobSnap.data();
      if (!validJob(job, scope, stockId)) fail('WIS_STOCK_GRADUATION_INVALID');
      if (receiptSnap.exists) {
        const receipt = receiptSnap.data();
        if (receipt.stockId !== stockId || receipt.accountId !== accountId || receipt.unitPrice !== job.unitPrice)
          fail('WIS_STOCK_GRADUATION_INVALID');
        return { changed: false, duplicate: true };
      }
      if (!accountSnap.exists) fail('WIS_STOCK_ACCOUNT_INVALID');
      const previous = validateAccount(accountSnap.data(), scope, accountSnap.data().studentUid);
      if (accountPath(scope, previous.studentUid) !== accountRef.path) fail('WIS_STOCK_ACCOUNT_INVALID');
      const market = readMarket(marketSnap, scope), stock = market.stocks.find(item => item.id === stockId);
      if (!stock || stock.settings.tradingStatus !== 'GRADUATED' || stock.price !== job.unitPrice
        || stock.graduation?.unitPrice !== job.unitPrice || stock.graduation?.atMs !== job.atMs)
        fail('WIS_STOCK_GRADUATION_INVALID');
      if (!(previous.positions[stockId]?.quantity > 0)) return { changed: false };
      const supplyRef = db.doc(`${rootPath(scope)}/${venue.supplies}/${stockId}`);
      let nextSupply = supplyFor(await tx.get(supplyRef), stock, scope), next = structuredClone(previous);
      if (nextSupply.holders[next.studentKey] !== next.positions[stockId].quantity) fail('WIS_STOCK_SUPPLY_INVALID');
      const pending = Object.values(next.pendingOrders).filter(order => order.stockId === stockId);
      const snapshots = pending.length ? await tx.getAll(...pending.map(order => db.doc(orderPath(scope, order.id)))) : [];
      const changes = [], atMs = now(), context = { scope, actor: { uid: previous.studentUid }, atMs };
      for (let index = 0; index < pending.length; index++) {
        const order = pending[index], raw = snapshots[index].data();
        if (!raw || raw.studentUid !== previous.studentUid || Object.keys(order).some(key => !isDeepStrictEqual(order[key], raw[key])))
          fail('WIS_STOCK_RESERVATION_INVALID');
        const transition = cancelWisStockOrder({ order, accountId, semesterId: scope.semesterId, nowMs: atMs,
          portfolio: portfolioFor(next, market, stockId), reservations: reservationsFor(next, stockId), supply: nextSupply });
        transition.order.cancellationReason = 'STOCK_GRADUATED';
        ({ next, nextSupply } = applyOrder(next, nextSupply, transition));
        changes.push({ order: { ...raw, ...transition.order }, sequence: next.revision });
      }
      const position = next.positions[stockId], quantity = position.quantity;
      const cashCredit = multiply(quantity, job.unitPrice), realizedPnl = sum([cashCredit, -position.costBasis]);
      next.stockCash = sum([next.stockCash, cashCredit]);
      next.cumulativeRealizedPnl = sum([next.cumulativeRealizedPnl, realizedPnl]);
      next.profitHighWatermark = Math.max(next.profitHighWatermark, next.cumulativeRealizedPnl, 0);
      next.revision = sum([next.revision, 1]); next.updatedAtMs = atMs;
      nextSupply.availableShares = sum([nextSupply.availableShares, quantity]);
      nextSupply.revision = sum([nextSupply.revision, 1]); delete nextSupply.holders[next.studentKey];
      const orderId = `stockord_${hash(`GRADUATION\n${scope.semesterId}\n${stockId}\n${accountId}`)}`;
      const automatic = tagWisStockBonusOrder(next, { schemaVersion: 1, id: orderId, accountId, studentUid: previous.studentUid,
        semesterId: scope.semesterId, year: scope.year, semester: scope.semester, stockId, side: 'SELL',
        status: 'FILLED', revision: 2, automaticSettlement: 'GRADUATION', quantity, unitPrice: job.unitPrice,
        gross: cashCredit, fee: 0, cashDebit: 0, cashCredit, reservedPrincipal: position.principal,
        reservedCostBasis: position.costBasis, acceptedAtMs: job.atMs, dueAtMs: job.atMs, settledAtMs: atMs,
        realizedPnl, earnedDelta: 0, requestKey: `GRADUATION:${stockId}:${accountId}` });
      // The source lots use their actual purchase cost, independent of the
      // public position's average cost. Graduation follows ordinary sales.
      next.positions[stockId] = { ...position, quantity: 0, principal: 0, costBasis: 0 };
      applyWisStockBonusOrder(previous, next, { order: automatic });
      delete next.positions[stockId];
      next.recentOrders = [automatic, ...next.recentOrders].slice(0, 10);
      validateAccount(next, scope, previous.studentUid);
      const writeBoards = await prepareBoard(tx, scope, market, previous, next, new Map([[stockId, nextSupply]]));
      tx.set(accountRef, next); tx.set(supplyRef, nextSupply);
      for (const change of changes) {
        tx.set(db.doc(orderPath(scope, change.order.id)), change.order);
        history(tx, context, { ...next, revision: change.sequence }, 'ORDER_CANCELLED', change.order.id,
          { orderId: change.order.id, stockId, side: change.order.side, quantity: change.order.quantity,
            unitPrice: change.order.unitPrice, fee: change.order.fee, cancellationReason: 'STOCK_GRADUATED' });
      }
      tx.create(db.doc(orderPath(scope, orderId)), automatic);
      history(tx, context, next, 'ORDER_FILLED', orderId, { orderId, stockId, side: 'SELL', quantity,
        unitPrice: job.unitPrice, fee: 0, stockCashDelta: cashCredit, realizedPnl,
        principalRemoved: position.principal, costBasisRemoved: position.costBasis, automaticSettlement: 'GRADUATION',
        ...(automatic.eventBonusRestrictedProceeds !== undefined ? { eventBonusRestrictedProceeds: automatic.eventBonusRestrictedProceeds,
          eventBonusRealizedLossDelta: automatic.eventBonusRealizedLossDelta } : {}) });
      tx.create(receiptRef, { schemaVersion: 1, semesterId: scope.semesterId, accountId,
        studentUid: previous.studentUid, stockId, orderId, quantity, unitPrice: job.unitPrice,
        cashCredit, costBasisRemoved: position.costBasis, principalRemoved: position.principal,
        fee: 0, realizedPnl, appliedAtMs: atMs, status: 'APPLIED',
        ...(automatic.eventBonusRestrictedProceeds !== undefined ? { eventBonusRestrictedProceeds: automatic.eventBonusRestrictedProceeds,
          eventBonusRealizedLossDelta: automatic.eventBonusRealizedLossDelta } : {}) });
      writeBoards();
      return { changed: true, cashCredit };
    });
  }

  async function sweepGraduation(scope, stockId, after = null, generation = 0) {
    if (!/^stock_[a-f0-9]{24}$/.test(stockId || '') || !Number.isSafeInteger(generation) || generation < 0)
      fail('WIS_STOCK_TASK_INVALID');
    const jobSnap = await jobRefFor(scope, stockId).get(), job = jobSnap.data();
    if (!validJob(job, scope, stockId)) fail('WIS_STOCK_GRADUATION_INVALID');
    if (job.status === 'COMPLETE') return { changed: 0, complete: true };
    const field = `positions.${stockId}.quantity`;
    let query = db.collection(`${rootPath(scope)}/${venue.accounts}`).where(field, '>', 0)
      .orderBy(field).orderBy(FieldPath.documentId()).limit(10);
    if (after) {
      if (!Number.isSafeInteger(after.quantity) || after.quantity <= 0 || !/^[A-Za-z0-9_-]{8,160}$/.test(after.id || '')) fail('WIS_STOCK_TASK_INVALID');
      query = query.startAfter(after.quantity, after.id);
    }
    const page = await query.get(), results = [], failures = [];
    for (const doc of page.docs) {
      try { results.push(await settleAccount(scope, stockId, doc.id)); }
      catch (error) { failures.push(error?.details?.reason || error?.reason || String(error?.code || 'UNKNOWN')); }
    }
    if (page.size === 10) {
      const last = page.docs.at(-1), cursor = { quantity: last.get(field), id: last.id };
      await enqueue({ kind: 'GRADUATION', year: scope.year, semester: scope.semester, stockId, after: cursor, generation },
        `grad_${hash(`${scope.semesterId}\n${stockId}\n${generation}\n${cursor.id}`)}`, now() + 1000);
    } else {
      // A final transactional supply check also catches failed accounts from
      // earlier pages. A later scheduler pass starts at the beginning again.
      await mutate(scope, async tx => {
        const [latest, supply] = await tx.getAll(jobRefFor(scope, stockId), db.doc(`${rootPath(scope)}/${venue.supplies}/${stockId}`));
        if (!validJob(latest.data(), scope, stockId)) fail('WIS_STOCK_GRADUATION_INVALID');
        const value = supply.data();
        if ((!value || (Object.keys(value.holders || {}).length === 0 && value.reservedBuyQuantity === 0)) && latest.data().status !== 'COMPLETE')
          tx.update(jobRefFor(scope, stockId), { status: 'COMPLETE', completedAtMs: now() });
      });
    }
    if (failures.length) throw new Error(`Graduation retry required: ${failures.length}; ${[...new Set(failures)].join(',')}`);
    return { examined: page.size, changed: results.filter(result => result.changed).length };
  }
  async function recoverGraduations() {
    const generation = Math.floor(now() / 300000);
    let cursor = null, queued = 0;
    do {
      let query = db.collection(venue.graduations).where('status', '==', 'PENDING').orderBy(FieldPath.documentId()).limit(20);
      if (cursor) query = query.startAfter(cursor);
      const pending = await query.get();
      for (const doc of pending.docs) {
        const job = doc.data(), scope = scopeOf(job);
        if (!validJob(job, scope, job.stockId)) fail('WIS_STOCK_GRADUATION_INVALID');
        await enqueue({ kind: 'GRADUATION', year: scope.year, semester: scope.semester, stockId: job.stockId, generation },
          `grad_${hash(`${scope.semesterId}\n${job.stockId}\n${generation}\nSTART`)}`, now());
        queued++;
      }
      cursor = pending.size === 20 ? pending.docs.at(-1).id : null;
    } while (cursor);
    return { queued };
  }
  return { settleAccount, sweepGraduation, recoverGraduations };
}
module.exports = { createWisStockGraduation };
