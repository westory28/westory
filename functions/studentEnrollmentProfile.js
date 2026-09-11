const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const enrollment = require("./archiveEnrollment");
const wis = require("./wisEconomy");

const COMMAND_TYPE = "updateStudentEnrollmentProfile";
const QUERY_NAME = "getStudentEnrollmentProfileState";
const MAX_STUDENTS = 100;
const MAX_CLASSES = 300;
const fail = (reason, message, code = "failed-precondition") => {
  throw new HttpsError(code, message, { reason });
};
const text = (value, max = 128) => typeof value === "string" && value === value.trim() &&
  value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const uidValid = (value) => text(value) && value.length > 0 && !value.includes("/") && ![".", ".."].includes(value);
const revisionValid = (value) => Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const canonical = (value) => JSON.stringify(value, (_, entry) => {
  if (entry && typeof entry === "object" && !Array.isArray(entry))
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
  return entry;
});
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const scopeValid = (value) => /^\d{4}-[12]$/.test(value || "");
const approvalPending = (data) => Object.hasOwn(data || {}, "registrationApprovalStatus") && data.registrationApprovalStatus !== "APPROVED";
const classLabelsValid = (data) => text(data?.grade, 40) && data.grade.length > 0 && text(data?.classNumber, 40) && data.classNumber.length > 0;
const pathsFor = (semesterId, studentUid) => {
  if (!scopeValid(semesterId) || !uidValid(studentUid)) fail("STUDENT_PROFILE_INPUT_INVALID", "학생과 학기를 확인해 주세요.", "invalid-argument");
  const accountId = wis.accountIdFor(semesterId, studentUid);
  return { user: `users/${studentUid}`, identity: `student_identities/${studentUid}`,
    slot: `semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, studentUid)}`,
    manifest: `semester_manifests/${semesterId}`, pointer: "site_settings/semester_active",
    readiness: `semester_readiness_reports/${semesterId}`,
    account: `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`, balance: `${wis.WIS_BALANCE_COLLECTION}/${accountId}`,
    ranking: `${wis.WIS_RANKING_COLLECTION}/${accountId}`, accountId,
    migrationFence: `wis_legacy_migration_controls/${semesterId}` };
};
const assertActor = (actor) => {
  if (!uidValid(actor?.actorUid) || !["teacher", "admin"].includes(actor?.actorRole))
    fail("STUDENT_PROFILE_MANAGER_REQUIRED", "학생 정보를 수정할 교사 권한이 필요합니다.", "permission-denied");
};
const normalizeStudentProfilePayload = (commandType, payload) => {
  const keys = ["semesterId", "studentUid", "expectedVersion", "operation", "targetClassId",
    "expectedTargetClassRevision", "studentNumber", "displayName", "email", "reason"];
  if (commandType !== COMMAND_TYPE || !exact(payload, keys) || !scopeValid(payload.semesterId) ||
      !uidValid(payload.studentUid) || !/^[a-f0-9]{64}$/.test(payload.expectedVersion || "") ||
      !["EDIT_PROFILE", "MOVE_CLASS", "PROMOTE_GRADE"].includes(payload.operation) || !uidValid(payload.targetClassId) ||
      !revisionValid(payload.expectedTargetClassRevision) || !text(payload.studentNumber, 12) || !/^[\p{L}\p{N}-]+$/u.test(payload.studentNumber) ||
      !text(payload.displayName, 80) || !payload.displayName || !text(payload.email, 160) ||
      !text(payload.reason, 500) || !payload.reason)
    fail("STUDENT_PROFILE_INPUT_INVALID", "학생 정보와 변경 사유를 확인해 주세요.", "invalid-argument");
  return Object.fromEntries(keys.map((key) => [key, payload[key]]));
};
const normalizeStudentProfileQuery = (data) => {
  if (!exact(data, ["semesterId", "studentUids", "_session"]) || !scopeValid(data.semesterId) ||
      !Array.isArray(data.studentUids) || !data.studentUids.length || data.studentUids.length > MAX_STUDENTS ||
      data.studentUids.some((uid) => !uidValid(uid)) || new Set(data.studentUids).size !== data.studentUids.length)
    fail("STUDENT_PROFILE_QUERY_INVALID", "조회할 학생과 현재 학기를 확인해 주세요.", "invalid-argument");
  return { semesterId: data.semesterId, studentUids: [...data.studentUids] };
};
const profileFields = (data) => ({ grade: String(data.studentGrade ?? data.grade ?? ""),
  class: String(data.studentClass ?? data.class ?? ""), number: String(data.studentNumber ?? data.number ?? ""),
  name: String(data.studentName || data.name || data.displayName || ""), email: String(data.email || "") });
const readState = async ({ transaction, semesterId, studentUid }) => {
  const paths = pathsFor(semesterId, studentUid), names = ["user", "identity", "slot", "manifest", "pointer", "migrationFence"];
  const rows = await transaction.getAll(names.map((name) => paths[name]));
  const state = Object.fromEntries(names.map((name, i) => [name, rows[i]]));
  if (!state.user.exists) fail("STUDENT_PROFILE_NOT_FOUND", "학생 계정을 찾을 수 없습니다.", "not-found");
  if (approvalPending(state.user.data)) fail("STUDENT_PROFILE_APPROVAL_INCOMPLETE", "학생 등록 승인을 먼저 완료해 주세요.");
  const activeId = state.slot.data?.activeEnrollmentId;
  const active = uidValid(activeId) ? await transaction.get(`semester_enrollments/${activeId}`) : null;
  const existing = state.slot.exists ? [] : await transaction.query("semester_enrollments", { filters: [
    { field: "semesterId", operator: "==", value: semesterId }, { field: "studentUid", operator: "==", value: studentUid }], limit: 1 });
  if (!state.slot.exists && !existing.length) return { source: "LEGACY", paths, state, studentUid, profile: profileFields(state.user.data) };
  if (!active?.exists || active.data.studentUid !== studentUid || active.data.semesterId !== semesterId ||
      active.data.enrollmentStatus !== "ACTIVE" || active.data.readOnly === true ||
      state.slot.data?.status !== "ACTIVE" || state.slot.data?.studentUid !== studentUid || state.slot.data?.semesterId !== semesterId ||
      active.data.enrollmentId !== activeId || !revisionValid(active.data.revision) || !revisionValid(state.slot.data.revision) ||
      !state.identity.exists || state.identity.data.studentUid !== studentUid || state.identity.data.accountStatus !== "ACTIVE" || !revisionValid(state.identity.data.revision))
    fail("STUDENT_PROFILE_ENROLLMENT_INVALID", "현재 학적 정보를 확인할 수 없습니다. 명단을 새로고침해 주세요.");
  const currentClass = uidValid(active.data.classId) ? await transaction.get(`semester_classes/${active.data.classId}`) : null;
  if (!currentClass?.exists || currentClass.data.semesterId !== semesterId || currentClass.data.status !== "ACTIVE" || !revisionValid(currentClass.data.revision) || !classLabelsValid(currentClass.data))
    fail("STUDENT_PROFILE_CLASS_INVALID", "현재 학급 정보를 확인해 주세요.");
  if (state.manifest.data?.status !== "ACTIVE" || state.manifest.data?.readOnly === true || state.manifest.data?.semesterId !== semesterId ||
      !revisionValid(state.manifest.data.revision) || state.pointer.data?.semesterId !== semesterId || state.pointer.data?.revision !== state.manifest.data.revision)
    fail("STUDENT_PROFILE_SCOPE_CHANGED", "현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.");
  const baseProfile = profileFields(state.user.data);
  const profile = { ...baseProfile, grade: String(currentClass.data.grade), class: String(currentClass.data.classNumber),
    number: String(active.data.studentNumber ?? active.data.snapshot?.studentNumber ?? ""),
    name: baseProfile.name || String(state.identity.data.displayName || active.data.snapshot?.displayName || "") };
  const expectedVersion = hash({ semesterId, studentUid, profile: baseProfile, profileUpdatedAt: state.user.data.updatedAt || null,
    identity: { displayName: state.identity.data.displayName || null, revision: state.identity.data.revision || null },
    slot: { activeEnrollmentId: activeId, revision: state.slot.data.revision },
    active: { revision: active.data.revision, classId: active.data.classId, studentNumber: active.data.studentNumber,
      snapshot: active.data.snapshot || null },
    currentClass: { revision: currentClass.data.revision, grade: currentClass.data.grade, classNumber: currentClass.data.classNumber },
    manifestRevision: state.manifest.data.revision });
  return { source: "CANONICAL", paths, state, studentUid, active, currentClass, profile, expectedVersion };
};
const queryStudentProfiles = async ({ transaction, data, actor }) => {
  assertActor(actor);
  const query = normalizeStudentProfileQuery(data), students = [];
  const firstPaths = [...new Set(query.studentUids.flatMap((uid) => {
    const paths = pathsFor(query.semesterId, uid);
    return [paths.user, paths.identity, paths.slot, paths.manifest, paths.pointer, paths.migrationFence];
  }))];
  const [classes, initial] = await Promise.all([
    transaction.query("semester_classes", { filters: [
      { field: "semesterId", operator: "==", value: query.semesterId }, { field: "status", operator: "==", value: "ACTIVE" }], limit: MAX_CLASSES + 1 }),
    transaction.getAll(firstPaths),
  ]);
  if (classes.length > MAX_CLASSES) fail("STUDENT_PROFILE_CLASS_LIMIT", "학급 조회 범위를 확인해 주세요.");
  const snapshots = new Map(initial.map((row) => [row.path, row]));
  for (const row of classes) snapshots.set(row.path, row);
  const activePaths = [...new Set(query.studentUids.map((uid) => snapshots.get(pathsFor(query.semesterId, uid).slot)?.data?.activeEnrollmentId)
    .filter(uidValid).map((id) => `semester_enrollments/${id}`))];
  if (activePaths.length) for (const row of await transaction.getAll(activePaths)) snapshots.set(row.path, row);
  // Canonical rows reuse the same transaction's two batched reads and class
  // query. Only genuinely missing slots need the bounded legacy/orphan query.
  const cached = {
    get: async (path) => {
      if (snapshots.has(path)) return snapshots.get(path);
      if (path.startsWith("semester_classes/")) return { path, exists: false, data: null };
      return transaction.get(path);
    },
    getAll: async (paths) => Promise.all(paths.map((path) => cached.get(path))),
    query: (...args) => transaction.query(...args),
  };
  for (const studentUid of query.studentUids) {
    try {
      const value = await readState({ transaction: cached, semesterId: query.semesterId, studentUid });
      students.push({ studentUid, source: value.source, expectedVersion: value.expectedVersion || null, profile: value.profile,
        enrollmentId: value.active?.data.enrollmentId || null, enrollmentRevision: value.active?.data.revision || null });
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      students.push({ studentUid, source: "BLOCKED", expectedVersion: null, profile: null,
        enrollmentId: null, enrollmentRevision: null, error: error.message });
    }
  }
  return { semesterId: query.semesterId, students,
    classes: classes.map((row) => ({ classId: row.data.classId, grade: String(row.data.grade),
      classNumber: String(row.data.classNumber), revision: row.data.revision })) };
};

// Must be called inside the SAME Firestore transaction that writes legacy
// profiles/rosters. Reading both slot and matching records prevents a concurrent
// enrollment creation from turning an old callable into a canonical bypass.
const assertLegacyProfileWritable = async ({ transaction, semesterId, studentUid }) => {
  const paths = pathsFor(semesterId, studentUid);
  const user = await transaction.get(paths.user);
  if (approvalPending(user.data)) fail("STUDENT_PROFILE_APPROVAL_INCOMPLETE", "학생 등록 승인을 먼저 완료해 주세요.");
  const pointer = await transaction.get(paths.pointer);
  if (pointer.exists && pointer.data?.semesterId !== semesterId)
    fail("STUDENT_PROFILE_SCOPE_CHANGED", "현재 학기가 바뀌었습니다. 명단을 새로고침해 주세요.");
  const slot = await transaction.get(paths.slot);
  const records = await transaction.query("semester_enrollments", { filters: [
    { field: "semesterId", operator: "==", value: semesterId }, { field: "studentUid", operator: "==", value: studentUid }], limit: 1 });
  if (slot.exists || records.length) fail("STUDENT_PROFILE_CANONICAL_COMMAND_REQUIRED", "현재 학적이 있는 학생입니다. 명단을 새로고침한 뒤 다시 저장해 주세요.");
  // Even a missing/broken active pointer must not allow a caller to name an
  // unrelated semester and overwrite the shared profile of an ACTIVE student.
  const activeAnywhere = await transaction.query("semester_enrollments", { filters: [
    { field: "studentUid", operator: "==", value: studentUid }, { field: "enrollmentStatus", operator: "==", value: "ACTIVE" }], limit: 1 });
  if (activeAnywhere.length) fail("STUDENT_PROFILE_CANONICAL_COMMAND_REQUIRED", "현재 학적이 있는 학생입니다. 명단을 새로고침한 뒤 다시 저장해 주세요.");
};
const createStudentProfileAdapter = () => ({ apply: async ({ transaction, commandType, payload, actor, commandId, receiptId, timestamp, concreteTimestamp }) => {
  assertActor(actor); payload = normalizeStudentProfilePayload(commandType, payload);
  const value = await readState({ transaction, semesterId: payload.semesterId, studentUid: payload.studentUid });
  if (value.source !== "CANONICAL") fail("STUDENT_PROFILE_CANONICAL_REQUIRED", "현재 학적이 없는 학생입니다. 명단을 새로고침해 주세요.");
  if (value.expectedVersion !== payload.expectedVersion) fail("STUDENT_PROFILE_VERSION_CONFLICT", "학생 정보가 변경되었습니다. 입력을 보관한 뒤 명단을 새로고침해 주세요.", "aborted");
  if (value.state.migrationFence.data?.enabled === true || value.state.migrationFence.data?.writesBlocked === true)
    fail("STUDENT_PROFILE_MIGRATION_FENCED", "자료 이전 중입니다. 잠시 뒤 다시 저장해 주세요.");
  const { paths, active, profile } = value;
  const targetPath = `semester_classes/${payload.targetClassId}`;
  const names = ["account", "balance", "ranking", "readiness"], rows = await transaction.getAll(names.map((name) => paths[name]));
  const related = Object.fromEntries(names.map((name, i) => [name, rows[i]]));
  const target = await transaction.get(targetPath);
  if (!target.exists || target.data.classId !== payload.targetClassId || target.data.semesterId !== payload.semesterId ||
      target.data.status !== "ACTIVE" || target.data.revision !== payload.expectedTargetClassRevision || !classLabelsValid(target.data))
    fail("STUDENT_PROFILE_TARGET_CLASS_CHANGED", "대상 학급이 변경되었습니다. 명단을 새로고침해 주세요.", "aborted");
  if (payload.operation === "MOVE_CLASS" && String(target.data.grade) !== profile.grade)
    fail("STUDENT_PROFILE_MOVE_GRADE_CHANGED", "반 이동에서는 같은 학년의 학급을 선택해 주세요.");
  if (payload.email !== profile.email)
    fail("STUDENT_PROFILE_ACCOUNT_EMAIL_READ_ONLY", "로그인 이메일은 학생 정보에서 변경할 수 없습니다.", "invalid-argument");
  const nextProfile = { grade: String(target.data.grade), class: String(target.data.classNumber),
    number: payload.operation === "EDIT_PROFILE" ? payload.studentNumber : profile.number,
    name: payload.operation === "EDIT_PROFILE" ? payload.displayName : profile.name,
    email: profile.email };
  const moved = payload.targetClassId !== active.data.classId;
  const numberChanged = nextProfile.number !== profile.number;
  if (moved || numberChanged) {
    const occupied = await transaction.query("semester_enrollments", { filters: [
      { field: "semesterId", operator: "==", value: payload.semesterId }, { field: "classId", operator: "==", value: payload.targetClassId },
      { field: "enrollmentStatus", operator: "==", value: "ACTIVE" }, { field: "studentNumber", operator: "==", value: nextProfile.number }], limit: 2 });
    if (occupied.some((row) => row.data.studentUid !== payload.studentUid))
      fail("STUDENT_PROFILE_NUMBER_OCCUPIED", "선택한 학급에서 이미 사용 중인 번호입니다.", "already-exists");
  }
  const at = concreteTimestamp || timestamp;
  const nextId = moved ? `enr_profile_${hash({ receiptId, studentUid: payload.studentUid, semesterId: payload.semesterId })}` : active.data.enrollmentId;
  const nextPath = `semester_enrollments/${nextId}`;
  if (moved && (await transaction.get(nextPath)).exists) fail("STUDENT_PROFILE_ENROLLMENT_ID_CONFLICT", "이동 요청 결과를 먼저 확인해 주세요.");
  const projections = ["account", "balance", "ranking"].filter((name) => related[name].exists);
  if (projections.length !== 0 && projections.length !== 3) fail("STUDENT_PROFILE_WIS_PROJECTION_INCOMPLETE", "학생 위스 계정 표시 정보가 일부 누락되었습니다.");
  for (const name of projections) {
    const row = related[name].data;
    if (row.accountId !== paths.accountId || row.studentUid !== payload.studentUid || row.semesterId !== payload.semesterId)
      fail("STUDENT_PROFILE_WIS_SCOPE_INVALID", "학생 위스 계정 범위를 확인해 주세요.");
  }
  const snapshot = { ...(active.data.snapshot || {}), displayName: nextProfile.name, grade: nextProfile.grade,
    classNumber: nextProfile.class, classDisplayName: String(target.data.displayName || `${nextProfile.grade}학년 ${nextProfile.class}반`), studentNumber: nextProfile.number };
  const audit = { updatedAt: timestamp, updatedBy: actor.actorUid };
  // All reads above; immutable attempts, grades, ledgers and orders are never targets.
  if (moved) {
    transaction.set(active.path, { enrollmentStatus: "TRANSFERRED", effectiveTo: at,
      transitionReason: payload.reason, revision: active.data.revision + 1, ...audit }, { merge: true });
    transaction.create(nextPath, { enrollmentId: nextId, studentUid: payload.studentUid, semesterId: payload.semesterId,
      classId: payload.targetClassId, studentNumber: nextProfile.number, enrollmentStatus: "ACTIVE", revision: 1,
      schemaVersion: active.data.schemaVersion || 1, provenance: "CANONICAL", source: { type: "MANUAL_EXCEPTION", sourceId: receiptId, revision: 1 },
      effectiveFrom: at, effectiveTo: null, previousEnrollmentId: active.data.enrollmentId, snapshot, createdAt: timestamp, createdBy: actor.actorUid, ...audit });
    transaction.set(paths.slot, { activeEnrollmentId: nextId, revision: value.state.slot.data.revision + 1, ...audit }, { merge: true });
  } else transaction.set(active.path, { studentNumber: nextProfile.number, snapshot, revision: active.data.revision + 1, ...audit }, { merge: true });
  transaction.set(paths.identity, { displayName: nextProfile.name,
    revision: Number(value.state.identity.data.revision || 0) + 1, ...audit }, { merge: true });
  transaction.set(paths.user, { grade: nextProfile.grade, class: nextProfile.class, number: nextProfile.number, name: nextProfile.name,
    studentGrade: nextProfile.grade, studentClass: nextProfile.class, studentNumber: nextProfile.number, studentName: nextProfile.name,
    email: nextProfile.email, gradeClass: `${nextProfile.grade}학년 ${nextProfile.class}반 ${nextProfile.number}번`, ...audit }, { merge: true });
  const metadata = { enrollmentId: nextId, classId: payload.targetClassId, grade: nextProfile.grade,
    classNumber: nextProfile.class, studentNumber: nextProfile.number, displayName: nextProfile.name, ...audit };
  for (const name of projections) transaction.set(paths[name], metadata, { merge: true });
  if (related.readiness.exists) transaction.set(paths.readiness, { status: "STALE", stale: true, staleAt: timestamp,
    staleBy: actor.actorUid, staleReason: payload.reason }, { merge: true });
  return { target: { kind: "student-enrollment-profile", id: payload.studentUid,
    refs: [paths.user, paths.identity, active.path, nextPath, paths.slot, ...projections.map((name) => paths[name])] },
    sourceHash: payload.expectedVersion, result: { studentUid: payload.studentUid, semesterId: payload.semesterId,
      enrollmentId: nextId, moved, profile: nextProfile, commandId, receiptId } };
} });

module.exports = { COMMAND_TYPE, QUERY_NAME, MAX_STUDENTS, pathsFor, normalizeStudentProfilePayload,
  normalizeStudentProfileQuery, queryStudentProfiles, assertLegacyProfileWritable, createStudentProfileAdapter };
