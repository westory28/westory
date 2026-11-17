import { WisStockRuleError } from './wisStockMarketRules.mjs';

// Only cash actually funded by the campaign, and shares bought with that cash,
// carry a restriction. Existing personal holdings never back the grant.
export const WIS_STOCK_BONUS_RESTRICTION_VERSION = 1;
const int = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new WisStockRuleError('WIS_STOCK_BONUS_ACCOUNT_INVALID', '이벤트 지원금의 사용 기록을 확인해 주세요.'); };
const pending = () => { throw new WisStockRuleError('WIS_STOCK_BONUS_RESTRICTION_PENDING', '이벤트 지원금 보호 설정을 적용하고 있습니다. 잠시 후 다시 시도해 주세요.'); };
const safe = value => { if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail(); return Number(value); };
const add = (...values) => safe(values.reduce((total, value) => total + BigInt(value), 0n));
const ceilRatio = (value, numerator, denominator) => {
  if (!int(value) || !int(numerator) || !int(denominator) || !denominator) fail();
  return safe((BigInt(value) * BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator));
};
const floorRatio = (value, numerator, denominator) => safe(BigInt(value) * BigInt(numerator) / BigInt(denominator));
const fields = ['eventBonusRestrictedCash', 'eventBonusReservedCash', 'eventBonusLossCarryforward', 'eventBonusLegacyWithdrawn'];
export const isWisStockBonusMigrationPending = account => (account.eventBonusTotal || 0) > 0 && account.eventBonusRestrictionVersion !== 1;
export function assertWisStockBonusReady(account) {
  if (isWisStockBonusMigrationPending(account)) pending();
  validateWisStockBonusAccount(account);
}
export function wisStockBonusFunding(account) {
  if (isWisStockBonusMigrationPending(account)) return { eventBonusRestrictedCash: account.stockCash, eventBonusReservedCash: account.reservedCash, eventBonusMigrationPending: true };
  return { eventBonusRestrictedCash: account.eventBonusRestrictedCash || 0, eventBonusReservedCash: account.eventBonusReservedCash || 0 };
}
function reservations(account, stockId) {
  const result = {};
  for (const order of Object.values(account.pendingOrders || {})) {
    if (order.side !== 'SELL' || order.stockId !== stockId) continue;
    for (const slice of order.eventBonusLotAllocations || []) {
      const total = result[slice.lotId] ||= { quantity: 0, costBasis: 0, restrictedCostBasis: 0 };
      for (const key of Object.keys(total)) total[key] = add(total[key], slice[key]);
    }
  }
  return result;
}
export function validateWisStockBonusAccount(account) {
  const version = account.eventBonusRestrictionVersion;
  if (version === undefined) {
    if (account.schemaVersion === 2 || fields.some(key => account[key] !== undefined)
      || Object.values(account.positions || {}).some(position => position.eventBonusLots !== undefined)) fail();
    return;
  }
  if (version !== 1 || account.schemaVersion !== 2 || !int(account.eventBonusTotal) || !fields.every(key => int(account[key]))) fail();
  const cash = account.eventBonusRestrictedCash, reserved = account.eventBonusReservedCash;
  if (reserved > cash || cash > account.stockCash || reserved > account.reservedCash
    || account.reservedCash - reserved > account.stockCash - cash) fail();
  let lotPrincipal = 0, buyReserved = 0;
  for (const order of Object.values(account.pendingOrders || {})) {
    const debit = order.eventBonusRestrictedDebit || 0;
    if (!int(debit) || debit > order.cashDebit || (order.side !== 'BUY' && debit)) fail();
    buyReserved = add(buyReserved, debit);
    if (order.eventBonusLotAllocations !== undefined && !Array.isArray(order.eventBonusLotAllocations)) fail();
    let quantity = 0;
    const ids = new Set();
    for (const slice of order.eventBonusLotAllocations || []) {
      if (order.side !== 'SELL' || !object(slice) || typeof slice.lotId !== 'string' || ids.has(slice.lotId)
        || !['quantity', 'costBasis', 'restrictedCostBasis'].every(key => int(slice[key])) || !slice.quantity
        || slice.restrictedCostBasis > slice.costBasis || !account.positions?.[order.stockId]?.eventBonusLots?.[slice.lotId]) fail();
      ids.add(slice.lotId); quantity = add(quantity, slice.quantity);
    }
    if (quantity > order.quantity) fail();
  }
  if (buyReserved !== reserved) fail();
  for (const [stockId, position] of Object.entries(account.positions || {})) {
    const lots = position.eventBonusLots || {};
    if (!object(lots)) fail();
    const held = reservations(account, stockId);
    let quantity = 0, restrictedReservedQuantity = 0;
    for (const [id, lot] of Object.entries(lots)) {
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(id) || !object(lot)
        || !['quantity', 'costBasis', 'restrictedCostBasis'].every(key => int(lot[key])) || !lot.quantity
        || lot.restrictedCostBasis > lot.costBasis || lot.costBasis < lot.quantity
        || (lot.quantity > 1 && lot.restrictedCostBasis !== lot.costBasis) || !int(lot.sequence)) fail();
      const reservation = held[id] || { quantity: 0, costBasis: 0, restrictedCostBasis: 0 };
      for (const key of ['quantity', 'costBasis', 'restrictedCostBasis']) if (reservation[key] > lot[key]) fail();
      if (lot.restrictedCostBasis - reservation.restrictedCostBasis > lot.costBasis - reservation.costBasis) fail();
      quantity = add(quantity, lot.quantity); restrictedReservedQuantity = add(restrictedReservedQuantity, reservation.quantity);
      lotPrincipal = add(lotPrincipal, lot.restrictedCostBasis);
    }
    // Legacy pending sells represent personal shares only; a later grant or
    // buy cannot silently reassign those already-reserved shares to the grant.
    if (quantity > position.quantity || position.reservedSellQuantity - restrictedReservedQuantity > position.quantity - quantity) fail();
  }
  if (add(cash, lotPrincipal, account.eventBonusLossCarryforward, account.eventBonusLegacyWithdrawn) !== account.eventBonusTotal) fail();
}
export function grantWisStockRestrictedBonus(account, amount) {
  assertWisStockBonusReady(account);
  if (!int(amount) || !amount) fail();
  if (account.eventBonusRestrictionVersion === undefined) {
    account.schemaVersion = 2; account.eventBonusRestrictionVersion = 1;
    for (const key of fields) account[key] = 0;
    account.eventBonusTotal ||= 0;
  }
  account.stockCash = add(account.stockCash, amount);
  account.eventBonusRestrictedCash = add(account.eventBonusRestrictedCash, amount);
  account.eventBonusTotal = add(account.eventBonusTotal, amount);
  validateWisStockBonusAccount(account);
}
// Freeze provenance at acceptance, just like the existing price/fee contract.
// Restricted lots are consumed FIFO before implicit personal holdings.
export function tagWisStockBonusOrder(account, order) {
  assertWisStockBonusReady(account);
  if (account.eventBonusRestrictionVersion !== 1) return order;
  if (order.side === 'BUY') return { ...order, eventBonusRestrictedDebit: Math.min(order.cashDebit,
    account.eventBonusRestrictedCash - account.eventBonusReservedCash) };
  const lots = account.positions[order.stockId]?.eventBonusLots || {}, held = reservations(account, order.stockId);
  let remaining = order.quantity;
  const allocations = [];
  for (const [lotId, lot] of Object.entries(lots).sort((a, b) => a[1].sequence - b[1].sequence || a[0].localeCompare(b[0]))) {
    if (!remaining) break;
    const reservation = held[lotId] || { quantity: 0, costBasis: 0, restrictedCostBasis: 0 };
    const available = lot.quantity - reservation.quantity;
    if (!available) continue;
    const quantity = Math.min(remaining, available), cost = lot.costBasis - reservation.costBasis,
      restricted = lot.restrictedCostBasis - reservation.restrictedCostBasis;
    // Charge fractional purchase cost to earlier sold shares. Deferring a
    // rounded fee until the last share can release artificial early profit.
    const costBasis = quantity === available ? cost : ceilRatio(cost, quantity, available);
    const restrictedCostBasis = cost ? Math.min(costBasis, ceilRatio(restricted, costBasis, cost)) : 0;
    allocations.push({ lotId, quantity, costBasis, restrictedCostBasis }); remaining -= quantity;
  }
  return { ...order, eventBonusLotAllocations: allocations };
}
export function applyWisStockBonusOrder(previous, next, transition) {
  const order = transition.order;
  if (isWisStockBonusMigrationPending(previous)) {
    if (order.status === 'CANCELLED' && !order.eventBonusRestrictedDebit && !order.eventBonusLotAllocations?.length) return;
    pending();
  }
  if (previous.eventBonusRestrictionVersion !== 1) return;
  const debit = order.eventBonusRestrictedDebit || 0;
  if (order.status === 'PENDING') {
    if (order.side === 'BUY') next.eventBonusReservedCash = add(next.eventBonusReservedCash, debit);
  } else if (order.side === 'BUY') {
    next.eventBonusReservedCash = add(next.eventBonusReservedCash, -debit);
    if (order.status === 'FILLED' && debit) {
      next.eventBonusRestrictedCash = add(next.eventBonusRestrictedCash, -debit);
      const lots = next.positions[order.stockId].eventBonusLots ||= {};
      // Fund complete shares first, then at most one mixed-source share.
      // Distributing a tiny grant fraction over every share would round that
      // fraction repeatedly when students sell one share at a time. A mixed
      // boundary share is indivisible and its ratio is applied exactly once.
      let low = 0, high = order.quantity;
      while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (floorRatio(order.cashDebit, middle, order.quantity) <= debit) low = middle; else high = middle - 1;
      }
      const completeCost = floorRatio(order.cashDebit, low, order.quantity);
      if (low) lots[`${order.id}_full`] = { quantity: low, costBasis: completeCost,
        restrictedCostBasis: completeCost, sequence: next.revision };
      if (debit > completeCost) lots[`${order.id}_mixed`] = { quantity: 1,
        costBasis: floorRatio(order.cashDebit, low + 1, order.quantity) - completeCost,
        restrictedCostBasis: debit - completeCost, sequence: next.revision };
    }
  } else if (order.status === 'FILLED') {
    let removed = 0, sourceProceeds = 0, allocatedQuantity = 0, allocatedProceeds = 0;
    const position = next.positions[order.stockId], lots = position.eventBonusLots || {};
    for (const slice of order.eventBonusLotAllocations || []) {
      const lot = lots[slice.lotId]; if (!lot) fail();
      allocatedQuantity = add(allocatedQuantity, slice.quantity);
      const through = ceilRatio(order.cashCredit, allocatedQuantity, order.quantity), proceeds = through - allocatedProceeds;
      allocatedProceeds = through;
      sourceProceeds = add(sourceProceeds, slice.costBasis ? ceilRatio(proceeds, slice.restrictedCostBasis, slice.costBasis) : 0);
      removed = add(removed, slice.restrictedCostBasis);
      for (const key of ['quantity', 'costBasis', 'restrictedCostBasis']) lot[key] = add(lot[key], -slice[key]);
      if (!lot.quantity) { if (lot.costBasis || lot.restrictedCostBasis) fail(); delete lots[slice.lotId]; }
    }
    const returned = Math.min(sourceProceeds, add(removed, next.eventBonusLossCarryforward));
    next.eventBonusRestrictedCash = add(next.eventBonusRestrictedCash, returned);
    next.eventBonusLossCarryforward = add(next.eventBonusLossCarryforward, removed, -returned);
    order.eventBonusRestrictedProceeds = returned;
    order.eventBonusRealizedLossDelta = removed - returned;
  }
  // Zero-restriction remnants are ordinary personal shares. Keep a remnant
  // only while an accepted sell still refers to its immutable lot id.
  for (const [stockId, position] of Object.entries(next.positions)) {
    const held = reservations(next, stockId);
    for (const [id, lot] of Object.entries(position.eventBonusLots || {})) if (!lot.restrictedCostBasis && !held[id]) delete position.eventBonusLots[id];
    if (position.eventBonusLots && !Object.keys(position.eventBonusLots).length) delete position.eventBonusLots;
  }
  validateWisStockBonusAccount(next);
}
