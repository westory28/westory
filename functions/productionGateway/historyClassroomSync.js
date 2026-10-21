const { createHash } = require("node:crypto");

const ROOT_RESULT_COLLECTION = "semester_assessment_results";
const NOTIFICATION_CONFIG_PATH = "site_settings/notification_config";
const ADMIN_EMAIL = "westoria28@gmail.com";
const text = (value, maximum = 160, fallback = "") =>
  (String(value ?? "").replace(/\s+/g, " ").trim() || fallback).slice(0, maximum);
const root = (semesterId) => {
  if (!/^\d{4}-[12]$/.test(semesterId)) throw new Error("Invalid History Classroom semester.");
  const [year, semester] = semesterId.split("-");
  return `years/${year}/semesters/${semester}`;
};
const notificationId = (dedupeKey) => `n_${createHash("sha1").update(text(dedupeKey, 240)).digest("hex")}`;
const noOp = () => ({ refs: [], apply() {} });
const timestampMs = value => value?.toMillis?.() || (typeof value === "string" ? Date.parse(value) || 0 : value instanceof Date ? value.getTime() : 0);
const assignmentIdFor = (attempt, definition = {}) => {
  const prefix = `history_classroom:${attempt.semesterId}:`;
  const assignmentId = String(attempt.assignmentId || attempt.sourceId || definition.sourceId ||
    (String(attempt.definitionId || "").startsWith(prefix) ? attempt.definitionId.slice(prefix.length) : ""));
  if (!assignmentId || /[\/\\\u0000-\u001f]/u.test(assignmentId)) throw new Error("Invalid History Classroom assignment.");
  return assignmentId;
};
const studentSnapshot = (attempt, profile = {}, enrollment = {}, semesterClass = {}) => ({
  uid: attempt.studentUid,
  studentName: text(enrollment.snapshot?.displayName || enrollment.studentName || profile.name, 80, "학생"),
  studentGrade: text(semesterClass.grade || profile.studentGrade || profile.grade, 12),
  studentClass: text(semesterClass.classNumber || profile.studentClass || profile.class, 12),
  studentNumber: text(enrollment.studentNumber || profile.studentNumber || profile.number, 12),
});

// A plan completes every read before its caller stages business writes. Inbox
// items, unread counters, the teacher projection and the command receipt then
// commit together. Replaying a result never produces a second notification.
const createHistoryClassroomSync = ({ now = () => new Date(), prepareInput = null,
  expiresAt = () => new Date(now().getTime() + 30 * 86400_000) } = {}) => {
  const prepareNotifications = async ({ transaction, semesterId, events, timestamp }) => {
    if (!prepareInput || !events.length) return noOp();
    const [year, semester] = semesterId.split("-");
    const configSnapshot = await transaction.get(NOTIFICATION_CONFIG_PATH);
    let teachers = [];
    if (events.some(event => event.audience === "teachers")) {
      const recipients = await Promise.all([
        transaction.query("users", { field: "email", operator: "==", value: ADMIN_EMAIL, limit: 200 }),
        transaction.query("users", { field: "role", operator: "==", value: "teacher", limit: 200 }),
        transaction.query("users", { field: "role", operator: "==", value: "admin", limit: 200 }),
        transaction.query("users", { field: "staffPermissions", operator: "array-contains", value: "quiz_read", limit: 200 }),
      ]);
      teachers = [...new Set(recipients.flat().filter(row => {
        const profile = row.data || {};
        return String(profile.email || "").trim().toLowerCase() === ADMIN_EMAIL || ["teacher", "admin"].includes(profile.role) ||
          (profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) && profile.staffPermissions.includes("quiz_read"));
      }).map(row => row.path.split("/").at(-1)))].slice(0, 200);
    }
    const items = new Map();
    for (const event of events) {
      const prepared = await prepareInput(year, semester, event, configSnapshot.data || {});
      if (!prepared || prepared.skipped) continue;
      const recipientUids = event.audience === "teachers" ? teachers : event.recipientUids || [];
      const dedupeKey = text(prepared.dedupeKey || event.dedupeKey, 240);
      const id = notificationId(dedupeKey);
      for (const uid of [...new Set(recipientUids)].filter(Boolean).slice(0, 200)) {
        if (/[\/\\\u0000-\u001f]/u.test(uid)) throw new Error("Invalid notification recipient.");
        const inboxPath = `${root(semesterId)}/notification_inboxes/${uid}`;
        const path = `${inboxPath}/items/${id}`;
        items.set(path, { path, inboxPath, uid, occurredAtMs: timestampMs(event.occurredAt) || now().getTime(), data: {
          type: prepared.type, title: text(prepared.title, 80, "알림"), body: text(prepared.body, 500),
          targetUrl: text(prepared.targetUrl, 240), entityType: text(prepared.entityType, 80),
          entityId: text(prepared.entityId, 160), actorUid: text(prepared.actorUid, 160),
          recipientUid: uid, priority: prepared.priority === "high" ? "high" : "normal",
          dedupeKey, readAt: null, createdAt: timestamp, expiresAt: expiresAt(),
        } });
      }
    }
    const candidates = [...items.values()];
    if (!candidates.length) return noOp();
    const inboxPaths = [...new Set(candidates.map(item => item.inboxPath))];
    const snapshots = await transaction.getAll([...candidates.map(item => item.path), ...inboxPaths]);
    const inboxByPath = new Map(inboxPaths.map((path, index) => [path, snapshots[candidates.length + index].data || {}]));
    const pending = candidates.filter((item, index) => !snapshots[index].exists &&
      timestampMs(inboxByPath.get(item.inboxPath)?.broadcastClearedAt) < item.occurredAtMs);
    const inboxes = inboxPaths.map((path, index) => ({ path, current: snapshots[candidates.length + index].data || {},
      items: pending.filter(item => item.inboxPath === path) })).filter(inbox => inbox.items.length);
    return { refs: pending.map(item => item.path), apply() {
      for (const item of pending) transaction.create(item.path, item.data);
      for (const inbox of inboxes) transaction.set(inbox.path, {
        uid: inbox.items[0].uid, unreadCount: Math.max(0, Number(inbox.current.unreadCount) || 0) + inbox.items.length,
        updatedAt: timestamp,
      }, { merge: true });
    } };
  };

  const prepareAttempt = async ({ transaction, attempt, result = null, answers = attempt.answers || {},
    lockReason = "", timestamp }) => {
    if (attempt.assessmentKind !== "HISTORY_CLASSROOM") return noOp();
    const frozenThreshold = [result?.passThresholdPercent, attempt.passThresholdPercent]
      .find(value => Number.isFinite(value) && value >= 0 && value <= 100);
    if (result && typeof result.passed !== "boolean" &&
      (frozenThreshold === undefined || !Number.isFinite(result.percent))) return { ...noOp(), unknownOutcome: true };
    const snapshots = await transaction.getAll([
      `semester_assessment_definitions/${attempt.definitionId}`, `users/${attempt.studentUid}`,
      `semester_enrollments/${attempt.enrollmentId}`, `semester_classes/${attempt.classId}`,
    ]);
    const definition = snapshots[0].data || {};
    const assignmentId = assignmentIdFor(attempt, definition);
    const projectionPath = `${root(attempt.semesterId)}/history_classroom_results/${attempt.attemptId}`;
    const [source, existing] = await transaction.getAll([
      `${root(attempt.semesterId)}/history_classrooms/${assignmentId}`, projectionPath,
    ]);
    const student = studentSnapshot(attempt, snapshots[1].data || {}, snapshots[2].data || {}, snapshots[3].data || {});
    const assignmentTitle = text(result?.assignmentTitle || attempt.assignmentTitle || definition.title || source.data?.title, 120, "역사교실");
    const cancelled = !result;
    const passed = !cancelled && (typeof result.passed === "boolean" ? result.passed : result.percent >= frozenThreshold);
    const blankById = new Map((source.data?.blanks || []).map((blank, index) => [blank.id, { ...blank, index }]));
    const checkById = new Map((result?.answerChecks || []).map(check => [check.id || check.blankId, check]));
    const grading = attempt.gradingSnapshot || [];
    const projection = {
      resultId: attempt.attemptId, attemptId: attempt.attemptId, definitionId: attempt.definitionId,
      semesterId: attempt.semesterId, assessmentKind: "HISTORY_CLASSROOM", studentUid: attempt.studentUid,
      enrollmentId: attempt.enrollmentId, classId: attempt.classId, assignmentId, assignmentTitle, ...student,
      completionSource: "attempt", status: cancelled ? "cancelled" : passed ? "passed" : "failed", passed,
      score: cancelled ? 0 : result.score, total: cancelled ? grading.length : result.total,
      percent: cancelled ? 0 : result.percent, passThresholdPercent: frozenThreshold ?? 80,
      answers, answerChecks: cancelled ? [] : grading.map((item, index) => ({
        blankId: item.id, blankNumber: (blankById.get(item.id)?.index ?? index) + 1,
        page: Math.max(1, Number(blankById.get(item.id)?.page) || 1), studentAnswer: String(answers[item.id] ?? ""),
        correctAnswer: String(item.answer ?? ""), correct: checkById.get(item.id)?.correct === true,
      })),
      ...(cancelled ? { lockReason, cancellationReason: lockReason === "VISIBILITY_HIDDEN" ? "응시 중 화면 전환" : "응시 중 페이지 이탈" } : {}),
      submittedAtIso: result?.submittedAtIso || attempt.lockedAtIso || now().toISOString(),
      createdAt: result?.createdAt || (attempt.status === "LOCKED" ? attempt.updatedAt : timestamp) || timestamp, updatedAt: timestamp,
    };
    if (existing.exists && (existing.data?.uid !== attempt.studentUid || existing.data?.assignmentId !== assignmentId))
      throw new Error("History Classroom projection identity conflicts with its immutable attempt.");
    const [year, semester] = attempt.semesterId.split("-");
    const targetUrl = `/teacher/quiz/history-classroom?assignmentId=${encodeURIComponent(assignmentId)}`;
    const events = [];
    if (passed) events.push({ audience: "teachers", type: "history_classroom_passed", title: "역사교실 통과 알림",
      body: `${student.studentName} 학생이 ${assignmentTitle}을(를) ${result.percent}%로 통과했습니다.`,
      targetUrl, entityType: "history_classroom_result", entityId: attempt.attemptId, actorUid: attempt.studentUid, priority: "normal",
      dedupeKey: `history_classroom_passed:${year}:${semester}:${attempt.attemptId}`,
      occurredAt: result.submittedAtIso || result.createdAt,
      templateValues: { studentName: student.studentName, assignmentTitle, percent: result.percent },
    });
    if (cancelled && ["VISIBILITY_HIDDEN", "NAVIGATION"].includes(lockReason)) events.push({
      audience: "teachers", type: "history_classroom_locked", title: "역사교실 확인 요청",
      body: `${student.studentName} 학생의 ${assignmentTitle} 응시가 자동 종료되어 교사 확인이 필요합니다.`,
      targetUrl, entityType: "history_classroom_result", entityId: attempt.attemptId, actorUid: attempt.studentUid, priority: "high",
      dedupeKey: `history_classroom_locked:${year}:${semester}:${attempt.attemptId}`,
      occurredAt: attempt.lockedAtIso || attempt.updatedAt,
      templateValues: { studentName: student.studentName, assignmentTitle, reason: projection.cancellationReason },
    });
    const notifications = await prepareNotifications({ transaction, semesterId: attempt.semesterId, events, timestamp });
    return { refs: [projectionPath, ...notifications.refs], projection, projectionMissing: !existing.exists, apply() {
      if (!existing.exists) transaction.create(projectionPath, projection);
      notifications.apply();
    } };
  };

  const exemptionEvent = (semesterId, kind, data, actorUid) => {
    const [year, semester] = semesterId.split("-");
    const assignmentTitle = text(data.assignmentTitle, 120, "역사교실");
    if (kind === "requested") return { audience: "teachers", type: "history_classroom_exemption_requested",
      title: "역사교실 면제권 사용 요청", body: `${text(data.studentName, 80, "학생")} 학생이 ${assignmentTitle} 면제권 사용을 요청했습니다.`,
      targetUrl: `/teacher/quiz/history-classroom?panel=exemption-requests&requestId=${encodeURIComponent(data.requestId)}`,
      entityType: "history_classroom_exemption_request", entityId: data.requestId, actorUid, priority: "high",
      dedupeKey: `history_classroom_exemption_requested:${year}:${semester}:${data.requestId}`,
      occurredAt: data.requestedAt || data.createdAt,
      templateValues: { studentName: text(data.studentName, 80, "학생"), assignmentTitle },
    };
    if (kind === "reviewed") {
      const statusLabel = data.approved ? "승인" : "반려";
      return { audience: "students", recipientUids: [data.uid], type: "history_classroom_exemption_reviewed",
        title: "역사교실 면제권 처리", body: `${assignmentTitle} 면제권 사용 요청이 ${statusLabel} 처리되었습니다.`,
        targetUrl: "/student/history-classroom", entityType: "history_classroom_exemption_request", entityId: data.requestId,
        actorUid, priority: data.approved ? "normal" : "high",
        dedupeKey: `history_classroom_exemption_reviewed:${year}:${semester}:${data.requestId}:${data.approved ? "approved" : "rejected"}`,
        occurredAt: data.reviewedAt,
        templateValues: { assignmentTitle, statusLabel },
      };
    }
    const reason = text(data.reason, 160);
    return { audience: "students", recipientUids: [data.uid], type: "history_classroom_exemption_granted",
      title: "역사교실 면제권이 부여되었습니다", body: reason ? `역사교실 면제권이 부여되었습니다. 사유: ${reason}` : "역사교실 면제권이 부여되었습니다.",
      targetUrl: "/student/history-classroom", entityType: "history_classroom_exemption", entityId: data.exemptionId,
      actorUid, priority: "normal", dedupeKey: `history_classroom_exemption_granted:${year}:${semester}:${data.exemptionId}`,
      occurredAt: data.grantedAt || data.createdAt,
      templateValues: { reason, scopeLabel: text(data.grantScopeLabel, 40) },
    };
  };
  const prepareExemptions = ({ transaction, semesterId, kind, items, actorUid, timestamp }) =>
    prepareNotifications({ transaction, semesterId, events: items.map(item => exemptionEvent(semesterId, kind, item, actorUid)), timestamp });
  const prepareAssignment = ({ transaction, semesterId, assignmentId, assignmentTitle, revision, recipientUids, actorUid, timestamp }) => {
    const [year, semester] = semesterId.split("-");
    return prepareNotifications({ transaction, semesterId, timestamp, events: recipientUids.length ? [{
      audience: "students", recipientUids, type: "history_classroom_assigned", title: "역사교실이 배정되었습니다",
      body: `${text(assignmentTitle, 120, "역사교실")} 과제가 새로 열렸습니다.`, targetUrl: "/student/history-classroom",
      entityType: "history_classroom_assignment", entityId: assignmentId, actorUid, priority: "normal",
      dedupeKey: `history_classroom_assigned:${year}:${semester}:${assignmentId}:${revision}`,
      templateValues: { assignmentTitle: text(assignmentTitle, 120, "역사교실") },
    }] : [] });
  };
  return { prepareAttempt, prepareNotifications, prepareExemptions, prepareAssignment };
};

module.exports = { ROOT_RESULT_COLLECTION, createHistoryClassroomSync, assignmentIdFor, notificationId, timestampMs };
