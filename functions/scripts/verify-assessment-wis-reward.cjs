const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { createHash } = require("node:crypto");
const assessment = require("../assessmentLifecycle");
const wis = require("../wisEconomy");
const gateway = require("../commandGateway");
const archive = require("../archiveEnrollment");
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);

// Exercise the production policy loader/normalizer/planner, not a copied policy.
// Rank display normalization is irrelevant to award planning and isolated here.
const indexSource = fs.readFileSync(require.resolve("../index.js"), "utf8");
const ast = ts.createSourceFile("index.js", indexSource, ts.ScriptTarget.Latest, true);
const names = new Set(["toFiniteNumber", "toNonNegativeNumber", "toPositiveThreshold", "toPositiveInteger",
  "resolveAutoRewardEnabled", "resolveQuizBonusInput", "getDefaultPointPolicy", "normalizePointPolicy", "loadPolicy", "resolveActivityReward"]);
const declarations = [];
function walk(node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast))) declarations.push(`const ${node.name.getText(ast)} = ${node.initializer.getText(ast)};`);
  ts.forEachChild(node, walk);
}
walk(ast); assert.equal(declarations.length, names.size);
const policyRuntime = vm.runInNewContext(`${declarations.join("\n")}\n({loadPolicy, resolveActivityReward});`, {
  resolveRankPolicy: value => value || {}, DEFAULT_POINT_RANK_TIERS: [], db: { doc: path => ({ path }) },
  getPointPolicyPath: (year, term) => `years/${year}/semesters/${term}/point_policies/current`,
});
const rewards = wis.createAssessmentWisRewardAdapter({
  loadPolicy: (transaction, scope) => policyRuntime.loadPolicy({ get: async ref => {
    const row = await transaction.get(ref.path); return { exists: row.exists, data: () => row.data };
  } }, ...scope.split("-")), resolveActivityReward: policyRuntime.resolveActivityReward,
});
class Store {
  constructor(seed) { this.documents = new Map(Object.entries(clone(seed))); this.queue = Promise.resolve(); this.failCreate = ""; }
  snapshot(path, docs = this.documents) { return { path, exists: docs.has(path), data: docs.has(path) ? clone(docs.get(path)) : null }; }
  async get(path) { return this.snapshot(path); }
  async runTransaction(run) {
    const previous = this.queue; let release; this.queue = new Promise(resolve => { release = resolve; }); await previous;
    const docs = new Map(this.documents); let writes = false;
    const read = path => { assert(!writes, "Firestore read after first write"); return this.snapshot(path, docs); };
    const tx = {
      get: async path => read(path), getAll: async paths => paths.map(read),
      query: async (collection, filter = {}) => {
        assert(!writes, "Firestore query after first write");
        const clauses = filter.filters || (filter.field ? [filter] : []);
        let rows = [...docs.keys()].filter(path => path.startsWith(collection + "/") && !path.slice(collection.length + 1).includes("/"))
          .map(path => read(path)).filter(row => clauses.every(c => row.data[c.field] === c.value));
        if (filter.limit) rows = rows.slice(0, filter.limit); return rows;
      },
      create: (path, value) => { writes = true; if (path === this.failCreate) throw Error("injected write abort"); assert(!docs.has(path)); docs.set(path, clone(value)); },
      set: (path, value, options) => { writes = true; docs.set(path, options?.merge ? { ...docs.get(path), ...clone(value) } : clone(value)); },
      delete: path => { writes = true; docs.delete(path); },
    };
    try { const result = await run(tx); this.documents = docs; return result; } finally { release(); }
  }
}
const scope = "2026-2", uid = "student-one", accountId = wis.accountIdFor(scope, uid);
const slotPath = `semester_enrollment_slots/${archive.buildEnrollmentSlotId(scope, uid)}`;
const accountPath = `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`, economyPath = `${wis.WIS_ECONOMY_COLLECTION}/${scope}`;
const policyPath = "years/2026/semesters/2/point_policies/current";
const seed = () => ({
  "site_settings/config": { year: scope.split("-")[0], semester: scope.split("-")[1], activeSemesterId: scope },
  "site_settings/semester_active": { semesterId: scope, revision: 7 },
  [`semester_manifests/${scope}`]: { semesterId: scope, status: "ACTIVE", revision: 7 },
  [`users/${uid}`]: { role: "student", registrationApprovalStatus: "APPROVED" },
  [`student_identities/${uid}`]: { studentUid: uid, accountStatus: "ACTIVE" },
  [slotPath]: { semesterId: scope, studentUid: uid, activeEnrollmentId: "enrollment-one", status: "ACTIVE" },
  "semester_enrollments/enrollment-one": { enrollmentId: "enrollment-one", studentUid: uid, semesterId: scope, enrollmentStatus: "ACTIVE", classId: "class_one" },
  "semester_classes/class_one": { classId: "class_one", semesterId: scope, status: "ACTIVE" },
  [economyPath]: { semesterId: scope, status: "ACTIVE_OPEN", revision: 2, ledgerEntryCount: 0 },
  [accountPath]: { schemaVersion: 1, policyVersion: wis.WIS_POLICY_VERSION, accountId, studentUid: uid, semesterId: scope,
    enrollmentId: "enrollment-one", classId: "class_one", status: "ACTIVE", revision: 1, displayName: "합성학생", grade: "2", classNumber: "1",
    balance: 0, earnedTotal: 0, rankEarnedTotal: 0, adjustedTotal: 0, spentTotal: 0, recentLedgerEntries: [] },
});
let sequence = 0;
const newCommandId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const attemptFor = (kind = "QUIZ", key = "one") => ({
  attemptId: `attempt_${hash(kind + key)}`, definitionId: "definition-one", semesterId: scope, assessmentKind: kind,
  studentUid: uid, enrollmentId: "enrollment-one", classId: "class_one", revision: 1, status: "STARTED",
  gradingSnapshot: [{ id: "one", answer: "a" }, { id: "two", answer: "b" }], sourceHash: hash("source"),
  deadlineAtIso: "2026-09-12T01:00:00.000Z", startedAtIso: "2026-09-12T00:00:00.000Z",
});
function harness() {
  const store = new Store(seed()); let nowMs = Date.parse("2026-09-12T00:10:00.000Z");
  const timestamp = () => ({ seconds: Math.floor(nowMs / 1000), nanoseconds: 0 });
  const adapter = assessment.createAssessmentCommandAdapter({ now: () => new Date(nowMs), wisRewards: rewards });
  const core = gateway.createCommandGatewayCore({ store, projectId: "demo-assessment-wis", serverTimestamp: timestamp, concreteTimestamp: timestamp,
    assertSession: async request => ({ uid: request.auth.uid, email: "student@example.test", sessionId: "session-one", schemaVersion: 2, revision: 1, expiresAtMs: nowMs + 3600000 }),
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorRole: request.auth.uid === "teacher-one" ? "teacher" : "student", actorCapability: "test" }),
    commandAdapters: { submitAssessmentAttempt: adapter }, getSessionOptions: () => ({ recentAuth: false, highRisk: false }) });
  const add = (kind, key) => { const attempt = attemptFor(kind, key); store.documents.set(`semester_assessment_attempts/${attempt.attemptId}`, attempt); return attempt; };
  const submit = (attempt, answers = { one: "a", two: "b" }, id = newCommandId(), submitReason = "STUDENT", actorUid = uid) =>
    core.execute({ auth: { uid: actorUid, token: { email: "student@example.test" } }, data: { commandId: id, commandType: "submitAssessmentAttempt",
      payload: { attemptId: attempt.attemptId, expectedRevision: attempt.revision, answers, submitReason } } });
  return { store, core, adapter, add, submit, setNow: value => { nowMs = value; }, now: () => nowMs, timestamp,
    account: () => store.documents.get(accountPath), ledgers: () => [...store.documents].filter(([path]) => path.startsWith(wis.WIS_LEDGER_COLLECTION + "/")).map(([, value]) => value) };
}
let count = 0;
async function test(name, run) { await run(); console.log("PASS " + name); count++; }
async function rejectsNoWrites(h, run, reason) {
  const before = JSON.stringify([...h.store.documents]);
  await assert.rejects(run, error => !reason || error.details?.reason === reason, reason);
  assert.equal(JSON.stringify([...h.store.documents]), before, "no partial result/reward/receipt");
}
(async () => {
  for (const kind of ["QUIZ", "HISTORY_CLASSROOM"]) {
    for (const reason of ["STUDENT", "TIMEOUT"]) await test(kind + " " + reason + " zero score retains legacy base policy", async () => {
      const h = harness(), attempt = h.add(kind); if (reason === "TIMEOUT") h.setNow(Date.parse(attempt.deadlineAtIso) + 1);
      const result = (await h.submit(attempt, {}, undefined, reason)).result;
      assert.equal(result.percent, 0); assert.equal(result.reward.totalAwarded, kind === "QUIZ" ? 10 : 50);
      assert.equal(h.account().adjustedTotal, 0); assert.equal(h.account().earnedTotal, result.reward.totalAwarded);
    });
    await test(kind + " percent threshold gives separate immutable base and bonus", async () => {
      const h = harness(), attempt = h.add(kind);
      h.store.documents.set(policyPath, { quizBonusEnabled: true, quizBonusThreshold: 100, quizBonusAmount: 7,
        historyClassroomBonusEnabled: true, historyClassroomBonusThreshold: 100, historyClassroomBonusAmount: 9 });
      const result = (await h.submit(attempt)).result;
      assert.equal(result.score, 2); assert.equal(result.percent, 100); assert.equal(result.reward.bonusAmount, kind === "QUIZ" ? 7 : 9);
      assert.equal(h.ledgers().length, 2); assert.equal(h.store.documents.get(economyPath).ledgerEntryCount, 2);
      assert.equal(h.store.documents.get(result.resultRef).reward.totalAwarded, result.reward.totalAwarded);
      for (const projection of [wis.WIS_BALANCE_COLLECTION, wis.WIS_RANKING_COLLECTION])
        assert.equal(h.store.documents.get(`${projection}/${accountId}`).balance, h.account().balance);
    });
  }
  await test("same command and different command replay never reprice or post again", async () => {
    const h = harness(), attempt = h.add(), command = newCommandId();
    const first = await h.submit(attempt, undefined, command);
    h.store.documents.set(policyPath, { quizSolve: 900 });
    const receiptReplay = await h.submit(attempt, undefined, command);
    const resultReplay = await h.submit(attempt);
    assert(receiptReplay.replayed); assert(resultReplay.result.replayedSubmission);
    assert.equal(receiptReplay.result.reward.totalAwarded, first.result.reward.totalAwarded);
    assert.equal(resultReplay.result.reward.totalAwarded, 10); assert.equal(h.ledgers().length, 1); assert.equal(h.account().balance, 10);
  });
  await test("old immutable result with no reward is never retroactively rewarded", async () => {
    const h = harness(), attempt = h.add(); const submitted = (await h.submit(attempt)).result;
    delete h.store.documents.get(submitted.resultRef).reward;
    const result = (await h.submit(attempt)).result;
    assert.equal(result.reward.status, "NOT_RECORDED"); assert.equal(h.ledgers().length, 1);
  });
  await test("concurrent same attempt writes result and reward once", async () => {
    const h = harness(), attempt = h.add(); const results = await Promise.all([h.submit(attempt), h.submit(attempt)]);
    assert.equal(results.filter(row => row.result.replayedSubmission).length, 1); assert.equal(h.account().balance, 10);
  });
  await test("partial or orphan source ledger cannot be supplemented by a new submit", async () => {
    const h = harness(), attempt = h.add(); h.store.documents.set(policyPath, { quizBonusEnabled: true, quizBonusAmount: 7 });
    const source = `assessment:${attempt.attemptId}:quiz`;
    const id = `wisled_${hash([scope, accountId, "GRANT", source].join("\n"))}`;
    h.store.documents.set(`${wis.WIS_LEDGER_COLLECTION}/${id}`, { sourceId: source });
    await rejectsNoWrites(h, () => h.submit(attempt), "ASSESSMENT_WIS_SOURCE_ALREADY_POSTED");
  });
  await test("wrong ownership on an immutable replay cannot disclose its reward", async () => {
    const h = harness(), attempt = h.add(); const submitted = (await h.submit(attempt)).result;
    h.store.documents.get(submitted.resultRef).studentUid = "other";
    await rejectsNoWrites(h, () => h.submit(attempt), "ASSESSMENT_RESULT_INVALID");
  });
  await test("quiz has no added global cooldown while history spans different results", async () => {
    const h = harness(); await h.submit(h.add("QUIZ", "q1")); await h.submit(h.add("QUIZ", "q2"));
    await h.submit(h.add("HISTORY_CLASSROOM", "h1"));
    const blocked = (await h.submit(h.add("HISTORY_CLASSROOM", "h2"))).result;
    assert.equal(blocked.reward.blockedReason, "cooldown_active"); assert.equal(h.account().balance, 70);
  });
  await test("history legacy source cooldown expires exactly at policy boundary", async () => {
    const h = harness(); const timestamp = h.timestamp();
    h.store.documents.set("years/2026/semesters/2/point_transactions/legacy", { uid, type: "history_classroom", delta: 50, createdAt: timestamp });
    const denied = (await h.submit(h.add("HISTORY_CLASSROOM", "h1"))).result;
    assert.equal(denied.reward.status, "NOT_ELIGIBLE"); assert.equal(h.ledgers().length, 0);
    h.setNow(h.now() + 24 * 3600000);
    const approved = (await h.submit(h.add("HISTORY_CLASSROOM", "h2"), undefined, undefined, "TIMEOUT")).result;
    assert.equal(approved.reward.totalAwarded, 50);
  });
  await test("disabled automatic policy is normal submission without financial writes", async () => {
    const h = harness(); h.store.documents.set(policyPath, { rewardPolicy: { autoEnabled: false }, quizBonusEnabled: true, quizBonusAmount: 99 });
    const result = (await h.submit(h.add())).result;
    assert.equal(result.reward.status, "DISABLED"); assert.equal(h.ledgers().length, 0); assert.equal(h.account().revision, 1);
  });
  const negatives = [
    ["migration enabled", docs => docs.set(`wis_legacy_migration_controls/${scope}`, { enabled: true }), "WIS_MIGRATION_WRITES_BLOCKED"],
    ["migration blocked", docs => docs.set(`wis_legacy_migration_controls/${scope}`, { writesBlocked: true }), "WIS_MIGRATION_WRITES_BLOCKED"],
    ["closed semester", docs => docs.get(`semester_manifests/${scope}`).status = "CLOSED", "ASSESSMENT_SEMESTER_NOT_ACTIVE"],
    ["read only semester", docs => docs.get(`semester_manifests/${scope}`).readOnly = true, "ASSESSMENT_WIS_SEMESTER_INACTIVE"],
    ["stale pointer", docs => docs.get("site_settings/semester_active").revision = 6, "ASSESSMENT_SEMESTER_NOT_ACTIVE"],
    ["closed economy", docs => docs.get(economyPath).status = "CLOSED", "ASSESSMENT_WIS_ECONOMY_CLOSED"],
    ["missing account", docs => docs.delete(accountPath), "ASSESSMENT_WIS_ACCOUNT_INVALID"],
    ["wrong owner account", docs => docs.get(accountPath).studentUid = "other", "ASSESSMENT_WIS_ACCOUNT_INVALID"],
    ["frozen account", docs => docs.get(accountPath).readOnly = true, "ASSESSMENT_WIS_ACCOUNT_INVALID"],
    ["pending approval", docs => docs.get(`users/${uid}`).registrationApprovalStatus = "PENDING", "ASSESSMENT_WIS_STUDENT_INACTIVE"],
    ["closed identity", docs => docs.get(`student_identities/${uid}`).accountStatus = "INACTIVE", "ASSESSMENT_WIS_STUDENT_INACTIVE"],
    ["archived slot", docs => docs.get(slotPath).status = "ARCHIVED", "ASSESSMENT_WIS_ENROLLMENT_INVALID"],
    ["moved enrollment", docs => docs.get("semester_enrollments/enrollment-one").classId = "class_other", "ASSESSMENT_WIS_ENROLLMENT_CHANGED"],
    ["inactive class", docs => docs.get("semester_classes/class_one").status = "INACTIVE", "ASSESSMENT_WIS_CLASS_INACTIVE"],
    ["unsafe amount", docs => docs.set(policyPath, { quizSolve: Number.MAX_SAFE_INTEGER + 1 }), "ASSESSMENT_WIS_POLICY_INVALID"],
    ["fractional amount", docs => docs.set(policyPath, { quizSolve: 0.5 }), "ASSESSMENT_WIS_POLICY_INVALID"],
    ["overflow total", docs => docs.get(accountPath).earnedTotal = Number.MAX_SAFE_INTEGER, "ASSESSMENT_WIS_AMOUNT_OVERFLOW"],
  ];
  for (const [name, change, reason] of negatives) await test(name + " aborts whole submit", async () => {
    const h = harness(), attempt = h.add(); change(h.store.documents); await rejectsNoWrites(h, () => h.submit(attempt), reason);
  });
  await test("history scan limit does not ignore later claims", async () => {
    const h = harness(), attempt = h.add("HISTORY_CLASSROOM");
    for (let i = 0; i < 1001; i++) h.store.documents.set(`years/2026/semesters/2/point_transactions/${i}`, { uid, type: "history_classroom", createdAt: h.timestamp() });
    await rejectsNoWrites(h, () => h.submit(attempt), "ASSESSMENT_WIS_HISTORY_LIMIT_EXCEEDED");
  });
  await test("foreign actor, teacher actor and stale attempt revision cannot award", async () => {
    for (const actor of ["other", "teacher-one"]) { const h = harness(), attempt = h.add(); await rejectsNoWrites(h, () => h.submit(attempt, undefined, undefined, undefined, actor)); }
    const h = harness(), attempt = h.add(); await rejectsNoWrites(h, () => h.submit({ ...attempt, revision: 2 }), "ASSESSMENT_ATTEMPT_REVISION_CONFLICT");
  });
  await test("write failure after staged result aborts every financial and business write", async () => {
    const h = harness(), attempt = h.add(); h.store.failCreate = `semester_assessment_results/${attempt.attemptId}`;
    await rejectsNoWrites(h, () => h.submit(attempt));
  });
  await test("rebuild preserves automatic totals and manual reversal remains forbidden", async () => {
    const h = harness(); await h.submit(h.add()); const rewardLedger = h.ledgers()[0];
    const adapter = wis.createWisCommandAdapter();
    const run = (type, extra) => h.store.runTransaction(transaction => adapter.apply({ transaction, commandType: type, commandId: newCommandId(), receiptId: "receipt-teacher",
      timestamp: h.timestamp(), concreteTimestamp: h.timestamp(), actor: { actorUid: "teacher-one", actorRole: "teacher" },
      payload: { semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: h.store.documents.get(economyPath).revision,
        expectedAccountRevision: h.account().revision, accountId, reason: "검증", ...extra } }));
    await run("rebuildWisProjection", {}); assert.equal(h.account().adjustedTotal, 0); assert.equal(h.account().rankEarnedTotal, 10);
    await rejectsNoWrites(h, () => run("reverseWisEntry", { ledgerEntryId: rewardLedger.ledgerEntryId }), "WIS_REVERSAL_INVALID");
    assert.equal(h.account().balance, 10); assert.equal(h.account().adjustedTotal, 0); assert.equal(h.account().earnedTotal, 10);
  });
  await test("student cannot replace the internal reward with a manual grant", async () => {
    const h = harness(); const adapter = wis.createWisCommandAdapter();
    await rejectsNoWrites(h, () => h.store.runTransaction(transaction => adapter.apply({ transaction, commandType: "grantWis", commandId: newCommandId(), receiptId: "receipt-student",
      timestamp: h.timestamp(), concreteTimestamp: h.timestamp(), actor: { actorUid: uid, actorRole: "student" },
      payload: { semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: 2, expectedAccountRevision: 1, accountId, amount: 999, sourceId: "fake", reason: "fake" } })), "WIS_MANAGE_REQUIRED");
  });
  await test("student ledger projection preserves safe automatic activity labels", () => {
    const wisSource = fs.readFileSync(require.resolve("../wisEconomy"), "utf8");
    const wisAst = ts.createSourceFile("wisEconomy.js", wisSource, ts.ScriptTarget.Latest, true);
    let projection, activities;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(wisAst) === "projectStudentLedgerEntry") projection = node.initializer.getText(wisAst);
      if (ts.isVariableDeclaration(node) && node.name.getText(wisAst) === "AUTOMATIC_REWARD_ACTIVITIES") activities = node.initializer.getText(wisAst);
      ts.forEachChild(node, visit);
    }
    visit(wisAst); const project = vm.runInNewContext(`const AUTOMATIC_REWARD_ACTIVITIES = ${activities}; (${projection})`);
    for (const activityType of ["quiz", "quiz_bonus", "history_classroom", "history_classroom_bonus", "map_tag"]) {
      const value = project({ type: "GRANT", activityType, sourceId: "assessment:private", sourceResultId: "private", actorUid: "system:assessment-reward" });
      assert.equal(value.activityType, activityType); assert(!Object.hasOwn(value, "sourceId")); assert(!Object.hasOwn(value, "sourceResultId")); assert(!Object.hasOwn(value, "actorUid"));
    }
    assert(!Object.hasOwn(project({ activityType: "unknown" }), "activityType"));
  });
  console.log(`PASS assessment/Wis production-policy integration: ${count} scenarios; network/Production 0`);
})().catch(error => { console.error(error); process.exitCode = 1; });
