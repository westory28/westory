const { createHash } = require('node:crypto');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { accountIdFor } = require('./studentWisWallet');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');

const WIS_RANKING_INDEX_COLLECTION = 'semester_wis_preview_entries';
const WIS_RANKING_INDEX_SCHEMA_VERSION = 1;
const WIS_RANKING_INDEX_LIMIT = 2_000;
const ACCOUNT_FIELDS = ['accountId', 'studentUid', 'semesterId', 'rankEarnedTotal', 'status',
  'displayName', 'enrollmentId', 'classId', 'grade', 'classNumber', 'studentNumber'];
const SLOT_FIELDS = ['semesterId', 'studentUid', 'activeEnrollmentId', 'status'];
const ENROLLMENT_FIELDS = ['enrollmentId', 'semesterId', 'studentUid', 'enrollmentStatus',
  'classId', 'displayName', 'studentName', 'grade', 'classNumber', 'studentNumber', 'snapshot'];
const CLASS_FIELDS = ['classId', 'semesterId', 'status', 'grade', 'classNumber'];

const validScope = value => typeof value === 'string' && /^\d{4}-[12]$/.test(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 180 &&
  value === value.trim() && !value.includes('/') && value !== '.' && value !== '..';
const validUid = value => validId(value) && value.length <= 128;
const validAccountId = value => typeof value === 'string' && /^wisacct_[a-f0-9]{64}$/.test(value);
const text = value => String(value || '').trim();
const scoreIsValid = value => Number.isSafeInteger(value) && value >= 0;
const canonicalIdentity = (value, accountId) => validScope(value?.semesterId) && validUid(value?.studentUid) &&
  value.accountId === accountId && accountId === accountIdFor(value.semesterId, value.studentUid);
const buildWisRankingPublicId = (scope, uid) => `wispublic_${createHash('sha256')
  .update(`${scope}\n${uid}`, 'utf8').digest('hex').slice(0, 24)}`;
const isTestStudent = (uid, name) => [uid, name].some(value => {
  const identity = text(value).toLowerCase().replace(/[\s._-]+/g, '');
  return identity === '방테스트' || identity === 'bangtest';
});
const sameBody = (left, right) => Boolean(left) && Object.keys(left).length === Object.keys(right).length &&
  Object.keys(right).every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
const changed = (before, after, fields) => !before || !after ||
  fields.some(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
const eventData = snapshot => snapshot?.exists ? snapshot.data() : undefined;

// Pure projection shared by live reconciliation and the dry-run backfill.
// Only canonical source documents decide eligibility. Previous data can retain
// an invalid entry's routing keys, never its public name or eligibility.
const deriveWisRankingPreviewEntry = ({ accountId, account, slot, enrollment, semesterClass, previous }) => {
  const accountValid = canonicalIdentity(account, accountId) && scoreIsValid(account.rankEarnedTotal);
  const identity = accountValid ? account : canonicalIdentity(previous, accountId) ? previous : null;
  const scope = identity?.semesterId || '';
  const uid = identity?.studentUid || '';
  const body = {
    schemaVersion: WIS_RANKING_INDEX_SCHEMA_VERSION, accountId, studentUid: uid, semesterId: scope,
    rankEarnedTotal: accountValid ? account.rankEarnedTotal : 0,
    publicId: identity ? buildWisRankingPublicId(scope, uid) : '',
    grade: '', classNumber: '',
    classId: validId(previous?.classId) ? previous.classId : '',
    enrollmentId: validId(previous?.enrollmentId) ? previous.enrollmentId : '',
    displayName: '', studentNumber: '', hallZeroEligible: false, eligible: false,
  };
  if (!accountValid) return body;
  const slotValid = slot?.semesterId === scope && slot.studentUid === uid &&
    validId(slot.activeEnrollmentId) && (slot.status === undefined || slot.status === 'ACTIVE');
  const enrollmentIdentityValid = slotValid && enrollment?.enrollmentId === slot.activeEnrollmentId &&
    enrollment.semesterId === scope && enrollment.studentUid === uid && validId(enrollment.classId);
  if (slotValid) body.enrollmentId = slot.activeEnrollmentId;
  if (enrollmentIdentityValid) body.classId = enrollment.classId;
  const classValid = enrollmentIdentityValid && semesterClass?.semesterId === scope &&
    (semesterClass.classId === undefined || semesterClass.classId === enrollment.classId);
  if (!classValid || enrollment.enrollmentStatus !== 'ACTIVE') return body;
  const snapshot = enrollment.snapshot && typeof enrollment.snapshot === 'object' ? enrollment.snapshot : {};
  body.grade = text(snapshot.grade || enrollment.grade || semesterClass.grade);
  body.classNumber = text(snapshot.classNumber || enrollment.classNumber || semesterClass.classNumber);
  const name = text(enrollment.displayName || enrollment.studentName || snapshot.displayName || account.displayName) || '학생';
  body.hallZeroEligible = account.status === 'ACTIVE' && semesterClass.status === 'ACTIVE';
  body.eligible = Boolean(body.grade && body.classNumber) && !isTestStudent(uid, name) &&
    (body.rankEarnedTotal > 0 || body.hallZeroEligible);
  if (body.eligible) {
    body.displayName = name;
    body.studentNumber = text(enrollment.studentNumber || snapshot.studentNumber);
  }
  return body;
};

const mapBounded = async (items, action, concurrency = 10) => {
  const width = Number.isSafeInteger(concurrency) ? Math.min(10, Math.max(1, concurrency)) : 10;
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await action(items[index]);
    }
  }));
  return results;
};
const summarize = results => results.reduce((totals, result) => {
  totals.scanned++;
  totals[result.status]++;
  if (result.applied) totals.applied++;
  if (result.eligible) totals.eligible++;
  return totals;
}, { scanned: 0, updated: 0, unchanged: 0, skipped: 0, applied: 0, eligible: 0 });

const createWisRankingIndexService = ({ db }) => {
  if (!db) throw new TypeError('db is required.');
  const reconcileAccount = async (accountId, { apply = true } = {}) => {
    if (!validAccountId(accountId)) return { status: 'skipped', applied: false, eligible: false };
    return db.runTransaction(async transaction => {
      const accountRef = db.doc(`semester_wis_accounts/${accountId}`);
      const entryRef = db.doc(`${WIS_RANKING_INDEX_COLLECTION}/${accountId}`);
      const [accountSnapshot, entrySnapshot] = await transaction.getAll(accountRef, entryRef);
      const account = accountSnapshot.exists ? accountSnapshot.data() : undefined;
      const previous = entrySnapshot.exists ? entrySnapshot.data() : undefined;
      if (!accountSnapshot.exists && !entrySnapshot.exists) return { status: 'skipped', applied: false, eligible: false };
      let slot, enrollment, semesterClass;
      if (canonicalIdentity(account, accountId) && scoreIsValid(account.rankEarnedTotal)) {
        const slotSnapshot = await transaction.get(db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(account.semesterId, account.studentUid)}`));
        slot = slotSnapshot.exists ? slotSnapshot.data() : undefined;
        if (slot?.semesterId === account.semesterId && slot.studentUid === account.studentUid && validId(slot.activeEnrollmentId)) {
          const enrollmentSnapshot = await transaction.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`));
          enrollment = enrollmentSnapshot.exists ? enrollmentSnapshot.data() : undefined;
          if (enrollment?.enrollmentId === slot.activeEnrollmentId && enrollment.semesterId === account.semesterId &&
            enrollment.studentUid === account.studentUid && validId(enrollment.classId)) {
            const classSnapshot = await transaction.get(db.doc(`semester_classes/${enrollment.classId}`));
            semesterClass = classSnapshot.exists ? classSnapshot.data() : undefined;
          }
        }
      }
      const body = deriveWisRankingPreviewEntry({ accountId, account, previous, slot, enrollment, semesterClass });
      const needsWrite = !sameBody(previous, body);
      if (needsWrite && apply) transaction.set(entryRef, body);
      return { status: needsWrite ? 'updated' : 'unchanged', applied: needsWrite && apply, eligible: body.eligible };
    }, apply ? undefined : { readOnly: true });
  };
  const reconcileIds = async (ids, options = {}) => summarize(await mapBounded([...new Set(ids)],
    accountId => reconcileAccount(accountId, options), options.concurrency));
  const rebuildSemester = async ({ semesterId, apply = false, concurrency = 10 } = {}) => {
    if (!validScope(semesterId)) throw new TypeError('A canonical semesterId is required.');
    const pages = await Promise.all(['semester_wis_accounts', WIS_RANKING_INDEX_COLLECTION]
      .map(collection => db.collection(collection).where('semesterId', '==', semesterId)
        .limit(WIS_RANKING_INDEX_LIMIT + 1).get()));
    const ids = [...new Set(pages.flatMap(page => page.docs.map(document => document.id)))];
    if (pages.some(page => page.docs.length > WIS_RANKING_INDEX_LIMIT) || ids.length > WIS_RANKING_INDEX_LIMIT)
      throw new Error('Wis ranking index account limit exceeded (2000).');
    // Include orphaned derived entries after a missed deletion event. Their
    // missing source becomes an ineligible tombstone without touching sources.
    return reconcileIds(ids, { apply, concurrency });
  };
  const handleAccountWritten = async event => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!changed(before, after, ACCOUNT_FIELDS)) return null;
    return reconcileAccount(event.params?.accountId);
  };
  // Event bodies provide bounded routing hints only. Every selected account and
  // its current slot/enrollment/class are re-read inside its own transaction.
  const handleSlotWritten = async event => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!changed(before, after, SLOT_FIELDS) || !validId(event.params?.slotId)) return null;
    const current = await db.doc(`semester_enrollment_slots/${event.params.slotId}`).get();
    const identities = [before, after, current.exists ? current.data() : undefined].filter(value =>
      validScope(value?.semesterId) && validUid(value?.studentUid) &&
      buildEnrollmentSlotId(value.semesterId, value.studentUid) === event.params.slotId);
    return reconcileIds(identities.map(value => accountIdFor(value.semesterId, value.studentUid)));
  };
  const handleEnrollmentWritten = async event => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!changed(before, after, ENROLLMENT_FIELDS) || !validId(event.params?.enrollmentId)) return null;
    const current = await db.doc(`semester_enrollments/${event.params.enrollmentId}`).get();
    const identities = [before, after, current.exists ? current.data() : undefined].filter(value =>
      value?.enrollmentId === event.params.enrollmentId && validScope(value.semesterId) && validUid(value.studentUid));
    return reconcileIds(identities.map(value => accountIdFor(value.semesterId, value.studentUid)));
  };
  const handleClassWritten = async event => {
    const before = eventData(event.data?.before), after = eventData(event.data?.after);
    if (!changed(before, after, CLASS_FIELDS) || !validId(event.params?.classId)) return null;
    const page = await db.collection(WIS_RANKING_INDEX_COLLECTION).where('classId', '==', event.params.classId)
      .limit(WIS_RANKING_INDEX_LIMIT + 1).get();
    if (page.docs.length > WIS_RANKING_INDEX_LIMIT) throw new Error('Wis ranking index class limit exceeded (2000).');
    return reconcileIds(page.docs.map(document => document.id));
  };
  return { reconcileAccount, rebuildSemester, handleAccountWritten, handleSlotWritten, handleEnrollmentWritten, handleClassWritten };
};

const createWisRankingIndexTriggers = ({ db, register = onDocumentWritten }) => {
  const service = createWisRankingIndexService({ db });
  // Failures stay visible in the function logs and can be repaired with the
  // bounded rebuild. Do not repeatedly retry permanent source/cap failures.
  const trigger = (document, handler) => register({ document, region: 'us-central1', database: '(default)',
    timeoutSeconds: 540, memory: '256MiB', retry: false, maxInstances: 5 }, handler);
  return {
    updateWisRankingIndexOnAccountWrite: trigger('semester_wis_accounts/{accountId}', service.handleAccountWritten),
    updateWisRankingIndexOnSlotWrite: trigger('semester_enrollment_slots/{slotId}', service.handleSlotWritten),
    updateWisRankingIndexOnEnrollmentWrite: trigger('semester_enrollments/{enrollmentId}', service.handleEnrollmentWritten),
    updateWisRankingIndexOnClassWrite: trigger('semester_classes/{classId}', service.handleClassWritten),
  };
};

module.exports = { WIS_RANKING_INDEX_COLLECTION, WIS_RANKING_INDEX_SCHEMA_VERSION, WIS_RANKING_INDEX_LIMIT,
  buildWisRankingPublicId, deriveWisRankingPreviewEntry, createWisRankingIndexService, createWisRankingIndexTriggers };
