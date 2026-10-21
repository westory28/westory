const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

// These commands preserve the reusable History Classroom ticket workflow. W8
// learning exemptions are tied to a learning-content record and cannot replace it.
const COMMAND_TYPES = Object.freeze({
  GRANT_HISTORY_CLASSROOM_EXEMPTIONS: "grantHistoryClassroomExemptions",
  REVOKE_HISTORY_CLASSROOM_EXEMPTIONS: "revokeHistoryClassroomExemptions",
  CREATE_HISTORY_CLASSROOM_EXEMPTION_REQUEST: "createHistoryClassroomExemptionRequest",
  REVIEW_HISTORY_CLASSROOM_EXEMPTION_REQUEST: "reviewHistoryClassroomExemptionRequest",
  APPLY_HISTORY_CLASSROOM_EXEMPTION: "applyHistoryClassroomExemption",
});
const fail = (code, message, reason = "HISTORY_EXEMPTION_INVALID") => {
  throw new HttpsError(code, message, { reason });
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value, label, max = 180, optional = false) => {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max)
    fail("invalid-argument", `${label} is invalid.`);
  return value;
};
const id = (value, label) => {
  const result = text(value, label);
  if (/[\/\\\u0000-\u001f]/u.test(result)) fail("invalid-argument", `${label} is invalid.`);
  return result;
};
const ids = (value, label, optional = false) => {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || (!optional && !value.length))
    fail("invalid-argument", `${label} is invalid.`);
  return [...new Set(value.map((item) => id(item, label)))].sort();
};
const normalizePayload = (type, payload) => {
  const fields = {
    [COMMAND_TYPES.GRANT_HISTORY_CLASSROOM_EXEMPTIONS]: ["recipientUids", "classId", "targetGrade", "targetClass", "reason"],
    [COMMAND_TYPES.REVOKE_HISTORY_CLASSROOM_EXEMPTIONS]: ["exemptionIds"],
    [COMMAND_TYPES.CREATE_HISTORY_CLASSROOM_EXEMPTION_REQUEST]: ["assignmentId", "exemptionId", "memo"],
    [COMMAND_TYPES.REVIEW_HISTORY_CLASSROOM_EXEMPTION_REQUEST]: ["requestId", "approved", "reviewReason"],
    [COMMAND_TYPES.APPLY_HISTORY_CLASSROOM_EXEMPTION]: ["assignmentId", "studentUid", "exemptionId"],
  }[type];
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).some((key) => !["semesterId", ...fields].includes(key)))
    fail("invalid-argument", "History Classroom exemption payload is invalid.");
  const semesterId = text(payload.semesterId, "semesterId", 6);
  if (!/^\d{4}-[12]$/.test(semesterId)) fail("invalid-argument", "semesterId is invalid.");
  if (type === COMMAND_TYPES.GRANT_HISTORY_CLASSROOM_EXEMPTIONS) {
    const result = { semesterId, recipientUids: ids(payload.recipientUids, "recipientUids", true),
      classId: text(payload.classId, "classId", 180, true), targetGrade: text(payload.targetGrade, "targetGrade", 8, true),
      targetClass: text(payload.targetClass, "targetClass", 8, true), reason: text(payload.reason, "reason", 240) };
    if (!result.recipientUids.length && !result.classId && !(result.targetGrade && result.targetClass))
      fail("invalid-argument", "면제권을 부여할 학생 또는 학급을 선택해 주세요.");
    return result;
  }
  if (type === COMMAND_TYPES.REVOKE_HISTORY_CLASSROOM_EXEMPTIONS)
    return { semesterId, exemptionIds: ids(payload.exemptionIds, "exemptionIds") };
  if (type === COMMAND_TYPES.CREATE_HISTORY_CLASSROOM_EXEMPTION_REQUEST)
    return { semesterId, assignmentId: id(payload.assignmentId, "assignmentId"), exemptionId: id(payload.exemptionId, "exemptionId"), memo: text(payload.memo, "memo", 240, true) };
  if (type === COMMAND_TYPES.APPLY_HISTORY_CLASSROOM_EXEMPTION)
    return { semesterId, assignmentId: id(payload.assignmentId, "assignmentId"), studentUid: id(payload.studentUid, "studentUid"), exemptionId: id(payload.exemptionId, "exemptionId") };
  if (typeof payload.approved !== "boolean") fail("invalid-argument", "approved is invalid.");
  return { semesterId, requestId: id(payload.requestId, "requestId"), approved: payload.approved, reviewReason: text(payload.reviewReason, "reviewReason", 240, true) };
};
const root = (semesterId) => {
  const [year, semester] = semesterId.split("-");
  return `years/${year}/semesters/${semester}`;
};
const ticketPath = (semesterId, ticketId) => `${root(semesterId)}/history_classroom_exemptions/${ticketId}`;
const requestPath = (semesterId, requestId) => `${root(semesterId)}/history_classroom_exemption_requests/${requestId}`;
const definitionIdFor = (semesterId, assignmentId) => `history_classroom:${semesterId}:${assignmentId}`;
const resultIdFor = (semesterId, assignmentId, uid) => `exemption_${hash(`${semesterId}\n${assignmentId}\n${uid}`)}`;
const ticketOwner = (ticket) => ticket.uid || ticket.studentUid || ticket.ownerUid || ticket.recipientUid || "";
const ticketStatus = (ticket) => {
  if (ticket.usedAt || ticket.usedAssignmentId || ticket.usedByUid) return "used";
  if (ticket.revokedAt) return "revoked";
  const statuses = [ticket.status, ticket.state].filter(Boolean);
  if (statuses.some((value) => ["used", "consumed"].includes(value))) return "used";
  if (statuses.some((value) => ["requested", "pending"].includes(value))) return "requested";
  if (statuses.includes("revoked")) return "revoked";
  return statuses.every((value) => ["available", "active"].includes(value)) ? "available" : "invalid";
};
const profileSnapshot = (uid, profile, enrollment, semesterClass) => ({
  uid, studentName: String(enrollment.snapshot?.displayName || enrollment.studentName || profile.name || "학생"),
  studentGrade: String(semesterClass.grade || profile.studentGrade || profile.grade || ""),
  studentClass: String(semesterClass.classNumber || profile.studentClass || profile.class || ""),
  studentNumber: String(enrollment.studentNumber || profile.studentNumber || profile.number || ""),
});
// A reader lives for one transaction attempt only. Reuse its query snapshots and
// batch concurrent validation reads without changing the enrollment authority.
// All recipient validation completes before this command stages any writes.
const createGrantReader = (transaction) => {
  const documents = new Map();
  let pending = [];
  const read = (path) => {
    if (documents.has(path)) return documents.get(path);
    const promise = new Promise((resolve, reject) => {
      pending.push({ path, resolve, reject });
      if (pending.length !== 1) return;
      Promise.resolve().then(async () => {
        const batch = pending;
        pending = [];
        try {
          const snapshots = await transaction.getAll(batch.map((entry) => entry.path));
          batch.forEach((entry, index) => entry.resolve(snapshots[index]));
        } catch (error) {
          batch.forEach((entry) => entry.reject(error));
        }
      });
    });
    documents.set(path, promise);
    return promise;
  };
  return {
    get: read,
    getAll: (paths) => Promise.all(paths.map(read)),
    query: async (...args) => {
      const snapshots = await transaction.query(...args);
      snapshots.forEach((snapshot) => documents.set(snapshot.path, Promise.resolve(snapshot)));
      return snapshots;
    },
  };
};
const thresholdFor = (source) => {
  const value = source.passThresholdPercent == null || source.passThresholdPercent === "" ? Number.NaN : Number(source.passThresholdPercent);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 80;
};
const assertTicketAssignment = (ticket, assignmentId, now) => {
  if (ticket.assignmentId && ticket.assignmentId !== assignmentId)
    fail("permission-denied", "이 면제권은 다른 역사교실에 지정되어 있습니다.");
  const expires = ticket.expiresAt?.toMillis?.() || (typeof ticket.expiresAt === "string" ? Date.parse(ticket.expiresAt) : 0);
  if (expires && expires <= now().getTime()) fail("failed-precondition", "사용 기간이 지난 면제권입니다.");
};
const assertNotPassed = async (transaction, semesterId, assignmentId, uid, assignment) => {
  const [canonical, legacy] = await Promise.all([
    transaction.query("semester_assessment_results", { field: "definitionId", operator: "==", value: assignment.definitionId }),
    transaction.query(`${root(semesterId)}/history_classroom_results`, { field: "uid", operator: "==", value: uid }),
  ]);
  const passed = [...canonical.filter((row) => row.data?.studentUid === uid), ...legacy.filter((row) => row.data?.assignmentId === assignmentId)]
    .some(({ data }) => data.completionSource === "exemption" || data.passed === true || data.status === "passed" ||
      (data.passed == null && data.status !== "cancelled" && Number(data.percent) >= thresholdFor(assignment.source)));
  if (passed) fail("failed-precondition", "이미 통과한 역사교실에는 면제권을 사용할 수 없습니다.", "HISTORY_EXEMPTION_ALREADY_PASSED");
};
const assertAssignment = async (transaction, semesterId, assignmentId, uid, helpers) => {
  const definitionId = definitionIdFor(semesterId, assignmentId);
  const [source, definition] = await transaction.getAll([
    `${root(semesterId)}/history_classrooms/${assignmentId}`, `semester_assessment_definitions/${definitionId}`,
  ]);
  if (!source.exists || source.data?.deletedAt || source.data?.isPublished !== true || !definition.exists ||
      definition.data?.semesterId !== semesterId || definition.data?.assessmentKind !== "HISTORY_CLASSROOM" ||
      definition.data?.status !== "PUBLISHED")
    fail("failed-precondition", "현재 공개된 역사교실에서만 면제권을 사용할 수 있습니다.", "HISTORY_EXEMPTION_ASSIGNMENT_UNAVAILABLE");
  const assigned = [...(source.data.targetStudentUids || []), source.data.targetStudentUid,
    ...Object.entries(source.data.targetStudentAccessMap || {}).filter(([, allowed]) => allowed === true).map(([studentUid]) => studentUid)].filter(Boolean);
  if (!assigned.includes(uid) || (definition.data.assignedStudentUids?.length && !definition.data.assignedStudentUids.includes(uid)))
    fail("permission-denied", "이 학생에게 배정된 역사교실이 아닙니다.");
  const enrollment = await helpers.assertActiveEnrollment(transaction, semesterId, uid, definition.data.assignedClassIds || []);
  const semesterClass = await transaction.get(`semester_classes/${enrollment.classId}`);
  if (!semesterClass.exists || semesterClass.data?.semesterId !== semesterId || semesterClass.data?.status !== "ACTIVE")
    fail("failed-precondition", "학생의 현재 학급 정보를 확인해 주세요.", "HISTORY_EXEMPTION_ENROLLMENT_INVALID");
  return { source: source.data, definition: definition.data, definitionId, enrollment, semesterClass: semesterClass.data };
};

const prepareCompletion = async (transaction, semesterId, assignmentId, uid, assignment) => {
  await assertNotPassed(transaction, semesterId, assignmentId, uid, assignment);
  const resultId = resultIdFor(semesterId, assignmentId, uid);
  const canonicalRef = `semester_assessment_results/${resultId}`;
  const legacyRef = `${root(semesterId)}/history_classroom_results/${resultId}`;
  const [canonical, legacy, attempts] = await Promise.all([transaction.get(canonicalRef), transaction.get(legacyRef),
    transaction.query("semester_assessment_attempts", { field: "definitionId", operator: "==", value: assignment.definitionId })]);
  if (canonical.exists || legacy.exists) fail("already-exists", "이미 면제 처리된 역사교실입니다.");
  return { assignment, resultId, canonicalRef, legacyRef,
    attempts: attempts.filter((row) => row.data?.studentUid === uid && row.data?.resetAt == null && ["STARTED", "IN_PROGRESS", "RECOVERABLE"].includes(row.data.status)) };
};
const writeCompletion = (transaction, approval, current, requestId, actor, timestamp, now, audit = {}) => {
  const { assignment, resultId, canonicalRef, legacyRef, attempts } = approval;
  const total = Array.isArray(assignment.source.blanks) ? assignment.source.blanks.length : 0;
  const result = { resultId, semesterId: current.semesterId, definitionId: assignment.definitionId, assessmentKind: "HISTORY_CLASSROOM",
    studentUid: current.uid, uid: current.uid, enrollmentId: assignment.enrollment.enrollmentId, classId: assignment.enrollment.classId,
    assignmentId: current.assignmentId, assignmentTitle: assignment.source.title || current.assignmentTitle || "역사교실",
    studentName: current.studentName || "학생", studentGrade: current.studentGrade || "", studentClass: current.studentClass || "", studentNumber: current.studentNumber || "",
    completionSource: "exemption", exemptionId: current.exemptionId, exemptionRequestId: requestId, ...audit,
    status: "passed", passed: true, score: total, total, percent: 100, passThresholdPercent: thresholdFor(assignment.source),
    answers: {}, answerChecks: [], approvedByUid: actor.actorUid, approvedAt: timestamp, submittedAt: timestamp,
    submittedAtIso: now().toISOString(), createdAt: timestamp, updatedAt: timestamp,
    reward: { status: "NOT_ELIGIBLE", awarded: false, duplicate: false, amount: 0, bonusAwarded: false, bonusAmount: 0, totalAwarded: 0,
      blockedReason: "exemption", blockedMessage: "면제권 사용에는 보상이 지급되지 않습니다.", ledgerEntryIds: [] } };
  transaction.create(canonicalRef, result);
  transaction.create(legacyRef, result);
  for (const attempt of attempts) transaction.set(attempt.path, { status: "LOCKED", lockReason: "EXEMPTION", revision: Number(attempt.data.revision || 0) + 1, updatedAt: timestamp }, { merge: true });
};

const apply = async ({ transaction, commandId, commandType, payload, actor, timestamp, helpers }) => {
  const { semesterId } = payload;
  const studentCommand = commandType === COMMAND_TYPES.CREATE_HISTORY_CLASSROOM_EXEMPTION_REQUEST;
  if (studentCommand) helpers.assertStudentActor(actor); else helpers.assertTeacherActor(actor);
  const reader = commandType === COMMAND_TYPES.GRANT_HISTORY_CLASSROOM_EXEMPTIONS ? createGrantReader(transaction) : transaction;
  await helpers.assertAssessmentSemesterWritable(reader, semesterId);
  const response = (kind, key, refs, result) => ({ target: { kind, id: key, refs }, sourceHash: hash(JSON.stringify(payload)), result });

  if (commandType === COMMAND_TYPES.GRANT_HISTORY_CLASSROOM_EXEMPTIONS) {
    const [enrollmentRows, classRows] = await Promise.all([
      reader.query("semester_enrollments", { field: "semesterId", operator: "==", value: semesterId }),
      reader.query("semester_classes", { field: "semesterId", operator: "==", value: semesterId }),
    ]);
    const classes = new Map(classRows.filter((row) => row.data?.status === "ACTIVE").map((row) => [row.data.classId || row.path.split("/").at(-1), row.data]));
    const matchingClass = (value, classId) => (!payload.classId || payload.classId === classId || payload.classId === `${value.grade}-${value.classNumber}`) &&
      (!payload.targetGrade || String(value.grade) === payload.targetGrade) && (!payload.targetClass || String(value.classNumber) === payload.targetClass);
    const enrollments = enrollmentRows.filter((row) => row.data?.enrollmentStatus === "ACTIVE" && classes.has(row.data?.classId) &&
      matchingClass(classes.get(row.data.classId), row.data.classId) && (!payload.recipientUids.length || payload.recipientUids.includes(row.data.studentUid)));
    if (!enrollments.length || enrollments.length > 100 ||
        (payload.recipientUids.length && payload.recipientUids.some((uid) => !enrollments.some((row) => row.data.studentUid === uid))))
      fail("failed-precondition", "선택한 학생의 현재 학급 정보를 다시 확인해 주세요.", "HISTORY_EXEMPTION_ENROLLMENT_INVALID");
    const recipients = (await Promise.all(enrollments.map(async (row) => {
      const uid = row.data.studentUid;
      const [active, profile] = await Promise.all([
        helpers.assertActiveEnrollment(reader, semesterId, uid, [row.data.classId]),
        reader.get(`users/${uid}`),
      ]);
      if (active.enrollmentId !== (row.data.enrollmentId || row.path.split("/").at(-1))) return null;
      if (!profile.exists || profile.data?.role !== "student") fail("failed-precondition", "학생 계정을 다시 확인해 주세요.");
      return { uid, profile: profileSnapshot(uid, profile.data, active, classes.get(active.classId)), enrollment: active };
    }))).filter(Boolean);
    if (!recipients.length) fail("failed-precondition", "면제권을 부여할 활성 학생이 없습니다.");
    const exemptionIds = recipients.map(({ uid }) => `exemption_${hash(`${commandId}\n${uid}`)}`);
    const refs = exemptionIds.map((id) => ticketPath(semesterId, id));
    const notifications = await helpers.historySync.prepareExemptions({ transaction, semesterId, kind: "granted", actorUid: actor.actorUid, timestamp,
      items: recipients.map(({ uid, profile }, index) => ({ uid, exemptionId: exemptionIds[index], reason: payload.reason,
        grantScopeLabel: payload.classId || payload.targetGrade ? `${profile.studentGrade}학년 ${profile.studentClass}반` : "학생별" })) });
    recipients.forEach(({ profile, enrollment }, index) => transaction.create(refs[index], {
      ...profile, semesterId, enrollmentId: enrollment.enrollmentId, classId: enrollment.classId,
      reason: payload.reason, status: "available", revision: 1, grantScope: payload.classId || payload.targetGrade ? "class" : "student",
      grantScopeLabel: payload.classId || payload.targetGrade ? `${profile.studentGrade}학년 ${profile.studentClass}반` : "학생별",
      grantedByUid: actor.actorUid, grantedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      exemptionRequestId: "", usedAssignmentId: "", commandId,
    }));
    notifications.apply();
    return response("history-exemptions", commandId, [...refs, ...notifications.refs], { createdCount: refs.length, exemptionIds });
  }
  if (commandType === COMMAND_TYPES.REVOKE_HISTORY_CLASSROOM_EXEMPTIONS) {
    const refs = payload.exemptionIds.map((id) => ticketPath(semesterId, id));
    const tickets = await transaction.getAll(refs);
    if (tickets.some((ticket) => !ticket.exists || ticketStatus(ticket.data) !== "available"))
      fail("failed-precondition", "사용 가능 상태의 면제권만 회수할 수 있습니다.", "HISTORY_EXEMPTION_NOT_AVAILABLE");
    tickets.forEach((ticket, index) => transaction.set(refs[index], { status: "revoked", ...(ticket.data.state !== undefined ? { state: "revoked" } : {}), revision: Number(ticket.data.revision || 0) + 1, revokedByUid: actor.actorUid, revokedAt: timestamp, updatedAt: timestamp }, { merge: true }));
    return response("history-exemptions-revoke", commandId, refs, { revokedCount: refs.length, exemptionIds: payload.exemptionIds });
  }
  if (studentCommand) {
    const assignment = await assertAssignment(transaction, semesterId, payload.assignmentId, actor.actorUid, helpers);
    const ticketRef = ticketPath(semesterId, payload.exemptionId);
    const requestId = `exemption_request_${hash(`${semesterId}\n${actor.actorUid}\n${payload.assignmentId}\n${payload.exemptionId}`)}`;
    const requestRef = requestPath(semesterId, requestId);
    const [ticket, previous, completed] = await transaction.getAll([ticketRef, requestRef,
      `semester_assessment_results/${resultIdFor(semesterId, payload.assignmentId, actor.actorUid)}`]);
    if (!ticket.exists || ticketOwner(ticket.data) !== actor.actorUid) fail("permission-denied", "본인의 면제권만 사용할 수 있습니다.");
    if (previous.exists && ["pending", "requested", "approved"].includes(previous.data?.status)) {
      if (previous.data.status !== "approved") {
        const notifications = await helpers.historySync.prepareExemptions({ transaction, semesterId, kind: "requested", actorUid: actor.actorUid, timestamp,
          items: [{ ...previous.data, requestId }] });
        notifications.apply();
      }
      return response("history-exemption-request", requestId, [requestRef, ticketRef], { requestId, status: previous.data.status });
    }
    if (ticketStatus(ticket.data) !== "available" || completed.exists) fail("failed-precondition", "이미 사용 중이거나 처리된 면제권입니다.", "HISTORY_EXEMPTION_NOT_AVAILABLE");
    assertTicketAssignment(ticket.data, payload.assignmentId, helpers.now);
    await assertNotPassed(transaction, semesterId, payload.assignmentId, actor.actorUid, assignment);
    const requests = await transaction.query(`${root(semesterId)}/history_classroom_exemption_requests`, { field: "uid", operator: "==", value: actor.actorUid });
    if (requests.some((row) => row.data?.assignmentId === payload.assignmentId && ["pending", "requested", "approved"].includes(row.data.status)))
      fail("already-exists", "이 역사교실의 면제권 사용 요청이 이미 있습니다.");
    const notifications = await helpers.historySync.prepareExemptions({ transaction, semesterId, kind: "requested", actorUid: actor.actorUid, timestamp,
      items: [{ requestId, studentName: ticket.data.studentName, assignmentTitle: assignment.source.title }] });
    transaction.set(requestRef, { uid: actor.actorUid, studentName: ticket.data.studentName || "학생", studentGrade: ticket.data.studentGrade || "",
      studentClass: ticket.data.studentClass || "", studentNumber: ticket.data.studentNumber || "", semesterId,
      assignmentId: payload.assignmentId, assignmentTitle: assignment.source.title || "역사교실", exemptionId: payload.exemptionId,
      exemptionReason: ticket.data.reason || "", memo: payload.memo, status: "pending", revision: Number(previous.data?.revision || 0) + 1,
      requestedAt: timestamp, createdAt: previous.data?.createdAt || timestamp, updatedAt: timestamp });
    transaction.set(ticketRef, { status: "requested", ...(ticket.data.state !== undefined ? { state: "requested" } : {}), requestedAssignmentId: payload.assignmentId, pendingRequestId: requestId, exemptionRequestId: requestId, requestedAt: timestamp,
      revision: Number(ticket.data.revision || 0) + 1, updatedAt: timestamp }, { merge: true });
    notifications.apply();
    return response("history-exemption-request", requestId, [requestRef, ticketRef, ...notifications.refs], { requestId, status: "pending" });
  }
  if (commandType === COMMAND_TYPES.APPLY_HISTORY_CLASSROOM_EXEMPTION) {
    if (!["teacher", "admin"].includes(actor.actorRole)) fail("permission-denied", "교사만 면제권을 사용할 수 있습니다.");
    const { assignmentId, studentUid, exemptionId } = payload;
    const assignment = await assertAssignment(transaction, semesterId, assignmentId, studentUid, helpers);
    const milliseconds = (value) => value?.toMillis?.() || (typeof value === "string" ? Date.parse(value) : 0);
    const nowMs = helpers.now().getTime();
    if ((milliseconds(assignment.definition.opensAt) && nowMs < milliseconds(assignment.definition.opensAt)) ||
        [assignment.definition.closesAt, assignment.source.dueAt].some(value => milliseconds(value) && nowMs > milliseconds(value)))
      fail("failed-precondition", "응시 기간이 아닌 역사교실에는 면제권을 사용할 수 없습니다.", "HISTORY_EXEMPTION_WINDOW_CLOSED");
    const ticketRef = ticketPath(semesterId, exemptionId);
    const [ticket, profile, requests] = await Promise.all([transaction.get(ticketRef), transaction.get(`users/${studentUid}`),
      transaction.query(`${root(semesterId)}/history_classroom_exemption_requests`, { field: "uid", operator: "==", value: studentUid })]);
    if (!profile.exists || profile.data?.role !== "student") fail("failed-precondition", "학생 계정을 다시 확인해 주세요.");
    if (!ticket.exists || ticketOwner(ticket.data) !== studentUid) fail("permission-denied", "해당 학생의 면제권만 사용할 수 있습니다.");
    if (ticket.data.semesterId !== undefined && ticket.data.semesterId !== semesterId)
      fail("failed-precondition", "면제권의 학기 정보를 확인해 주세요.", "HISTORY_EXEMPTION_SEMESTER_MISMATCH");
    if (ticketStatus(ticket.data) !== "available") fail("failed-precondition", "사용 가능한 면제권을 선택해 주세요.", "HISTORY_EXEMPTION_NOT_AVAILABLE");
    assertTicketAssignment(ticket.data, assignmentId, helpers.now);
    if (requests.some(row => row.data?.assignmentId === assignmentId && ["pending", "requested"].includes(row.data?.status)))
      fail("failed-precondition", "학생이 신청한 면제권 사용 요청을 먼저 검토해 주세요.", "HISTORY_EXEMPTION_REQUEST_PENDING");
    const approval = await prepareCompletion(transaction, semesterId, assignmentId, studentUid, assignment);
    const requestId = `exemption_direct_${hash(`${semesterId}\n${assignmentId}\n${studentUid}`)}`;
    const requestRef = requestPath(semesterId, requestId);
    const audit = { origin: "teacher_direct", initiatedByUid: actor.actorUid };
    const current = { ...profileSnapshot(studentUid, profile.data, assignment.enrollment, assignment.semesterClass), semesterId, assignmentId, exemptionId };
    const notifications = await helpers.historySync.prepareExemptions({ transaction, semesterId, kind: "reviewed", actorUid: actor.actorUid, timestamp,
      items: [{ uid: studentUid, requestId, approved: true, assignmentTitle: assignment.source.title }] });
    transaction.set(ticketRef, { status: "used", ...(ticket.data.state !== undefined ? { state: "used" } : {}), ...audit,
      requestedAssignmentId: "", pendingRequestId: "", exemptionRequestId: requestId, usedAssignmentId: assignmentId,
      usedRequestId: requestId, usedByUid: studentUid, usedAt: timestamp, revision: Number(ticket.data.revision || 0) + 1, updatedAt: timestamp }, { merge: true });
    transaction.create(requestRef, { ...current, ...audit, status: "approved", revision: 1,
      assignmentTitle: assignment.source.title || "역사교실", exemptionReason: ticket.data.reason || "", memo: "",
      reviewReason: "교사 직접 사용", reviewedByUid: actor.actorUid, reviewedAt: timestamp,
      resultId: approval.resultId, createdAt: timestamp, updatedAt: timestamp });
    writeCompletion(transaction, approval, current, requestId, actor, timestamp, helpers.now, audit);
    notifications.apply();
    return response("history-exemption-direct", requestId, [requestRef, ticketRef, approval.canonicalRef, approval.legacyRef, ...approval.attempts.map(row => row.path), ...notifications.refs],
      { studentUid, assignmentId, exemptionId, resultId: approval.resultId, status: "approved", origin: "teacher_direct" });
  }
  const requestRef = requestPath(semesterId, payload.requestId);
  const request = await transaction.get(requestRef);
  if (!request.exists) fail("not-found", "면제권 사용 요청을 찾을 수 없습니다.");
  const current = request.data;
  const targetStatus = payload.approved ? "approved" : "rejected";
  if (current.status === targetStatus) return response("history-exemption-review", payload.requestId, [requestRef], { requestId: payload.requestId, status: targetStatus, resultId: current.resultId || "" });
  if (!["pending", "requested"].includes(current.status)) fail("failed-precondition", "이미 처리된 면제권 사용 요청입니다.");
  const ticketRef = ticketPath(semesterId, id(current.exemptionId, "exemptionId"));
  const ticket = await transaction.get(ticketRef);
  if (!ticket.exists || ticketOwner(ticket.data) !== current.uid || ticketStatus(ticket.data) !== "requested" ||
      (ticket.data.pendingRequestId || ticket.data.exemptionRequestId) !== payload.requestId)
    fail("failed-precondition", "면제권과 사용 요청 상태가 일치하지 않습니다.");
  let resultId = "";
  const refs = [requestRef, ticketRef];
  let approval = null;
  if (payload.approved) {
    const assignment = await assertAssignment(transaction, semesterId, id(current.assignmentId, "assignmentId"), current.uid, helpers);
    assertTicketAssignment(ticket.data, current.assignmentId, helpers.now);
    approval = await prepareCompletion(transaction, semesterId, current.assignmentId, current.uid, assignment);
    resultId = approval.resultId;
    refs.push(approval.canonicalRef, approval.legacyRef, ...approval.attempts.map((row) => row.path));
  }
  const notifications = await helpers.historySync.prepareExemptions({ transaction, semesterId, kind: "reviewed", actorUid: actor.actorUid, timestamp,
    items: [{ ...current, requestId: payload.requestId, approved: payload.approved }] });
  // All validation and reads precede the writes, including approval's result.
  transaction.set(ticketRef, { status: payload.approved ? "used" : "available", requestedAssignmentId: "", pendingRequestId: "",
    ...(ticket.data.state !== undefined ? { state: payload.approved ? "used" : "available" } : {}),
    exemptionRequestId: payload.approved ? payload.requestId : "", usedAssignmentId: payload.approved ? current.assignmentId : "",
    ...(payload.approved ? { usedAt: timestamp, usedRequestId: payload.requestId, usedByUid: current.uid } : {}), revision: Number(ticket.data.revision || 0) + 1, updatedAt: timestamp }, { merge: true });
  transaction.set(requestRef, { status: targetStatus, reviewReason: payload.reviewReason, reviewedByUid: actor.actorUid, reviewedAt: timestamp,
    revision: Number(current.revision || 0) + 1, resultId, updatedAt: timestamp }, { merge: true });
  if (approval) {
    writeCompletion(transaction, approval, { ...current, semesterId }, payload.requestId, actor, timestamp, helpers.now);
  }
  notifications.apply();
  return response("history-exemption-review", payload.requestId, [...refs, ...notifications.refs], { requestId: payload.requestId, status: targetStatus, resultId });
};

module.exports = { COMMAND_TYPES, normalizePayload, apply, resultIdFor };
