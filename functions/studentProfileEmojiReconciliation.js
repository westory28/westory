const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { accountIdFor } = require('./studentWisWallet');
const { resolveStudentProfileEmoji } = require('./studentProfileEmojiPolicy');

const ACTIVE_POINTER_PATH = 'site_settings/semester_active';
const PROFILE_FIELDS = ['profileEmojiId', 'profileIcon'];
const USER_EVENT_FIELDS = [...PROFILE_FIELDS, 'role', 'deletedAt', 'isDeleted'];
const ACCOUNT_EVENT_FIELDS = [
  'accountId', 'studentUid', 'semesterId', 'rankEarnedTotal', 'status',
  'readOnly', 'schemaVersion', 'policyVersion', 'revision',
];
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const validUid = (uid) => typeof uid === 'string' && uid.length > 0 && uid.length <= 128
  && !uid.includes('/') && uid !== '.' && uid !== '..';
const profileFields = (data) => Object.fromEntries(PROFILE_FIELDS
  .filter((field) => Object.hasOwn(data, field))
  .map((field) => [field, data[field]]));
const fieldsChanged = (before, after, fields) => !before || !after
  || fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
const eventData = (snapshot) => snapshot?.exists ? snapshot.data() : undefined;
const activeScope = (pointer, manifest) => /^\d{4}-[12]$/.test(pointer?.semesterId || '')
  && manifest?.semesterId === pointer.semesterId && manifest.status === 'ACTIVE'
  && manifest.readOnly !== true && safeInteger(manifest.revision, 1)
  && pointer.revision === manifest.revision;

const createStudentProfileEmojiReconciliationService = ({
  db,
  serverTimestamp = () => FieldValue.serverTimestamp(),
}) => {
  const reconcileStudent = async (uid, options = {}) => {
    const apply = options.apply !== false;
    if (!validUid(uid)) return { status: 'skipped', uid, reason: 'invalid_uid', applied: false };
    return db.runTransaction(async (transaction) => {
      const [profileSnapshot, pointerSnapshot] = await transaction.getAll(
        db.doc(`users/${uid}`), db.doc(ACTIVE_POINTER_PATH),
      );
      const profile = profileSnapshot.data();
      const pointer = pointerSnapshot.data();
      const skip = (reason, extra = {}) => ({ status: 'skipped', uid, reason, applied: false, ...extra });
      if (!profileSnapshot.exists || profile?.role !== 'student' || profile.deletedAt || profile.isDeleted === true) {
        return skip('not_active_student');
      }
      // Missing profile fields already display the default and need no writes.
      if (!PROFILE_FIELDS.some((field) => profile[field] !== undefined && profile[field] !== null && profile[field] !== '')) {
        return skip('no_selected_emoji');
      }
      if (!pointerSnapshot.exists || !/^\d{4}-[12]$/.test(pointer?.semesterId || '')) {
        return skip('active_semester_unavailable');
      }
      const semesterId = pointer.semesterId;
      if (Object.hasOwn(options, 'expectedSemesterId') && options.expectedSemesterId !== semesterId) {
        return skip('semester_changed', { semesterId });
      }
      const [year, semester] = semesterId.split('-');
      const accountId = accountIdFor(semesterId, uid);
      const [manifestSnapshot, policySnapshot, accountSnapshot] = await transaction.getAll(
        db.doc(`semester_manifests/${semesterId}`),
        db.doc(`years/${year}/semesters/${semester}/point_policies/current`),
        db.doc(`semester_wis_accounts/${accountId}`),
      );
      if (!manifestSnapshot.exists || !activeScope(pointer, manifestSnapshot.data())) {
        return skip('active_semester_unavailable', { semesterId });
      }
      const before = profileFields(profile);
      if (Object.hasOwn(options, 'expectedBefore')
        && fieldsChanged(options.expectedBefore || {}, before, PROFILE_FIELDS)) {
        return skip('profile_changed', { semesterId, before });
      }
      const account = accountSnapshot.data();
      const hasValidAccount = accountSnapshot.exists
        && account?.accountId === accountId && account.studentUid === uid && account.semesterId === semesterId
        && account.schemaVersion === 1 && account.policyVersion === 'w7-v1'
        && account.status === 'ACTIVE' && account.readOnly !== true && safeInteger(account.revision, 1)
        && safeInteger(account.rankEarnedTotal);
      // Rank access never falls back to legacy wallets, balances or projections.
      const rankEarnedTotal = hasValidAccount ? account.rankEarnedTotal : 0;
      const resolved = resolveStudentProfileEmoji({
        ...before, rankEarnedTotal, rankPolicy: policySnapshot.data()?.rankPolicy,
      });
      if (resolved.isValid) {
        return { status: 'valid', uid, semesterId, reason: resolved.reason, applied: false };
      }
      const after = { profileEmojiId: resolved.profileEmojiId, profileIcon: resolved.profileIcon };
      if (!fieldsChanged(before, after, PROFILE_FIELDS)) {
        return { status: 'valid', uid, semesterId, reason: 'already_default', applied: false };
      }
      if (apply) transaction.set(db.doc(`users/${uid}`), { ...after, updatedAt: serverTimestamp() }, { merge: true });
      return {
        status: 'updated', uid, semesterId, before, after, reason: resolved.reason,
        applied: apply, rankEarnedTotal, accountValid: hasValidAccount,
      };
    });
  };

  const reconcileAll = async ({ apply = true, pageSize = 200, concurrency = 8 } = {}) => {
    const boundedPageSize = Math.min(500, Math.max(1, Number.isSafeInteger(pageSize) ? pageSize : 200));
    const boundedConcurrency = Math.min(20, Math.max(1, Number.isSafeInteger(concurrency) ? concurrency : 8));
    const totals = { scanned: 0, updated: 0, valid: 0, skipped: 0, applied: 0 };
    let cursor;
    for (;;) {
      let query = db.collection('users').where('role', '==', 'student')
        .orderBy(FieldPath.documentId()).limit(boundedPageSize);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (!page.docs.length) break;
      for (let offset = 0; offset < page.docs.length; offset += boundedConcurrency) {
        const results = await Promise.all(page.docs.slice(offset, offset + boundedConcurrency)
          .map((document) => reconcileStudent(document.id, { apply })));
        for (const result of results) {
          totals.scanned += 1;
          totals[result.status] += 1;
          if (result.applied) totals.applied += 1;
        }
      }
      cursor = page.docs[page.docs.length - 1];
      if (page.docs.length < boundedPageSize) break;
    }
    return totals;
  };

  const handleUserWritten = async (event) => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!after || !fieldsChanged(before, after, USER_EVENT_FIELDS)) return null;
    return reconcileStudent(event.params.uid);
  };

  const handleAccountWritten = async (event) => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!fieldsChanged(before, after, ACCOUNT_EVENT_FIELDS)) return null;
    // Re-check both owners after reassignment/deletion using their current account.
    const uids = [...new Set([before?.studentUid, after?.studentUid].filter(validUid))];
    return Promise.all(uids.map((uid) => reconcileStudent(uid)));
  };

  const handlePolicyWritten = async (event) => {
    if (event.params.policyId !== 'current') return null;
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!fieldsChanged(before, after, ['rankPolicy'])) return null;
    const pointer = (await db.doc(ACTIVE_POINTER_PATH).get()).data();
    if (pointer?.semesterId !== `${event.params.year}-${event.params.semester}`) return null;
    // Each transaction re-reads the pointer, manifest, policy, profile and account.
    return reconcileAll();
  };

  const handleSemesterWritten = async (event) => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!after || !fieldsChanged(before, after, ['semesterId', 'revision'])) return null;
    return reconcileAll();
  };

  return {
    reconcileStudent, inspectStudent: (uid, options = {}) => reconcileStudent(uid, { ...options, apply: false }), reconcileAll,
    handleUserWritten, handleAccountWritten, handlePolicyWritten, handleSemesterWritten,
  };
};

const createStudentProfileEmojiReconciliationTriggers = ({ db, register = onDocumentWritten }) => {
  const service = createStudentProfileEmojiReconciliationService({ db });
  const trigger = (document, handler) => register({
    document, region: 'asia-northeast3', database: '(default)',
    timeoutSeconds: 540, memory: '256MiB', retry: true, maxInstances: 5,
  }, handler);
  return {
    reconcileStudentProfileEmojiOnUserWrite: trigger('users/{uid}', service.handleUserWritten),
    reconcileStudentProfileEmojiOnAccountWrite: trigger('semester_wis_accounts/{accountId}', service.handleAccountWritten),
    reconcileStudentProfileEmojiOnPolicyWrite: trigger('years/{year}/semesters/{semester}/point_policies/{policyId}', service.handlePolicyWritten),
    reconcileStudentProfileEmojiOnSemesterWrite: trigger(ACTIVE_POINTER_PATH, service.handleSemesterWritten),
  };
};

module.exports = { createStudentProfileEmojiReconciliationService, createStudentProfileEmojiReconciliationTriggers };
