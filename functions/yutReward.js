const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { createStudentWisWallet, accountIdFor } = require('./studentWisWallet');
const { validateYutWinnerReward } = require('./weplayCore');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const rewardPath = (scope, roomId) => `years/${scope.year}/semesters/${scope.semester}/point_transactions/weplay_reward_yut_${roomId}`;

function createYutReward({ db }) {
  const wallet = createStudentWisWallet({ db, actorUid: 'system:yut' });
  const snapshot = async (transaction, scope) => {
    const data = (await transaction.get(db.doc(`years/${scope.year}/semesters/${scope.semester}/weplay_policies/current`))).data();
    try {
      if (!data || !Number.isSafeInteger(data.version) || data.version < 0) throw new Error('Invalid reward policy version');
      return { ...validateYutWinnerReward(data.yutWinnerReward), version: data.version };
    } catch { return { enabled: false, amount: 0, version: 0 }; }
  };
  // Every read completes before apply. No account/ledger identifiers or balances
  // are copied into the shared room visible to other players.
  const prepare = async (transaction, scope, room, actor, nowMs) => {
    const policy = room.winnerRewardPolicy;
    const base = { uid: room.winnerUid, amount: 0, policyVersion: Number.isSafeInteger(policy?.version) ? policy.version : 0 };
    const none = (reason) => ({ reward: { ...base, status: 'not-awarded', reason, settledAtMs: nowMs }, apply() {} });
    const winner = room.players.find((player) => player.uid === room.winnerUid);
    if (actor.manager || room.status !== 'finished' || room.finishReason !== 'completion' || actor.uid !== room.winnerUid
      || !winner?.active || !winner.pieces.length || winner.pieces.some((piece) => piece.node !== 'finish')) return none('ineligible');
    if (policy?.enabled !== true || !Number.isSafeInteger(policy.version) || policy.version < 0
      || !Number.isSafeInteger(policy.amount) || policy.amount <= 0 || policy.amount > 10000) return none('disabled');
    const pending = { ...base, amount: policy.amount, status: 'pending', reason: 'account-unavailable' };
    const receiptRef = db.doc(rewardPath(scope, room.id)), semesterId = `${scope.year}-${scope.semester}`;
    const sourceId = `yut_${room.id}`, activityType = 'weplay_reward';
    const source = `${activityType}:${sourceId}`;
    // Same deterministic identity as the trusted wallet writer. Reading both
    // markers fails closed on partial/orphan accounting rather than paying twice.
    const ledgerId = 'wisled_' + hash([semesterId, accountIdFor(semesterId, actor.uid), 'GRANT', source].join('\n'));
    const [receipt, ledger] = await transaction.getAll(receiptRef, db.doc(`semester_wis_ledger/${ledgerId}`));
    if (receipt.exists || ledger.exists) {
      const r = receipt.data() || {}, l = ledger.data() || {};
      const reconciled = receipt.exists && ledger.exists && r.canonical === true && r.uid === actor.uid
        && r.sourceId === sourceId && r.delta === policy.amount && r.policyId === `weplay:${policy.version}`
        && r.createdBy === 'system:yut' && r.roomId === room.id && r.balanceAfter === l.balanceAfter
        && l.studentUid === actor.uid && l.semesterId === semesterId && l.accountId === accountIdFor(semesterId, actor.uid)
        && l.schemaVersion === 1 && l.policyVersion === 'w7-v1' && l.ledgerEntryId === ledgerId
        && l.actorUid === 'system:yut' && l.actorRole === 'system' && l.initiatedByUid === actor.uid
        && l.type === 'GRANT' && l.activityType === activityType && l.sourceId === source && l.delta === policy.amount && l.receiptId === receiptRef.path
        && Number.isSafeInteger(l.balanceBefore) && l.balanceBefore >= 0
        && Number.isSafeInteger(l.balanceAfter) && l.balanceAfter === l.balanceBefore + policy.amount;
      return { reward: reconciled ? { ...base, amount: policy.amount, status: 'paid', settledAtMs: r.settledAtMs || nowMs } : pending, apply() {} };
    }
    let loaded;
    try { loaded = await wallet.read(transaction, scope, actor.uid); }
    catch (error) {
      if (error.code !== 'failed-precondition') throw error;
      return { reward: pending, apply() {} };
    }
    const result = { reward: pending, apply() {
      let balance;
      try {
        // The trusted writer validates totals before its first staged write.
        balance = wallet.write(transaction, scope, actor.uid, policy.amount, activityType, sourceId, '마우저구 윷놀이 완주 1등', loaded, receiptRef.path);
      } catch (error) {
        if (error.code !== 'failed-precondition') throw error;
        return; // e.g. safe-integer overflow: finish, but do not mint money.
      }
      const day = new Date(nowMs + 9 * 3600000).toISOString().slice(0, 10);
      transaction.create(receiptRef, { uid: actor.uid, type: activityType, activityType, delta: policy.amount,
        balanceAfter: balance, sourceId, sourceLabel: '마우저구 윷놀이 완주 1등', policyId: `weplay:${policy.version}`,
        createdBy: 'system:yut', targetDate: day, targetMonth: day.slice(0, 7), createdAt: Timestamp.fromMillis(nowMs),
        canonical: true, roomId: room.id, settledAtMs: nowMs });
      result.reward = { ...base, amount: policy.amount, status: 'paid', settledAtMs: nowMs };
    } };
    return result;
  };
  return { snapshot, prepare };
}

module.exports = { createYutReward };
