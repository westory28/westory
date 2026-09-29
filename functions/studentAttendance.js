const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertAttendanceSession } = require('./attendanceSession');

const SYSTEM_ACTOR = 'system:attendance-reward';
const HISTORY_LIMIT = 4000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const accountIdFor = (scope, uid) => 'wisacct_' + hash(scope + '\n' + uid);
const ledgerIdFor = (scope, accountId, sourceId) => 'wisled_' + hash([scope, accountId, 'GRANT', sourceId].join('\n'));
const safe = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const key = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const fail = (reason, message = '출석 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code = 'failed-precondition') => {
  throw new HttpsError(code, message, { reason: 'ATTENDANCE_' + reason });
};
const getAttendanceDate = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

// Match the existing maintenance gate's fail-closed stored-document contract.
const assertMaintenanceConfig = (value) => {
  const keys = ['blockedRoles', 'bypassUids', 'enabled', 'message', 'revision', 'startedAt', 'title', 'updatedAt', 'updatedBy'];
  const text = (item, max) => typeof item === 'string' && item.length > 0 && item === item.trim() && item.length <= max;
  if (Object.keys(value).sort().join('|') !== keys.sort().join('|')
      || typeof value.enabled !== 'boolean' || !safe(value.revision)
      || !Array.isArray(value.blockedRoles) || value.blockedRoles.length !== 1 || value.blockedRoles[0] !== 'student'
      || !Array.isArray(value.bypassUids) || value.bypassUids.length > 20
      || value.bypassUids.some((uid) => !text(uid, 128)) || new Set(value.bypassUids).size !== value.bypassUids.length
      || !text(value.title, 80) || !text(value.message, 500) || !text(value.updatedBy, 128)
      || !(value.updatedAt instanceof Timestamp)
      || (value.enabled ? !(value.startedAt instanceof Timestamp) : value.startedAt !== null)) {
    fail('MAINTENANCE_CONFIG_INVALID', '점검 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'unavailable');
  }
};

const resolvePolicy = (raw) => {
  const rules = raw.rewardPolicy || {};
  const amount = (value, fallback) => {
    const result = Number(value ?? fallback);
    if (!safe(result) || result > 1000000) fail('POLICY_INVALID');
    return result;
  };
  return {
    enabled: (rules.autoEnabled ?? raw.autoRewardEnabled) !== false,
    daily: rules.attendance?.enabled === false ? 0 : amount(raw.attendanceDaily ?? rules.attendance?.amount, 5),
    monthly: rules.attendanceMonthlyBonus?.enabled === false ? 0 : amount(raw.attendanceMonthlyBonus ?? rules.attendanceMonthlyBonus?.amount, 20),
    milestoneEnabled: (raw.attendanceMilestoneBonusEnabled ?? rules.attendanceMilestoneBonus?.enabled) === true,
    milestones: Object.fromEntries([50, 100, 200, 300].map((count) => [count,
      amount(raw['attendanceMilestone' + count] ?? rules.attendanceMilestoneBonus?.amounts?.[count], 0)])),
  };
};

// The deployed w7-v1 rebuild counts attendance as ordinary GRANT. Keep its
// adjustedTotal contribution (+delta), alongside earned/rank totals, until the
// economy's automatic-activity contract is migrated consistently.
// actorRole remains system, so teacher-only manual reversal cannot reverse it.
const writeProjection = (transaction, db, account, totals, timestamp, ledgers) => {
  const revision = account.revision + 1;
  transaction.set(db.doc('semester_wis_accounts/' + account.accountId), {
    revision, ...totals,
    recentLedgerEntries: [...ledgers].reverse().concat(account.recentLedgerEntries).slice(0, 100),
    updatedAt: timestamp, updatedBy: SYSTEM_ACTOR,
  }, { merge: true });
  const common = {
    schemaVersion: 1, policyVersion: 'w7-v1',
    accountId: account.accountId, semesterId: account.semesterId, studentUid: account.studentUid,
    ledgerRevision: revision, updatedAt: timestamp,
  };
  transaction.set(db.doc('semester_wis_balances/' + account.accountId), { ...common, ...totals }, { merge: true });
  transaction.set(db.doc('semester_wis_rankings/' + account.accountId), {
    ...common, displayName: String(account.displayName || ''), classId: account.classId || '',
    grade: String(account.grade || ''), classNumber: String(account.classNumber || ''),
    balance: totals.balance, rankEarnedTotal: totals.rankEarnedTotal,
  }, { merge: true });
};

const createStudentAttendanceHandler = ({ db, now = () => new Date() }) => async (request) => {
  const uid = request.auth?.uid;
  if (!uid) fail('AUTH_REQUIRED', '로그인한 뒤 출석을 체크해 주세요.', 'unauthenticated');
  const email = String(request.auth.token?.email || '').trim().toLowerCase();
  if (!key(uid) || (!/@yongshin-ms\.ms\.kr$/i.test(email) && email !== 'westoria28@gmail.com')) {
    fail('ACCOUNT_FORBIDDEN', '출석을 체크할 수 있는 계정이 아닙니다.', 'permission-denied');
  }
  const data = request.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some((field) => !['year', 'semester', '_session'].includes(field))) {
    fail('INVALID_INPUT', '학기 정보를 확인한 뒤 다시 시도해 주세요.', 'invalid-argument');
  }
  const year = String(data.year || '').trim(), semester = String(data.semester || '').trim();
  if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester)) {
    fail('INVALID_SCOPE', '학기 정보를 확인한 뒤 다시 시도해 주세요.', 'invalid-argument');
  }
  const nowDate = now(), timestamp = Timestamp.fromDate(nowDate);
  const attendanceDate = getAttendanceDate(nowDate), month = attendanceDate.slice(0, 7);
  const scope = year + '-' + semester, attendanceScope = year + '_' + semester;
  const accountId = accountIdFor(scope, uid), root = 'years/' + year + '/semesters/' + semester;
  const attendanceRef = db.doc('users/' + uid + '/attendance/' + attendanceScope + '_' + attendanceDate);

  return db.runTransaction(async (transaction) => {
    await assertAttendanceSession({ request, transaction, db, nowDate });
    const paths = [
      'site_settings/config', 'site_settings/semester_active', 'semester_manifests/' + scope,
      'users/' + uid, 'student_identities/' + uid,
      'semester_enrollment_slots/slot_' + hash(scope + '\n' + uid).slice(0, 40),
      'semester_wis_accounts/' + accountId, 'semester_wis_economies/' + scope,
      'wis_legacy_migration_controls/' + scope, 'site_settings/student_maintenance',
      root + '/point_policies/current', attendanceRef.path,
    ];
    const snapshots = await transaction.getAll(...paths.map((path) => db.doc(path)));
    const [config, pointer, manifest, profile, identity, slot, account, economy, fence, maintenance, rawPolicy, attendance] =
      snapshots.map((snapshot) => snapshot.data() || {});
    if (String(config.year || '').trim() !== year || String(config.semester || '').trim() !== semester
        || pointer.semesterId !== scope || manifest.semesterId !== scope || manifest.status !== 'ACTIVE'
        || manifest.readOnly === true || !safe(manifest.revision, 1) || pointer.revision !== manifest.revision) {
      fail('SEMESTER_CHANGED', '현재 학기에서만 출석을 체크할 수 있습니다.');
    }
    if (profile.role !== 'student' || (profile.registrationApprovalStatus !== undefined && profile.registrationApprovalStatus !== 'APPROVED')
        || identity.studentUid !== uid || (identity.accountStatus !== undefined && identity.accountStatus !== 'ACTIVE')) {
      fail('STUDENT_INACTIVE', '승인된 학생 계정으로 출석을 체크해 주세요.', 'permission-denied');
    }
    if (snapshots[9].exists) assertMaintenanceConfig(maintenance);
    if (maintenance.enabled === true && email !== 'westoria28@gmail.com'
        && !(Array.isArray(maintenance.bypassUids) && maintenance.bypassUids.includes(uid))) {
      fail('MAINTENANCE', '지금은 점검 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    if (fence.enabled === true || fence.writesBlocked === true) fail('MIGRATION_BLOCKED', '위스 자료를 이전하는 중입니다. 잠시 후 다시 시도해 주세요.');
    if (slot.semesterId !== scope || slot.studentUid !== uid || (slot.status !== undefined && slot.status !== 'ACTIVE')
        || !key(slot.activeEnrollmentId)) fail('ENROLLMENT_INVALID');
    const enrollment = (await transaction.get(db.doc('semester_enrollments/' + slot.activeEnrollmentId))).data() || {};
    if (enrollment.enrollmentId !== slot.activeEnrollmentId || enrollment.semesterId !== scope || enrollment.studentUid !== uid
        || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || !key(enrollment.classId)) fail('ENROLLMENT_INVALID');
    const classData = (await transaction.get(db.doc('semester_classes/' + enrollment.classId))).data() || {};
    if (classData.semesterId !== scope || classData.classId !== enrollment.classId || classData.status !== 'ACTIVE' || classData.readOnly === true) fail('CLASS_INACTIVE');
    if (account.schemaVersion !== 1 || account.policyVersion !== 'w7-v1' || account.accountId !== accountId
        || account.semesterId !== scope || account.studentUid !== uid || account.status !== 'ACTIVE' || account.readOnly === true
        || account.enrollmentId !== enrollment.enrollmentId || account.classId !== enrollment.classId || !safe(account.revision, 1)
        || !['balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal'].every((field) => safe(account[field]))
        || !Number.isSafeInteger(account.adjustedTotal) || !Array.isArray(account.recentLedgerEntries)) fail('WIS_ACCOUNT_INVALID');
    if (economy.semesterId !== scope || economy.status !== 'ACTIVE_OPEN' || economy.readOnly === true
        || !safe(economy.revision, 1) || !safe(economy.ledgerEntryCount)) fail('WIS_ECONOMY_CLOSED');

    const emptyReward = {
      attendanceRecorded: true, attendanceDate, duplicate: snapshots[11].exists,
      awarded: false, amount: 0, bonusAwarded: false, bonusAmount: 0,
      monthlyBonusAwarded: false, monthlyBonusAmount: 0, milestoneBonusAmount: 0,
      totalAwarded: 0, balance: account.balance,
    };
    if (attendance.rewardProcessed === true) return { ...emptyReward, duplicate: true };

    // Client-written dates cannot establish reward history. Only server-confirmed
    // attendance and either generation of trusted reward ledgers count.
    const [recordSnapshot, legacySnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(db.collection('users/' + uid + '/attendance').where('scope', '==', attendanceScope).limit(HISTORY_LIMIT + 1)),
      transaction.get(db.collection(root + '/point_transactions').where('uid', '==', uid).limit(HISTORY_LIMIT + 1)),
      transaction.get(db.collection('semester_wis_ledger').where('studentUid', '==', uid).limit(HISTORY_LIMIT + 1)),
    ]);
    if ([recordSnapshot, legacySnapshot, ledgerSnapshot].some((snapshot) => snapshot.size > HISTORY_LIMIT)) fail('HISTORY_LIMIT_EXCEEDED');
    const legacy = legacySnapshot.docs.map((doc) => doc.data());
    const ledgers = ledgerSnapshot.docs.map((doc) => doc.data()).filter((row) => row.semesterId === scope && row.type === 'GRANT');
    const dates = new Set(recordSnapshot.docs.map((doc) => doc.data())
      .filter((row) => row.rewardProcessed === true).map((row) => row.date));
    for (const row of [...legacy, ...ledgers]) {
      if ((row.activityType || row.type) === 'attendance') dates.add(row.targetDate || String(row.sourceId || '').replace(/^attendance[:-]/, ''));
    }
    for (const date of dates) if (!validDate(date) || date > attendanceDate) dates.delete(date);
    dates.add(attendanceDate);
    const policy = resolvePolicy(rawPolicy), candidates = [];
    const add = (type, amount, sourceId, legacySourceId, reason) => {
      if (amount > 0) candidates.push({ type, amount, sourceId, legacySourceId, reason });
    };
    if (policy.enabled) {
      add('attendance', policy.daily, 'attendance:' + attendanceDate, 'attendance-' + attendanceDate, attendanceDate + ' 출석 체크');
      const monthDays = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      if (Number(attendanceDate.slice(8)) === monthDays && [...dates].filter((date) => date.startsWith(month + '-')).length === monthDays) {
        add('attendance_monthly_bonus', policy.monthly, 'attendance-monthly:' + month, month, month + ' 월간 개근 보너스');
      }
      if (policy.milestoneEnabled && policy.milestones[dates.size]) {
        add('attendance_milestone_bonus', policy.milestones[dates.size], 'attendance-milestone:' + dates.size,
          'attendance-milestone-' + dates.size, '출석 ' + dates.size + '회 달성 보너스');
      }
    }
    const posts = candidates.filter((item) => !legacy.some((row) => row.type === item.type && row.sourceId === item.legacySourceId)
      && !ledgers.some((row) => row.sourceId === item.sourceId && row.accountId === accountId))
      .map((item) => ({ ...item, id: ledgerIdFor(scope, accountId, item.sourceId) }));
    if (posts.length) {
      const priorPosts = await transaction.getAll(...posts.map((post) => db.doc('semester_wis_ledger/' + post.id)));
      if (priorPosts.some((snapshot) => snapshot.exists)) fail('LEDGER_SOURCE_MISMATCH');
    }
    const totalAwarded = posts.reduce((sum, post) => sum + post.amount, 0);
    const totals = {
      balance: account.balance + totalAwarded, earnedTotal: account.earnedTotal + totalAwarded,
      rankEarnedTotal: account.rankEarnedTotal + totalAwarded, spentTotal: account.spentTotal,
      adjustedTotal: account.adjustedTotal + totalAwarded,
    };
    if (![totalAwarded, totals.balance, totals.earnedTotal, totals.rankEarnedTotal, account.revision + 1,
      economy.revision + 1, economy.ledgerEntryCount + posts.length].every((value) => safe(value))
      || !Number.isSafeInteger(totals.adjustedTotal)) fail('AMOUNT_OVERFLOW');
    let runningBalance = account.balance;
    const newLedgers = posts.map((post) => {
      const balanceBefore = runningBalance;
      runningBalance += post.amount;
      return {
        schemaVersion: 1, policyVersion: 'w7-v1', ledgerEntryId: post.id,
        semesterId: scope, accountId, studentUid: uid, type: 'GRANT', activityType: post.type,
        delta: post.amount, balanceBefore, balanceAfter: runningBalance, sourceId: post.sourceId,
        reason: post.reason, actorUid: SYSTEM_ACTOR, actorRole: 'system', initiatedByUid: uid,
        commandId: 'attendance_' + hash(scope + '\n' + uid + '\n' + attendanceDate),
        receiptId: attendanceRef.path, createdAt: timestamp, targetDate: attendanceDate, targetMonth: month,
      };
    });
    // All reads precede the atomic attendance, ledger, and projection writes.
    if (posts.length) {
      writeProjection(transaction, db, account, totals, timestamp, newLedgers);
      newLedgers.forEach((ledger) => transaction.create(db.doc('semester_wis_ledger/' + ledger.ledgerEntryId), ledger));
      transaction.set(db.doc('semester_wis_economies/' + scope), {
        revision: economy.revision + 1, ledgerEntryCount: economy.ledgerEntryCount + posts.length,
        updatedAt: timestamp, updatedBy: SYSTEM_ACTOR,
      }, { merge: true });
    }
    transaction.set(attendanceRef, {
      uid, scope: attendanceScope, year, semester, date: attendanceDate,
      checkedAt: timestamp, rewardProcessed: true,
      rewardLedgerIds: newLedgers.map((ledger) => ledger.ledgerEntryId),
    }, { merge: true });
    const amount = posts.find((post) => post.type === 'attendance')?.amount || 0;
    const monthlyBonusAmount = posts.find((post) => post.type === 'attendance_monthly_bonus')?.amount || 0;
    const milestoneBonusAmount = posts.find((post) => post.type === 'attendance_milestone_bonus')?.amount || 0;
    return {
      ...emptyReward, duplicate: snapshots[11].exists && !posts.length,
      awarded: totalAwarded > 0, amount, totalAwarded, balance: totals.balance,
      bonusAwarded: totalAwarded > amount, bonusAmount: totalAwarded - amount,
      monthlyBonusAwarded: monthlyBonusAmount > 0, monthlyBonusAmount, milestoneBonusAmount,
      claimCount: dates.size,
    };
  });
};

module.exports = { createStudentAttendanceHandler, accountIdFor, ledgerIdFor };
