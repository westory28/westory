const assert = require("node:assert/strict");
const { createHistoryClassroomSync } = require("../productionGateway/historyClassroomSync");

const scope = "2026-2", assignmentId = "frozen-history";
const baseAttempt = { attemptId: `attempt_${"a".repeat(64)}`, definitionId: `history_classroom:${scope}:${assignmentId}`,
  semesterId: scope, assessmentKind: "HISTORY_CLASSROOM", studentUid: "student", enrollmentId: "enrollment", classId: "class",
  passThresholdPercent: 90, gradingSnapshot: [{ id: "blank", answer: "고려" }], answers: { blank: "고려" } };
const inspect = async (result, attempt = baseAttempt, mutableThreshold = 100) => {
  const documents = new Map([
    [`semester_assessment_definitions/${attempt.definitionId}`, { sourceId: assignmentId, title: "합성 역사교실" }],
    [`years/2026/semesters/2/history_classrooms/${assignmentId}`, { title: "합성 역사교실", passThresholdPercent: mutableThreshold }],
  ]);
  let writes = 0;
  const transaction = {
    getAll: async paths => paths.map(path => ({ path, exists: documents.has(path), data: documents.get(path) || null })),
    create: (path, data) => { assert(!documents.has(path)); documents.set(path, data); writes++; },
  };
  const plan = await createHistoryClassroomSync({ now: () => new Date("2026-10-21T00:00:00Z") }).prepareAttempt({
    transaction, attempt, result: { score: 28, total: 30, answerChecks: [], ...result }, timestamp: "synthetic-timestamp",
  });
  assert.equal(writes, 0, "preparing a projection must never stage partial writes");
  return { plan, writeCount: () => writes };
};
const verifyNotifications = async () => {
  process.env.GCLOUD_PROJECT = "demo-westory-session-history-sync";
  process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
  const { createHistoryClassroomSync: createProductionSync } = require("../productionGateway/productionSource");
  const configPath = "site_settings/notification_config", root = "years/2026/semesters/2";
  const timestamp = new Date("2026-10-22T00:00:00Z");
  const documents = new Map([
    [`semester_assessment_definitions/${baseAttempt.definitionId}`, { sourceId: assignmentId, title: "알림에 포함하지 않을 긴 과제 제목" }],
    [`${root}/history_classrooms/${assignmentId}`, { title: "알림에 포함하지 않을 긴 과제 제목" }],
    ["users/student", { role: "student", name: "홍길동" }],
    ["users/teacher", { role: "teacher" }],
    ["users/staff", { role: "staff", teacherPortalEnabled: true, staffPermissions: ["quiz_read"] }],
    ["users/disabled-staff", { role: "staff", teacherPortalEnabled: false, staffPermissions: ["quiz_read"] }],
    [configPath, { eventPolicies: {
      history_classroom_passed: { titleTemplate: "{studentName} 통과", bodyTemplate: "{assignmentTitle}: {percent}%" },
      history_classroom_failed: { bodyTemplate: "{assignmentTitle}: {percent}%" },
    } }],
  ]);
  let writes = 0;
  const snapshot = path => ({ path, exists: documents.has(path), data: documents.get(path) || null });
  const transaction = {
    get: async path => snapshot(path), getAll: async paths => paths.map(snapshot),
    query: async (collection, filter) => [...documents].filter(([path, data]) => path.startsWith(`${collection}/`) &&
      path.split("/").length === 2 && (filter.operator === "array-contains"
        ? Array.isArray(data[filter.field]) && data[filter.field].includes(filter.value)
        : data[filter.field] === filter.value)).map(([path, data]) => ({ path, data })),
    create: (path, data) => { assert(!documents.has(path)); documents.set(path, data); writes++; },
    set: (path, data, options) => { documents.set(path, options?.merge ? { ...documents.get(path), ...data } : data); writes++; },
  };
  const sync = createProductionSync({ now: () => timestamp });
  const submit = async (letter, passed) => {
    const attempt = { ...baseAttempt, attemptId: `attempt_${letter.repeat(64)}` };
    const before = writes;
    const plan = await sync.prepareAttempt({ transaction, attempt, timestamp,
      result: { passed, percent: passed ? 100 : 0, score: passed ? 1 : 0, total: 1,
        passThresholdPercent: 90, answerChecks: [], submittedAtIso: timestamp.toISOString() } });
    assert.equal(writes, before, "preparing outcome notifications never stages partial writes");
    plan.apply();
    return attempt.attemptId;
  };
  const alerts = uid => [...documents].filter(([path]) => path.startsWith(`${root}/notification_inboxes/${uid}/items/`)).map(([, data]) => data);
  const passedId = await submit("a", true);
  assert.equal(alerts("teacher")[0].body, "홍길동 학생이 역사교실을 100%로 통과했습니다.");
  assert.equal(alerts("teacher")[0].title, "홍길동 통과");
  assert.equal(alerts("staff").length, 1);
  assert.equal(alerts("disabled-staff").length, 0);
  assert.equal(alerts("student").length, 0, "teacher outcomes never enter student inboxes");
  await submit("a", true);
  assert.equal(alerts("teacher").length, 1, "a replay keeps the existing pass alert");
  const failedId = await submit("b", false);
  const failed = alerts("teacher").find(item => item.entityId === failedId);
  assert.equal(failed.type, "history_classroom_failed");
  assert.equal(failed.body, "홍길동 학생이 역사교실을 0%로 미통과했습니다.");
  assert.ok(failed.targetUrl.includes(`assignmentId=${assignmentId}`));
  await submit("b", false);
  assert.equal(alerts("teacher").length, 2, "a replay keeps one failure alert");
  assert.equal(documents.get(`${root}/notification_inboxes/teacher`).unreadCount, 2);
  documents.set(configPath, { eventPolicies: { history_classroom_failed: { enabled: false } } });
  const mutedId = await submit("c", false);
  assert.equal(alerts("teacher").length, 2);
  assert.equal(documents.get(`${root}/history_classroom_results/${mutedId}`).status, "failed");
  documents.set(configPath, { teacherNotificationsEnabled: false });
  await submit("d", true);
  assert.equal(alerts("teacher").length, 2, "the teacher-wide disable policy is preserved");
  documents.set(configPath, {});
  const passedEntry = [...documents].find(([path, data]) => path.includes("notification_inboxes/teacher/items/") && data.entityId === passedId);
  documents.delete(passedEntry[0]);
  documents.set(`${root}/notification_inboxes/teacher`, { unreadCount: 1, broadcastClearedAt: timestamp });
  await submit("a", true);
  assert.equal(documents.has(passedEntry[0]), false, "a cleared earlier alert is never restored by replay");
};
(async () => {
  const explicitFailure = await inspect({ passed: false, percent: 100, passThresholdPercent: 90 });
  assert.equal(explicitFailure.plan.projection.status, "failed", "an explicit immutable failure remains authoritative at a high score");
  const resultThreshold = await inspect({ percent: 93, passThresholdPercent: 90 }, { ...baseAttempt, passThresholdPercent: 95 });
  assert.equal(resultThreshold.plan.projection.status, "passed");
  assert.equal(resultThreshold.plan.projection.passThresholdPercent, 90, "the immutable result threshold precedes the frozen attempt threshold");
  const attemptThreshold = await inspect({ percent: 93 });
  assert.equal(attemptThreshold.plan.projection.status, "passed", "a changed current assignment threshold does not alter a frozen result");
  assert.equal(attemptThreshold.plan.projection.passThresholdPercent, 90);
  const frozenFailure = await inspect({ percent: 89, passThresholdPercent: 90 }, baseAttempt, 0);
  assert.equal(frozenFailure.plan.projection.status, "failed", "lowering the current assignment threshold does not change an old result");
  const { passThresholdPercent: omittedThreshold, ...unknownAttempt } = baseAttempt;
  const unknown = await inspect({ percent: 100 }, unknownAttempt, 0);
  assert.equal(unknown.plan.unknownOutcome, true);
  assert.equal(unknown.plan.projection, undefined);
  unknown.plan.apply();
  assert.equal(unknown.writeCount(), 0, "an unfrozen historical outcome is flagged without inventing pass/fail");
  const zeroThreshold = await inspect({ percent: 0, passThresholdPercent: 0 });
  assert.equal(zeroThreshold.plan.projection.status, "passed", "zero is a valid frozen threshold");
  await verifyNotifications();
  console.log("PASS History Classroom outcome notifications: fixed concise pass/fail bodies, saved-template override, teacher/staff-only recipients, replay and clear suppression, unread counters, event/global disable policy");
  console.log("PASS History Classroom compatibility: explicit outcomes, result/attempt frozen threshold precedence, mutable settings ignored, unknown outcome zero writes, zero threshold");
})().catch(error => { console.error(error); process.exitCode = 1; });
