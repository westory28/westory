const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const firestore = require("firebase-admin/firestore");
const gateway = require("../commandGateway");
const lesson = require("../lessonManagement");
const w8 = require("../w8Domains");
const policy = require("../routineContentWrites.json");
const { Store } = require("./verify-lesson-answers.cjs");

// Execute the actual session authority with only its Firestore I/O replaced.
// No emulator, network, user data or production configuration is accessed.
const authorityPath = resolve(__dirname, "../sessionAuthority.js");
const actualRequire = Module.createRequire(authorityPath);
const sessionDocuments = new Map();
const authorityModule = new Module(authorityPath, module);
authorityModule.filename = authorityPath;
authorityModule.paths = module.paths;
authorityModule.require = (name) => {
  if (name === "firebase-admin/firestore") return {
    ...firestore,
    getFirestore: () => ({ doc: (path) => ({
      get: async () => ({ exists: sessionDocuments.has(path), data: () => sessionDocuments.get(path), ref: { path } }),
    }) }),
  };
  if (name === "./studentMaintenance") return { onCallWithStudentMaintenance: (_options, handler) => handler };
  return actualRequire(name);
};
authorityModule._compile(readFileSync(authorityPath, "utf8"), authorityPath);
const authority = authorityModule.exports;
const savedEnvironment = Object.fromEntries(["GCLOUD_PROJECT", "WESTORY_SESSION_IDLE_MODE", "WESTORY_APP_CHECK_MODE"].map((key) => [key, process.env[key]]));
process.env.GCLOUD_PROJECT = "demo-westory-session-routine-content";
process.env.WESTORY_SESSION_IDLE_MODE = "ENFORCE";
process.env.WESTORY_APP_CHECK_MODE = "DISABLED";
const authTime = Math.floor(Date.now() / 1000) - 6 * 60;
const sessionPath = `application_sessions/admin/sessions/${authTime}`;
const proof = { authorityGeneration: authority.SESSION_AUTHORITY_GENERATION, protocolVersion: 2, revision: "a".repeat(64) };
const activeSession = () => ({
  authTime, status: "active", schemaVersion: 2,
  authorityGeneration: proof.authorityGeneration, protocolVersion: 2,
  sessionRevision: proof.revision, authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: firestore.Timestamp.fromMillis(Date.now() + 60_000),
  highRiskExpiresAt: firestore.Timestamp.fromMillis(Date.now() - 1000),
});
const request = (commandType, payload, commandId = randomUUID()) => ({
  auth: { uid: "admin", token: { email: "westoria28@gmail.com", auth_time: authTime } },
  data: { commandId, commandType, ...(payload ? { payload } : {}), _session: proof },
});
const protectedCommands = [
  "deleteMapResource", "deleteSourceArchiveAsset", "deleteQuizQuestion", "deleteHistoryClassroomSource",
  "resetAssessmentAttempt", "resetAssessmentAttemptsByClassV2", "deleteThinkCloudSession",
  "recordAttendance", "recordAttendanceBulk", "resetLearningProgress", "grantLearningExemptions",
  "updateNotificationSettings", "updateStudentEnrollmentProfile", "approveStudentRegistration",
  "createGradeDraft", "finalizeGradeEvidence", "publishOfficialGrade", "correctOfficialGrade",
  "saveLegacyGradeConfig", "grantWis", "deductWis", "adjustWis", "reverseWisEntry",
  "activateSemester", "updateOperationalSettings", "createTeacherBulkJob", "updateTermsSettings",
];
let checks = 0;
const rejectReason = async (operation, reason) => {
  await assert.rejects(operation, (error) => error.details?.reason === reason);
  checks++;
};
(async () => {
  const treePath = "years/2026/semesters/2/curriculum/tree";
  const store = new Store({
    "site_settings/semester_active": { semesterId: "2026-2", revision: 4 },
    "semester_manifests/2026-2": { semesterId: "2026-2", revision: 4, status: "ACTIVE" },
  });
  sessionDocuments.set(sessionPath, activeSession());
  const core = gateway.createCommandGatewayCore({
    store,
    projectId: "demo-westory-session-routine-content",
    assertSession: authority.assertActiveApplicationSession,
    serverTimestamp: () => 123, concreteTimestamp: () => 123,
    commandAdapters: { saveLessonTree: lesson.createLessonCommandAdapter() },
  });
  assert.equal(new Set(policy.commands).size, policy.commands.length);
  for (const type of policy.commands) {
    assert(Object.values(gateway.COMMAND_TYPES).includes(type), `${type} must be a supported command`);
    const result = await core.getStatus(request(type));
    assert.equal(result.status, "NOT_FOUND", `${type} accepts an active general session after six minutes`);
    if (Object.values(w8.W8_COMMAND_TYPES).includes(type)) {
      assert.deepEqual(w8.getW8CommandSessionOptions(type), { recentAuth: false, highRisk: false });
      assert.equal(w8.HIGH_RISK_COMMAND_TYPES.has(type), false);
    }
    checks++;
  }
  for (const type of protectedCommands) {
    assert(Object.values(gateway.COMMAND_TYPES).includes(type), `${type} must be a supported protected command`);
    assert(!policy.commands.includes(type), `${type} must not enter the routine allowlist`);
    await rejectReason(core.getStatus(request(type)), "RECENT_AUTH_REQUIRED");
    await rejectReason(core.execute(request(type, {})), "RECENT_AUTH_REQUIRED");
  }
  await rejectReason(core.getStatus(request("futureUnknownCommand")), "RECENT_AUTH_REQUIRED");
  const command = request("saveLessonTree", {
    semesterId: "2026-2", expectedSemesterRevision: 4, expectedRevision: 0,
    tree: [{ id: "unit-one", title: "일반 세션 저장", children: [] }],
  });
  const first = await core.execute(command);
  assert.equal(first.replayed, false);
  assert.equal((await store.get(treePath)).data.contentRevision, 1);
  const retry = await core.execute(command);
  assert.equal(retry.replayed, true);
  assert.equal((await store.get(treePath)).data.contentRevision, 1);
  assert.equal((await core.getStatus(request("saveLessonTree", null, command.data.commandId))).status, "SUCCEEDED");
  checks += 3;
  await rejectReason(core.execute(request("saveLessonTree", command.data.payload)), "LESSON_CONTENT_CONFLICT");
  await rejectReason(core.execute(request("saveLessonTree", { ...command.data.payload, semesterId: "2026-1" })), "LESSON_SEMESTER_NOT_ACTIVE");
  const revoked = { ...command, data: { ...command.data, _session: { ...proof, revision: "b".repeat(64) } } };
  await rejectReason(core.execute(revoked), "SESSION_PROOF_INVALID");
  for (const invalidSession of [
    { ...activeSession(), generalExpiresAt: firestore.Timestamp.fromMillis(Date.now() - 1000) },
    { ...activeSession(), status: "closed" },
  ]) {
    sessionDocuments.set(sessionPath, invalidSession);
    await rejectReason(core.execute(command), "SESSION_EXPIRED");
  }
  sessionDocuments.delete(sessionPath);
  await rejectReason(core.execute(command), "SESSION_MISSING");
  assert.equal((await store.get(treePath)).data.contentRevision, 1, "denied requests do not mutate content");
  console.log(JSON.stringify({ passed: true, checks, routineCommands: policy.commands.length, protectedCommands: protectedCommands.length, actualSessionAuthority: true, authenticationAgeSeconds: 360, networkAccess: 0, coverage: "general-session save/status/replay; protected recent authentication; expired/missing/revoked session; CAS and active semester" }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
