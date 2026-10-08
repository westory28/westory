const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const enrollment = require("./archiveEnrollment");
const wis = require("./wisEconomy");
const migrationFence = require("./wisMigrationFence");
const COMMAND_TYPE = "approveStudentRegistration";
const QUERY_NAME = "getStudentRegistrationApprovalState";
const APPROVAL_COLLECTION = "student_registration_approvals";
const PAGE_SIZE = 50;
const MAX_CLASSES = 100;
const fail = (reason, message = "등록 승인 정보를 다시 확인해 주세요.", code = "failed-precondition") => {
  throw new HttpsError(code, message, { reason: `REGISTRATION_${reason}` });
};
const id = value => typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\\/\x00-\x1f\x7f]/.test(value) && ![".", ".."].includes(value);
const integer = value => Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
const scopeValid = value => typeof value === "string" && /^\d{4}-[12]$/.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const submittedProfile = data => ({ name: String(data.name || data.displayName || ""), grade: String(data.grade || ""),
  class: String(data.class || ""), number: String(data.number ?? ""), email: String(data.email || "") });
const profileVersion = data => sha(canonical({ submittedProfile: submittedProfile(data), role: data.role || "",
  studentGrade: data.studentGrade ?? null, studentClass: data.studentClass ?? null, studentNumber: data.studentNumber ?? null,
  studentName: data.studentName ?? null, registrationApprovalStatus: data.registrationApprovalStatus ?? null,
  approvedSemesterId: data.approvedSemesterId ?? null, approvedEnrollmentId: data.approvedEnrollmentId ?? null,
  registrationApprovedBy: data.registrationApprovedBy ?? null, customNameConfirmed: data.customNameConfirmed ?? null,
  updatedAt: data.updatedAt ?? null }));
const pathsFor = (semesterId, uid) => {
  if (!scopeValid(semesterId) || !id(uid)) fail("INPUT_INVALID", undefined, "invalid-argument");
  const approvalId = `registration_${sha(`${semesterId}\n${uid}`)}`, accountId = wis.accountIdFor(semesterId, uid);
  return { user: `users/${uid}`, identity: `student_identities/${uid}`, approvalId,
    approval: `${APPROVAL_COLLECTION}/${approvalId}`, slot: `semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`,
    manifest: `semester_manifests/${semesterId}`, pointer: "site_settings/semester_active", readiness: `semester_readiness_reports/${semesterId}`,
    economy: `${wis.WIS_ECONOMY_COLLECTION}/${semesterId}`, accountId, account: `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`,
    balance: `${wis.WIS_BALANCE_COLLECTION}/${accountId}`, ranking: `${wis.WIS_RANKING_COLLECTION}/${accountId}`,
    control: migrationFence.controlPath(semesterId) };
};
const normalizeStudentRegistrationApprovalPayload = (type, payload) => {
  const common = ["semesterId", "expectedSemesterRevision", "studentUid", "expectedProfileVersion", "action"];
  const actionKeys = { APPROVE: ["classId", "expectedClassRevision", "studentNumber", "displayName", "rosterConfirmed"],
    PREPARE_ACCOUNT: ["expectedEnrollmentId", "expectedEconomyRevision"], FINALIZE: ["expectedEnrollmentId", "expectedAccountRevision"] };
  const keys = [...common, ...(actionKeys[payload?.action] || [])];
  if (type !== COMMAND_TYPE || !exact(payload, keys) || !actionKeys[payload.action] || !scopeValid(payload.semesterId) ||
    !id(payload.studentUid) || !integer(payload.expectedSemesterRevision) || !/^[a-f0-9]{64}$/.test(payload.expectedProfileVersion || "")) fail("INPUT_INVALID", undefined, "invalid-argument");
  if (payload.action === "APPROVE") {
    if (!id(payload.classId) || !integer(payload.expectedClassRevision) || payload.rosterConfirmed !== true ||
      typeof payload.studentNumber !== "string" || !/^[1-9]\d{0,5}$/.test(payload.studentNumber) ||
      typeof payload.displayName !== "string" || !payload.displayName.trim() || payload.displayName !== payload.displayName.trim() ||
      payload.displayName.length > 80 || /[\x00-\x1f\x7f]/.test(payload.displayName)) fail("ROSTER_CONFIRMATION_REQUIRED", "명부에서 학급·번호·이름을 확인해 주세요.", "invalid-argument");
  } else if (!id(payload.expectedEnrollmentId) || !integer(payload.action === "FINALIZE" ? payload.expectedAccountRevision : payload.expectedEconomyRevision)) fail("INPUT_INVALID", undefined, "invalid-argument");
  return Object.fromEntries(keys.map(key => [key, payload[key]]));
};
const assertCurrent = (state, semesterId, expectedRevision) => {
  const manifest = state.manifest.data, pointer = state.pointer.data;
  if (!state.manifest.exists || !state.pointer.exists || manifest.semesterId !== semesterId || manifest.status !== "ACTIVE" || manifest.readOnly === true ||
    !integer(manifest.revision) || pointer.semesterId !== semesterId || pointer.revision !== manifest.revision ||
    (expectedRevision !== undefined && expectedRevision !== manifest.revision)) fail("SEMESTER_CHANGED", "현재 학기가 바뀌었습니다. 승인 목록을 새로고침해 주세요.", "aborted");
};
const readNamed = async (transaction, paths, names) => {
  const rows = await transaction.getAll(names.map(name => paths[name]));
  return Object.fromEntries(names.map((name, index) => [name, rows[index]]));
};
const assertPendingBinding = (state, payload, paths) => {
  const profile = state.user.data, approval = state.approval.data, active = state.enrollment?.data, slot = state.slot.data;
  if (profile.registrationApprovalStatus !== "APPROVED_PENDING_ACCOUNT" || profile.approvedSemesterId !== payload.semesterId ||
    profile.approvedEnrollmentId !== payload.expectedEnrollmentId || !state.approval.exists || approval.approvalId !== paths.approvalId ||
    approval.status !== "APPROVED_PENDING_ACCOUNT" || approval.studentUid !== payload.studentUid || approval.semesterId !== payload.semesterId ||
    approval.enrollmentId !== payload.expectedEnrollmentId || !state.enrollment?.exists || active.enrollmentId !== payload.expectedEnrollmentId ||
    active.studentUid !== payload.studentUid || active.semesterId !== payload.semesterId || active.enrollmentStatus !== "ACTIVE" || !integer(active.revision) ||
    active.studentNumber !== active.snapshot?.studentNumber || approval.rosterConfirmed !== true ||
    active.source?.sourceId !== paths.approvalId || active.source?.approvalKind !== "TEACHER_REGISTRATION" ||
    !state.slot.exists || slot.studentUid !== payload.studentUid || slot.semesterId !== payload.semesterId || slot.activeEnrollmentId !== active.enrollmentId || slot.status !== "ACTIVE" || !integer(slot.revision) ||
    !state.identity.exists || state.identity.data.studentUid !== payload.studentUid || state.identity.data.accountStatus !== "ACTIVE" || !integer(state.identity.data.revision) ||
    profile.registrationApprovedBy !== approval.approvedBy || active.createdBy !== approval.approvedBy ||
    canonical(active.snapshot) !== canonical(approval.confirmedSnapshot)) fail("APPROVAL_BINDING_INVALID", "학적 승인 기록이 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.");
  const confirmed = approval.confirmedSnapshot;
  if (profile.name !== confirmed.displayName || String(profile.grade) !== confirmed.grade || String(profile.class) !== confirmed.classNumber ||
    String(profile.number) !== confirmed.studentNumber) fail("PROFILE_CHANGED", "승인 후 학생 정보가 바뀌었습니다. 명부를 다시 확인해 주세요.", "aborted");
};
const assertEmptyAccount = (state, payload, paths) => {
  const account = state.account.data, active = state.enrollment.data;
  for (const name of ["account", "balance", "ranking"]) {
    const row = state[name].data;
    if (!state[name].exists || row.schemaVersion !== wis.WIS_SCHEMA_VERSION || row.policyVersion !== wis.WIS_POLICY_VERSION ||
      row.accountId !== paths.accountId || row.studentUid !== payload.studentUid || row.semesterId !== payload.semesterId ||
      row.enrollmentId !== active.enrollmentId || row.classId !== active.classId || row.displayName !== active.snapshot.displayName || row.balance !== 0 || row.rankEarnedTotal !== 0)
      fail("ACCOUNT_BINDING_INVALID", "승인한 학적의 빈 Wis 계좌를 확인할 수 없습니다.");
  }
  for (const name of ["account", "balance"]) {
    if (["grade", "classNumber", "studentNumber"].some(key => state[name].data[key] !== active.snapshot[key])) fail("ACCOUNT_BINDING_INVALID");
  }
  if (account.status !== "ACTIVE" || account.readOnly === true || account.provenance !== "CURRENT" || account.revision !== 1 ||
    account.initialGrantLedgerEntryId || account.legacyMigrationId || !Array.isArray(account.recentLedgerEntries) || account.recentLedgerEntries.length ||
    ["earnedTotal", "spentTotal", "adjustedTotal"].some(key => account[key] !== 0 || state.balance.data[key] !== 0) ||
    state.balance.data.ledgerRevision !== 1 || state.ranking.data.ledgerRevision !== 1 || state.balance.data.readOnly === true ||
    (payload.expectedAccountRevision !== undefined && account.revision !== payload.expectedAccountRevision)) fail("ACCOUNT_NOT_EMPTY", "초기 지급 없는 빈 Wis 계좌만 등록 승인을 완료할 수 있습니다.");
};
const createStudentRegistrationApprovalAdapter = ({ getAuthUser, wisAdapter = wis.createWisCommandAdapter() } = {}) => {
  if (typeof getAuthUser !== "function") throw new Error("getAuthUser is required");
  return { apply: async context => {
    const { transaction, actor, timestamp, concreteTimestamp, receiptId, commandId } = context;
    const payload = normalizeStudentRegistrationApprovalPayload(context.commandType, context.payload);
    if (!id(actor?.actorUid) || !["teacher", "admin"].includes(actor.actorRole) || actor.actorUid === payload.studentUid) fail("MANAGER_REQUIRED", "교사가 명부를 확인한 뒤 승인할 수 있습니다.", "permission-denied");
    const authUser = await getAuthUser(payload.studentUid);
    if (authUser?.uid !== payload.studentUid || authUser.disabled === true || authUser.emailVerified !== true ||
      !/^[^@\s]+@yongshin-ms\.ms\.kr$/i.test(authUser.email || "")) fail("SCHOOL_ACCOUNT_REQUIRED", "확인된 학교 계정만 승인할 수 있습니다.");
    const paths = pathsFor(payload.semesterId, payload.studentUid);
    const state = await readNamed(transaction, paths, ["user", "identity", "approval", "slot", "manifest", "pointer", "account", "balance", "ranking", "economy", "control", "readiness"]);
    assertCurrent(state, payload.semesterId, payload.expectedSemesterRevision);
    migrationFence.assertControl(state.control.data);
    if (!state.user.exists || state.user.data.role !== "student" || String(state.user.data.email || "").toLowerCase() !== authUser.email.toLowerCase()) fail("STUDENT_PROFILE_INVALID");
    if (profileVersion(state.user.data) !== payload.expectedProfileVersion) fail("PROFILE_CHANGED", "학생 신청 정보가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.", "aborted");
    if (payload.action === "APPROVE") {
      if (state.user.data.registrationApprovalStatus !== "PENDING") fail("NOT_PENDING", "이미 처리된 신청입니다. 승인 목록을 새로고침해 주세요.");
      if (state.approval.exists || state.slot.exists || state.account.exists || state.balance.exists || state.ranking.exists) fail("EXISTING_ENROLLMENT", "기존 학적 또는 계좌가 있어 신규 승인으로 덮어쓸 수 없습니다.");
      const existing = await transaction.query("semester_enrollments", { filters: [{ field: "semesterId", operator: "==", value: payload.semesterId }, { field: "studentUid", operator: "==", value: payload.studentUid }], limit: 1 });
      if (existing.length) fail("EXISTING_ENROLLMENT", "기존 학적은 학생 정보 관리에서 확인해 주세요.");
      const target = await transaction.get(`semester_classes/${payload.classId}`);
      if (!target.exists || target.data.classId !== payload.classId || target.data.semesterId !== payload.semesterId || target.data.status !== "ACTIVE" || target.data.revision !== payload.expectedClassRevision)
        fail("CLASS_CHANGED", "선택한 학급이 바뀌었습니다. 명부를 다시 확인해 주세요.", "aborted");
      if (!String(target.data.grade || "") || !String(target.data.classNumber || "")) fail("CLASS_INVALID");
      const occupied = await transaction.query("semester_enrollments", { filters: [{ field: "semesterId", operator: "==", value: payload.semesterId },
        { field: "classId", operator: "==", value: payload.classId }, { field: "enrollmentStatus", operator: "==", value: "ACTIVE" },
        { field: "studentNumber", operator: "==", value: payload.studentNumber }], limit: 1 });
      if (occupied.length) fail("NUMBER_OCCUPIED", "해당 학급에서 이미 사용하는 번호입니다.", "already-exists");
      if (state.identity.exists && (state.identity.data.studentUid !== payload.studentUid || state.identity.data.accountStatus !== "ACTIVE" || !integer(state.identity.data.revision))) fail("IDENTITY_INVALID");
      const enrollmentId = `enr_registration_${sha(paths.approvalId).slice(0, 40)}`, enrollmentPath = `semester_enrollments/${enrollmentId}`;
      if ((await transaction.get(enrollmentPath)).exists) fail("EXISTING_ENROLLMENT");
      const confirmedSnapshot = { displayName: payload.displayName, grade: String(target.data.grade), classNumber: String(target.data.classNumber),
        classDisplayName: String(target.data.displayName || `${target.data.grade}학년 ${target.data.classNumber}반`), studentNumber: payload.studentNumber };
      const audit = { updatedAt: timestamp, updatedBy: actor.actorUid }, original = submittedProfile(state.user.data);
      transaction.create(enrollmentPath, { enrollmentId, studentUid: payload.studentUid, semesterId: payload.semesterId, classId: payload.classId,
        studentNumber: payload.studentNumber, enrollmentStatus: "ACTIVE", revision: 1, provenance: "CANONICAL", schemaVersion: 1,
        source: { type: "MANUAL_EXCEPTION", sourceId: paths.approvalId, approvalKind: "TEACHER_REGISTRATION", revision: 1 },
        effectiveFrom: concreteTimestamp || timestamp, effectiveTo: null, snapshot: confirmedSnapshot, createdAt: timestamp, createdBy: actor.actorUid, ...audit });
      transaction.create(paths.slot, { semesterId: payload.semesterId, studentUid: payload.studentUid, activeEnrollmentId: enrollmentId, revision: 1, status: "ACTIVE", ...audit });
      if (!state.identity.exists) transaction.create(paths.identity, { studentUid: payload.studentUid, displayName: payload.displayName, accountStatus: "ACTIVE", revision: 1, provenance: "CANONICAL", schemaVersion: 1, createdAt: timestamp, createdBy: actor.actorUid, ...audit });
      // Existing identity stays intact; no old semester record or identity is overwritten.
      transaction.create(paths.approval, { approvalId: paths.approvalId, schemaVersion: 1, status: "APPROVED_PENDING_ACCOUNT", semesterId: payload.semesterId,
        studentUid: payload.studentUid, enrollmentId, submittedProfile: original, submittedProfileVersion: payload.expectedProfileVersion, confirmedSnapshot,
        rosterConfirmed: true, approvedBy: actor.actorUid, approvedAt: timestamp, commandId, receiptId });
      transaction.set(paths.user, { registrationApprovalStatus: "APPROVED_PENDING_ACCOUNT", customNameConfirmed: true, approvedSemesterId: payload.semesterId, approvedEnrollmentId: enrollmentId,
        registrationApprovedBy: actor.actorUid, registrationApprovedAt: timestamp, name: confirmedSnapshot.displayName, grade: confirmedSnapshot.grade,
        class: confirmedSnapshot.classNumber, number: confirmedSnapshot.studentNumber, studentName: confirmedSnapshot.displayName,
        studentGrade: confirmedSnapshot.grade, studentClass: confirmedSnapshot.classNumber, studentNumber: confirmedSnapshot.studentNumber,
        gradeClass: `${confirmedSnapshot.grade}학년 ${confirmedSnapshot.classNumber}반 ${confirmedSnapshot.studentNumber}번`, ...audit }, { merge: true });
      if (state.readiness.exists) transaction.set(paths.readiness, { status: "STALE", stale: true, staleAt: timestamp, staleBy: actor.actorUid, staleReason: "교사 명부 확인 후 신규 학적 승인" }, { merge: true });
      return { target: { kind: "student-registration", id: paths.approvalId, refs: [paths.approval, paths.user, paths.identity, paths.slot, enrollmentPath] },
        sourceHash: payload.expectedProfileVersion, result: { studentUid: payload.studentUid, semesterId: payload.semesterId, enrollmentId,
          status: "APPROVED_PENDING_ACCOUNT", action: payload.action, submittedProfile: original, confirmedSnapshot } };
    }
    state.enrollment = await transaction.get(`semester_enrollments/${payload.expectedEnrollmentId}`);
    assertPendingBinding(state, payload, paths);
    const target = await transaction.get(`semester_classes/${state.enrollment.data.classId}`);
    if (!target.exists || target.data.classId !== state.enrollment.data.classId || target.data.status !== "ACTIVE" || target.data.semesterId !== payload.semesterId ||
      String(target.data.grade) !== state.enrollment.data.snapshot.grade || String(target.data.classNumber) !== state.enrollment.data.snapshot.classNumber) fail("CLASS_CHANGED");
    if (!state.economy.exists || state.economy.data.semesterId !== payload.semesterId || state.economy.data.status !== "ACTIVE_OPEN" || state.economy.data.readOnly === true) fail("ECONOMY_NOT_READY", "현재 학기의 Wis 운영 준비를 먼저 완료해 주세요.");
    const ledgers = await transaction.query(wis.WIS_LEDGER_COLLECTION, { field: "accountId", operator: "==", value: paths.accountId, limit: 1 });
    if (ledgers.length) fail("ACCOUNT_NOT_EMPTY", "등록 준비 계좌에 지급 기록이 있어 확인이 필요합니다.");
    if (payload.action === "PREPARE_ACCOUNT") {
      if (state.economy.data.revision !== payload.expectedEconomyRevision) fail("ECONOMY_CHANGED", "계좌 준비 정보가 바뀌었습니다. 다시 시도해 주세요.", "aborted");
      const exists = [state.account, state.balance, state.ranking].filter(row => row.exists).length;
      if (exists) { assertEmptyAccount(state, payload, paths); return { target: { kind: "student-registration-account", id: paths.accountId, refs: [paths.account] }, sourceHash: payload.expectedProfileVersion,
        result: { studentUid: payload.studentUid, enrollmentId: payload.expectedEnrollmentId, status: "APPROVED_PENDING_ACCOUNT", action: payload.action, accountPrepared: true, replayedAccount: true } }; }
      // Reuse W7's exact zero-account constructor inside THIS transaction. This
      // narrow approval command grants no general Wis-management capability.
      const result = await wisAdapter.apply({ ...context, commandType: wis.WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS,
        payload: wis.normalizeWisPayload(wis.WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS, { semesterId: payload.semesterId,
          expectedSemesterRevision: payload.expectedSemesterRevision, expectedEconomyRevision: payload.expectedEconomyRevision,
          enrollmentIds: [payload.expectedEnrollmentId], reason: "교사 등록 승인에 따른 빈 Wis 계좌 준비" }) });
      return { ...result, sourceHash: payload.expectedProfileVersion, result: { studentUid: payload.studentUid, enrollmentId: payload.expectedEnrollmentId,
        status: "APPROVED_PENDING_ACCOUNT", action: payload.action, accountPrepared: true, createdCount: result.result.createdCount } };
    }
    assertEmptyAccount(state, payload, paths);
    transaction.set(paths.user, { registrationApprovalStatus: "APPROVED", registrationFinalizedAt: timestamp, registrationFinalizedBy: actor.actorUid }, { merge: true });
    transaction.set(paths.approval, { status: "APPROVED", finalizedAt: timestamp, finalizedBy: actor.actorUid, finalizationCommandId: commandId, finalizationReceiptId: receiptId }, { merge: true });
    return { target: { kind: "student-registration-finalize", id: paths.approvalId, refs: [paths.user, paths.approval] }, sourceHash: payload.expectedProfileVersion,
      result: { studentUid: payload.studentUid, enrollmentId: payload.expectedEnrollmentId, status: "APPROVED", action: payload.action, accountId: paths.accountId } };
  } };
};

const createStudentRegistrationApprovalQueryCore = ({ store, assertManager } = {}) => {
  if (!store || typeof assertManager !== "function") throw new Error("store and assertManager are required");
  return { [QUERY_NAME]: async request => {
    await assertManager(request, { recentAuth: false, highRisk: false });
    const data = request.data || {};
    if (!exact(data, ["semesterId", "cursor", "studentUid", "_session"]) || !scopeValid(data.semesterId) ||
      (data.cursor && !id(data.cursor)) || (data.studentUid && !id(data.studentUid))) fail("QUERY_INVALID", undefined, "invalid-argument");
    return store.runTransaction(async transaction => {
      const paths = pathsFor(data.semesterId, data.studentUid || "query");
      const state = await readNamed(transaction, paths, ["manifest", "pointer", "economy"]); assertCurrent(state, data.semesterId);
      const classes = await transaction.query("semester_classes", { filters: [{ field: "semesterId", operator: "==", value: data.semesterId }, { field: "status", operator: "==", value: "ACTIVE" }], limit: MAX_CLASSES + 1 });
      if (classes.length > MAX_CLASSES) fail("CLASS_LIMIT", "학급 목록이 많아 관리자 확인이 필요합니다.");
      const pending = data.studentUid ? [await transaction.get(`users/${data.studentUid}`)].filter(row => row.exists)
        : await transaction.query("users", { filters: [{ field: "registrationApprovalStatus", operator: "in", value: ["PENDING", "APPROVED_PENDING_ACCOUNT"] }], documentIdOrder: "asc", ...(data.cursor ? { startAfterId: data.cursor } : {}), limit: PAGE_SIZE + 1 });
      const visible = pending.slice(0, PAGE_SIZE), students = [];
      for (const row of visible) {
        const profile = row.data, uid = row.path.split("/").pop();
        if (profile.role !== "student" || !["PENDING", "APPROVED_PENDING_ACCOUNT"].includes(profile.registrationApprovalStatus)) continue;
        const p = pathsFor(data.semesterId, uid), item = { studentUid: uid, status: profile.registrationApprovalStatus,
          profileVersion: profileVersion(profile), submittedProfile: submittedProfile(profile), enrollmentId: "", accountState: "NOT_PREPARED", accountRevision: null, blockedReason: "" };
        if (profile.registrationApprovalStatus === "APPROVED_PENDING_ACCOUNT") {
          item.enrollmentId = String(profile.approvedEnrollmentId || "");
          if (profile.approvedSemesterId !== data.semesterId) item.blockedReason = "다른 학기에서 승인 중인 신청입니다.";
          const [approval, account] = await transaction.getAll([p.approval, p.account]);
          if (approval.exists) item.submittedProfile = approval.data.submittedProfile;
          if (account.exists) { item.accountState = "PREPARED"; item.accountRevision = account.data.revision; }
        }
        students.push(item);
      }
      return { semesterId: data.semesterId, manifestRevision: state.manifest.data.revision,
        economyRevision: state.economy.exists ? state.economy.data.revision : null,
        economyReady: state.economy.exists && state.economy.data.status === "ACTIVE_OPEN" && state.economy.data.readOnly !== true,
        students, classes: classes.map(row => ({ classId: row.data.classId, revision: row.data.revision, grade: String(row.data.grade), classNumber: String(row.data.classNumber), displayName: row.data.displayName || `${row.data.grade}학년 ${row.data.classNumber}반` })),
        nextCursor: !data.studentUid && pending.length > PAGE_SIZE ? visible[visible.length - 1].path.split("/").pop() : null };
    });
  } };
};
module.exports = { COMMAND_TYPE, QUERY_NAME, APPROVAL_COLLECTION, profileVersion, pathsFor,
  normalizeStudentRegistrationApprovalPayload, createStudentRegistrationApprovalAdapter, createStudentRegistrationApprovalQueryCore };
