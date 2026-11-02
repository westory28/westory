const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const TYPE = 'student_registration_requested';
const ACTIONABLE = ['PENDING', 'APPROVED_PENDING_ACCOUNT'];
const MAX_RECIPIENTS = 100;
const PAGE_SIZE = 100;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[\\/\s\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value);
const schoolEmail = value => /^[^@\s]+@yongshin-ms\.ms\.kr$/i.test(String(value || ''));
const text = (value, length = 80) => String(value || '').replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim().slice(0, length);
const active = profile => profile && profile.isDeleted !== true && !profile.deletedAt && profile.disabled !== true;
const timestampMs = value => typeof value?.toMillis === 'function' ? value.toMillis() : 0;
const snapshotData = snapshot => snapshot?.exists ? snapshot.data() : undefined;
const noticeId = uid => `registration_${createHash('sha256').update(uid).digest('hex')}`;
const profileFields = profile => JSON.stringify([profile?.role, profile?.registrationApprovalStatus,
  profile?.name, profile?.grade, profile?.class, profile?.number, profile?.email,
  profile?.approvedSemesterId, profile?.isDeleted, profile?.deletedAt, profile?.disabled]);
const scopeIsActive = (pointer, manifest) => /^\d{4}-[12]$/.test(pointer?.semesterId || '')
  && manifest?.semesterId === pointer.semesterId && manifest.status === 'ACTIVE' && manifest.readOnly !== true
  && Number.isSafeInteger(manifest.revision) && manifest.revision > 0 && manifest.revision === pointer.revision;

// Mandatory approval work uses personal inboxes, never student broadcasts or
// optional announcement settings. The durable receipt also survives inbox clear.
const createStudentRegistrationNotificationService = ({ db, resolveAdminUid = async () => '', now = Date.now }) => {
  const reconcileStudent = async (uid, { apply = true, expectedSemesterId } = {}) => {
    if (!validUid(uid)) return { status: 'skipped', reason: 'invalid_uid', created: 0, updated: 0 };
    const adminUid = await resolveAdminUid();
    return db.runTransaction(async transaction => {
      const [user, pointerSnapshot] = await transaction.getAll(db.doc(`users/${uid}`), db.doc('site_settings/semester_active'));
      const profile = snapshotData(user), pointer = snapshotData(pointerSnapshot);
      const skipped = reason => ({ status: 'skipped', reason, created: 0, updated: 0 });
      if (!/^\d{4}-[12]$/.test(pointer?.semesterId || '')) return skipped('active_semester_unavailable');
      if (expectedSemesterId && pointer.semesterId !== expectedSemesterId) return skipped('semester_changed');
      const [year, semester] = pointer.semesterId.split('-');
      const root = `years/${year}/semesters/${semester}`;
      const key = noticeId(uid), receiptRef = db.doc(`${root}/student_registration_notification_receipts/${key}`);
      const [manifestSnapshot, receiptSnapshot] = await transaction.getAll(db.doc(`semester_manifests/${pointer.semesterId}`), receiptRef);
      if (!scopeIsActive(pointer, snapshotData(manifestSnapshot))) return skipped('active_semester_unavailable');
      const receipt = snapshotData(receiptSnapshot);
      const isPending = active(profile) && profile.role === 'student' && schoolEmail(profile.email)
        && ACTIONABLE.includes(profile.registrationApprovalStatus)
        && (profile.registrationApprovalStatus !== 'APPROVED_PENDING_ACCOUNT' || profile.approvedSemesterId === pointer.semesterId);
      if (!isPending && !receipt) return skipped('not_pending');
      const status = isPending ? profile.registrationApprovalStatus
        : profile?.registrationApprovalStatus === 'APPROVED' ? 'APPROVED'
          : profile?.registrationApprovalStatus === 'REJECTED' ? 'REJECTED' : 'CLOSED';
      const name = text(profile?.name || profile?.displayName) || '학생';
      const fingerprint = JSON.stringify([status, name, text(profile?.grade, 12), text(profile?.class, 12), text(profile?.number, 12)]);
      if (receipt?.fingerprint === fingerprint) return { status: 'unchanged', created: 0, updated: 0 };

      let recipients;
      if (receipt) {
        recipients = Array.isArray(receipt.recipientUids) ? receipt.recipientUids.filter(validUid) : [];
      } else {
        const teachers = await transaction.get(db.collection('users').where('role', '==', 'teacher').limit(MAX_RECIPIENTS + 1));
        if (teachers.docs.length > MAX_RECIPIENTS) throw new Error('REGISTRATION_NOTIFICATION_RECIPIENT_LIMIT');
        recipients = teachers.docs.filter(row => active(row.data()) && schoolEmail(row.data().email)).map(row => row.id);
        if (validUid(adminUid)) recipients.push(adminUid);
        recipients = [...new Set(recipients)].filter(recipient => recipient !== uid);
        if (!recipients.length) throw new Error('REGISTRATION_NOTIFICATION_RECIPIENTS_UNAVAILABLE');
      }
      if (recipients.length > MAX_RECIPIENTS + 1) throw new Error('REGISTRATION_NOTIFICATION_RECEIPT_INVALID');
      const refs = recipients.map(recipientUid => {
        const inbox = db.doc(`${root}/notification_inboxes/${recipientUid}`);
        return { recipientUid, inbox, item: db.doc(`${inbox.path}/items/${key}`) };
      });
      const snapshots = refs.length ? await transaction.getAll(...refs.flatMap(ref => [ref.inbox, ref.item, db.doc(`users/${ref.recipientUid}`)])) : [];
      const at = Timestamp.fromMillis(now());
      const title = status === 'PENDING' ? '학생 가입 신청'
        : status === 'APPROVED_PENDING_ACCOUNT' ? '학생 가입 승인 마무리'
          : status === 'APPROVED' ? '학생 가입 승인 완료' : status === 'REJECTED' ? '학생 가입 신청 거부' : '학생 가입 신청 종료';
      const identity = [text(profile?.grade, 12) && `${text(profile.grade, 12)}학년`,
        text(profile?.class, 12) && `${text(profile.class, 12)}반`, text(profile?.number, 12) && `${text(profile.number, 12)}번`, name].filter(Boolean).join(' ');
      const body = isPending ? `${identity} 학생의 가입 ${status === 'PENDING' ? '승인 요청이 도착했습니다.' : '승인을 마무리해 주세요.'}`
        : `${name} 학생의 가입 신청이 ${status === 'APPROVED' ? '승인되었습니다.' : status === 'REJECTED' ? '거부되었습니다.' : '종료되었습니다.'}`;
      let created = 0, updated = 0;
      refs.forEach((ref, index) => {
        const inbox = snapshotData(snapshots[index * 3]) || {}, item = snapshotData(snapshots[index * 3 + 1]);
        const recipient = snapshotData(snapshots[index * 3 + 2]);
        const authorized = ref.recipientUid === adminUid || active(recipient) && recipient.role === 'teacher' && schoolEmail(recipient.email);
        const unreadCount = Math.max(0, Number(inbox.unreadCount) || 0);
        const updatedAt = Timestamp.fromMillis(Math.max(timestampMs(inbox.updatedAt) + 1, at.toMillis()));
        // Re-check old recipients before exposing any changed applicant details.
        if (!authorized) {
          if (item) {
            updated++;
            if (apply) {
              transaction.delete(ref.item);
              transaction.set(ref.inbox, { uid: ref.recipientUid,
                unreadCount: Math.max(0, unreadCount - (!item.readAt ? 1 : 0)), updatedAt }, { merge: true });
            }
          }
          return;
        }
        // A deleted notification stays deleted, including on trigger replay.
        if (!item && receipt) return;
        if (!item && !isPending) return;
        if (!item) {
          created++;
          if (apply) {
            transaction.set(ref.item, {
              type: TYPE, title, body, targetUrl: `/teacher/students?registration=${encodeURIComponent(uid)}`,
              entityType: 'student_registration', entityId: uid, actorUid: uid, recipientUid: ref.recipientUid,
              priority: 'high', dedupeKey: `${TYPE}:${pointer.semesterId}:${uid}`, registrationStatus: status,
              readAt: null, createdAt: at, expiresAt: Timestamp.fromMillis(at.toMillis() + RETENTION_MS),
            });
            transaction.set(ref.inbox, { uid: ref.recipientUid, unreadCount: unreadCount + 1,
              updatedAt }, { merge: true });
          }
        } else {
          updated++;
          if (apply) {
            transaction.set(ref.item, { title, body, registrationStatus: status,
              ...(!isPending && !item.readAt ? { readAt: at } : {}) }, { merge: true });
            transaction.set(ref.inbox, { uid: ref.recipientUid,
              unreadCount: Math.max(0, unreadCount - (!isPending && !item.readAt ? 1 : 0)),
              updatedAt }, { merge: true });
          }
        }
      });
      if (apply) transaction.set(receiptRef, { schemaVersion: 1, studentUid: uid, semesterId: pointer.semesterId,
        recipientUids: recipients, fingerprint, status, updatedAt: at,
        ...(!receipt ? { createdAt: at } : {}) }, { merge: true });
      return { status: isPending ? 'pending' : 'resolved', created, updated, applied: apply };
    });
  };

  const reconcilePending = async ({ apply = false, expectedSemesterId } = {}) => {
    const candidates = await db.collection('users').where('registrationApprovalStatus', 'in', ACTIONABLE).limit(PAGE_SIZE + 1).get();
    if (candidates.docs.length > PAGE_SIZE) throw new Error('REGISTRATION_NOTIFICATION_BACKFILL_LIMIT');
    const totals = { scanned: candidates.docs.length, created: 0, updated: 0, skipped: 0, unchanged: 0, applied: apply };
    for (const row of candidates.docs) {
      const result = await reconcileStudent(row.id, { apply, expectedSemesterId });
      totals.created += result.created; totals.updated += result.updated;
      if (result.status === 'skipped') totals.skipped++;
      if (result.status === 'unchanged') totals.unchanged++;
    }
    return totals;
  };
  const handleUserWritten = async event => {
    const before = snapshotData(event.data?.before), after = snapshotData(event.data?.after);
    if (profileFields(before) === profileFields(after)) return null;
    if (!ACTIONABLE.includes(before?.registrationApprovalStatus) && !ACTIONABLE.includes(after?.registrationApprovalStatus)) return null;
    const result = await reconcileStudent(event.params.uid);
    // A temporarily unavailable pointer during cutover must not acknowledge and
    // lose a signup event. Retry with the current canonical state and scope.
    if (result.reason === 'active_semester_unavailable') throw new Error('REGISTRATION_NOTIFICATION_SEMESTER_UNAVAILABLE');
    return result;
  };
  return { reconcileStudent, reconcilePending, handleUserWritten };
};

const createStudentRegistrationNotificationTriggers = ({ db, auth, register = onDocumentWritten }) => {
  const resolveAdminUid = async () => {
    try {
      const account = await auth.getUserByEmail(ADMIN_EMAIL);
      return account.disabled !== true && account.emailVerified === true ? account.uid : '';
    } catch (error) {
      if (error.code === 'auth/user-not-found') return '';
      throw error;
    }
  };
  const service = createStudentRegistrationNotificationService({ db, resolveAdminUid });
  return { notifyStudentRegistrationOnUserWrite: register({ document: 'users/{uid}', database: '(default)',
    region: 'us-central1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 5, retry: true }, service.handleUserWritten) };
};

module.exports = { TYPE, noticeId, createStudentRegistrationNotificationService, createStudentRegistrationNotificationTriggers };
