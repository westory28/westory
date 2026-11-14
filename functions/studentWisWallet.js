const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const accountIdFor = (scope, uid) => 'wisacct_' + hash(scope + '\n' + uid);
const safe = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const fail = () => { throw new HttpsError('failed-precondition', '현재 학기의 위스 계좌를 확인해 주세요.'); };
// A transaction must never post two balances from independently loaded snapshots.
// Multiple services may create separate adapters, so this guard is module-scoped.
const transactionStates = new WeakMap();

// The active school economy is authoritative. Never create a second legacy
// wallet or import an unverified legacy balance while processing a game.
const createStudentWisWallet = ({ db, actorUid = 'system:weplay', validateStudentProfile }) => {
  const loadedSnapshots = new WeakMap();
  const read = async (transaction, scope, uid) => {
    const semesterId = `${scope.year}-${scope.semester}`;
    if (!/^\d{4}-[12]$/.test(semesterId) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) fail();
    const accountId = accountIdFor(semesterId, uid);
    const paths = [
      'site_settings/semester_active', 'semester_manifests/' + semesterId,
      'semester_wis_economies/' + semesterId, 'semester_wis_accounts/' + accountId,
      'users/' + uid, 'student_identities/' + uid,
      'semester_enrollment_slots/slot_' + hash(semesterId + '\n' + uid).slice(0, 40),
      'wis_legacy_migration_controls/' + semesterId,
    ];
    const snapshots = await transaction.getAll(...paths.map((path) => db.doc(path)));
    const [pointer, manifest, economy, wallet, profile, identity, slot, fence] = snapshots.map((snap) => snap.data() || {});
    if (pointer.semesterId !== semesterId || manifest.semesterId !== semesterId || manifest.status !== 'ACTIVE'
      || manifest.readOnly === true || !safe(manifest.revision, 1) || pointer.revision !== manifest.revision
      || economy.semesterId !== semesterId || economy.status !== 'ACTIVE_OPEN' || economy.readOnly === true
      || !safe(economy.revision, 1) || !safe(economy.ledgerEntryCount)
      || fence.enabled === true || fence.writesBlocked === true) fail();
    if (profile.role !== 'student' || profile.deletedAt || profile.isDeleted === true
      || (profile.registrationApprovalStatus !== undefined && profile.registrationApprovalStatus !== 'APPROVED')
      || identity.studentUid !== uid || (identity.accountStatus !== undefined && identity.accountStatus !== 'ACTIVE')
      || slot.studentUid !== uid || slot.semesterId !== semesterId || !slot.activeEnrollmentId
      || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail();
    if (validateStudentProfile) await validateStudentProfile(profile);
    const enrollment = (await transaction.get(db.doc('semester_enrollments/' + slot.activeEnrollmentId))).data() || {};
    if (enrollment.enrollmentId !== slot.activeEnrollmentId || enrollment.semesterId !== semesterId || enrollment.studentUid !== uid
      || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || !enrollment.classId) fail();
    const classroom = (await transaction.get(db.doc('semester_classes/' + enrollment.classId))).data() || {};
    if (classroom.classId !== enrollment.classId || classroom.semesterId !== semesterId || classroom.status !== 'ACTIVE' || classroom.readOnly === true) fail();
    if (wallet.accountId !== accountId || wallet.studentUid !== uid || wallet.semesterId !== semesterId
      || wallet.schemaVersion !== 1 || wallet.policyVersion !== 'w7-v1' || wallet.status !== 'ACTIVE' || wallet.readOnly === true
      || wallet.enrollmentId !== enrollment.enrollmentId || wallet.classId !== enrollment.classId || !safe(wallet.revision, 1)
      || !['balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal'].every((field) => safe(wallet[field]))
      || !Number.isSafeInteger(wallet.adjustedTotal) || !Array.isArray(wallet.recentLedgerEntries)) fail();
    // Firestore can reuse its Transaction object for a retry. A successful read
    // after a staged post proves the SDK reset its write batch for a new attempt:
    // reads after writes within the same attempt are rejected by Firestore.
    let transactionState = transactionStates.get(transaction);
    if (!transactionState || transactionState.written) {
      transactionState = { written: false };
      transactionStates.set(transaction, transactionState);
    }
    const loaded = { wallet, economy, canonical: true };
    loadedSnapshots.set(loaded, { transaction, transactionState, semesterId, uid,
      wallet: { ...wallet, recentLedgerEntries: [...wallet.recentLedgerEntries] }, economy: { ...economy } });
    return loaded;
  };

  const write = (transaction, scope, uid, delta, activityType, sourceId, reason, loaded, receiptId = `years/${scope.year}/semesters/${scope.semester}/point_transactions/${activityType}_${sourceId}`) => {
    const semesterId = `${scope.year}-${scope.semester}`, accountId = accountIdFor(semesterId, uid);
    const snapshot = loaded && loadedSnapshots.get(loaded);
    if (!snapshot || snapshot.transaction !== transaction || snapshot.semesterId !== semesterId || snapshot.uid !== uid
      || snapshot.transactionState !== transactionStates.get(transaction) || snapshot.transactionState.written
      || !Number.isSafeInteger(delta) || delta === 0) fail();
    const { wallet, economy } = snapshot;
    if (wallet.accountId !== accountId || economy.semesterId !== semesterId
      || typeof activityType !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(activityType)
      || typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 512
      || typeof reason !== 'string' || !reason.trim() || reason.length > 1000
      || typeof receiptId !== 'string' || !receiptId.startsWith(`years/${scope.year}/semesters/${scope.semester}/`)
      || receiptId.split('/').some(part => !part) || receiptId.split('/').length % 2 !== 0) fail();
    const type = delta > 0 ? 'GRANT' : 'DEDUCT';
    const source = `${activityType}:${sourceId}`;
    const ledgerEntryId = 'wisled_' + hash([semesterId, accountId, type, source].join('\n'));
    const timestamp = Timestamp.now();
    const balance = wallet.balance + delta;
    const totals = {
      balance, earnedTotal: wallet.earnedTotal + Math.max(0, delta),
      rankEarnedTotal: wallet.rankEarnedTotal + Math.max(0, delta),
      spentTotal: wallet.spentTotal,
      // Match the deployed w7-v1 ledger rebuild contribution for GRANT/DEDUCT.
      adjustedTotal: wallet.adjustedTotal + delta,
    };
    if (![balance, totals.earnedTotal, totals.rankEarnedTotal, wallet.revision + 1, economy.revision + 1,
      economy.ledgerEntryCount + 1].every((value) => safe(value)) || !Number.isSafeInteger(totals.adjustedTotal)) fail();
    const ledger = { schemaVersion: 1, policyVersion: 'w7-v1', ledgerEntryId, semesterId, accountId,
      studentUid: uid, type, activityType, delta, balanceBefore: wallet.balance, balanceAfter: balance,
      sourceId: source, reason, actorUid, actorRole: 'system', initiatedByUid: uid,
      commandId: 'activity_' + hash(source), receiptId,
      createdAt: timestamp, targetDate: new Date(timestamp.toMillis() + 9 * 3600000).toISOString().slice(0, 10) };
    // Mark only after every input/amount check and before the first staged write.
    snapshot.transactionState.written = true;
    loadedSnapshots.delete(loaded);
    transaction.create(db.doc('semester_wis_ledger/' + ledgerEntryId), ledger);
    transaction.set(db.doc('semester_wis_accounts/' + accountId), { ...totals, revision: wallet.revision + 1,
      recentLedgerEntries: [ledger, ...wallet.recentLedgerEntries].slice(0, 100), updatedAt: timestamp, updatedBy: actorUid }, { merge: true });
    const common = { schemaVersion: 1, policyVersion: 'w7-v1', accountId, semesterId, studentUid: uid,
      ledgerRevision: wallet.revision + 1, updatedAt: timestamp };
    transaction.set(db.doc('semester_wis_balances/' + accountId), { ...common, ...totals }, { merge: true });
    transaction.set(db.doc('semester_wis_rankings/' + accountId), { ...common, displayName: wallet.displayName || '',
      classId: wallet.classId, grade: wallet.grade || '', classNumber: wallet.classNumber || '',
      balance, rankEarnedTotal: totals.rankEarnedTotal }, { merge: true });
    transaction.set(db.doc('semester_wis_economies/' + semesterId), { revision: economy.revision + 1,
      ledgerEntryCount: economy.ledgerEntryCount + 1, updatedAt: timestamp, updatedBy: actorUid }, { merge: true });
    return balance;
  };
  return { read, write, get: (scope, uid) => db.runTransaction((transaction) => read(transaction, scope, uid)) };
};
module.exports = { createStudentWisWallet, accountIdFor };
