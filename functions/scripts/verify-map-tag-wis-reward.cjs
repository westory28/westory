const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");
const wis = require("../wisEconomy");
const gateway = require("../commandGateway");
const archive = require("../archiveEnrollment");
const mapReward = require("../mapTagWisReward");
const indexSource = fs.readFileSync(require.resolve("../index.js"), "utf8");
const ast = ts.createSourceFile("index.js", indexSource, ts.ScriptTarget.Latest, true);
const names = new Set(["toFiniteNumber", "toNonNegativeNumber", "toPositiveThreshold", "toPositiveInteger",
  "resolveAutoRewardEnabled", "resolveQuizBonusInput", "getDefaultPointPolicy", "normalizePointPolicy", "loadPolicy"]);
const declarations = [];
function walk(node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast)))
    declarations.push("const " + node.name.getText(ast) + " = " + node.initializer.getText(ast) + ";");
  ts.forEachChild(node, walk);
}
walk(ast); assert.equal(declarations.length, names.size);
const policyRuntime = vm.runInNewContext(declarations.join("\n") + "\n({loadPolicy});", {
  resolveRankPolicy: value => value || {}, DEFAULT_POINT_RANK_TIERS: [], db: { doc: path => ({ path }) },
  getPointPolicyPath: (year, term) => "years/" + year + "/semesters/" + term + "/point_policies/current",
});
const clone = value => structuredClone(value);
const assertFirestoreValue = (value, path = "document") => {
  assert.notEqual(value, undefined, "Undefined Firestore value: " + path);
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) assertFirestoreValue(child, path + "." + key);
};
class Store {
  constructor(seed) { this.documents = new Map(Object.entries(clone(seed))); this.queue = Promise.resolve(); this.failCreate = ""; }
  snapshot(path, docs = this.documents) { return { path, exists: docs.has(path), data: docs.has(path) ? clone(docs.get(path)) : null }; }
  async get(path) { return this.snapshot(path); }
  async runTransaction(run) {
    const previous = this.queue; let release; this.queue = new Promise(resolve => { release = resolve; }); await previous;
    const docs = new Map(this.documents); let writes = false;
    const read = path => { assert(!writes, "Firestore read after write"); return this.snapshot(path, docs); };
    const transaction = {
      get: async path => read(path), getAll: async paths => paths.map(read),
      query: async (collection, filter = {}) => {
        assert(!writes, "Firestore query after write"); const clauses = filter.filters || [];
        return [...docs.keys()].filter(path => path.startsWith(collection + "/") && !path.slice(collection.length + 1).includes("/"))
          .map(read).filter(row => clauses.every(c => row.data[c.field] === c.value)).slice(0, filter.limit || Infinity);
      },
      create: (path, value) => { assertFirestoreValue(value, path); writes = true; if (path === this.failCreate) throw Error("injected atomic abort"); assert(!docs.has(path)); docs.set(path, clone(value)); },
      set: (path, value, options) => { assertFirestoreValue(value, path); writes = true; docs.set(path, options?.merge ? { ...docs.get(path), ...clone(value) } : clone(value)); },
      delete: path => { writes = true; docs.delete(path); },
    };
    try { const result = await run(transaction); this.documents = docs; return result; } finally { release(); }
  }
}
const scope = "2026-2", uid = "student-one", accountId = wis.accountIdFor(scope, uid);
const accountPath = wis.WIS_ACCOUNT_COLLECTION + "/" + accountId, economyPath = wis.WIS_ECONOMY_COLLECTION + "/" + scope;
const mapPath = "years/2026/semesters/2/map_resources/map_one", policyPath = "years/2026/semesters/2/point_policies/current";
const slotPath = "semester_enrollment_slots/" + archive.buildEnrollmentSlotId(scope, uid);
function harness() {
  let nowMs = Date.parse("2026-09-12T00:00:00Z");
  const store = new Store({
    "site_settings/semester_active": { semesterId: scope, revision: 7 },
    "semester_manifests/2026-2": { semesterId: scope, status: "ACTIVE", revision: 7 },
    ["users/" + uid]: { role: "student", registrationApprovalStatus: "APPROVED" },
    ["student_identities/" + uid]: { studentUid: uid, accountStatus: "ACTIVE" },
    [slotPath]: { semesterId: scope, studentUid: uid, activeEnrollmentId: "enrollment-one", status: "ACTIVE" },
    "semester_enrollments/enrollment-one": { enrollmentId: "enrollment-one", studentUid: uid, semesterId: scope, enrollmentStatus: "ACTIVE", classId: "class_one" },
    "semester_classes/class_one": { classId: "class_one", semesterId: scope, status: "ACTIVE" },
    [economyPath]: { semesterId: scope, status: "ACTIVE_OPEN", revision: 2, ledgerEntryCount: 0 },
    [accountPath]: { schemaVersion: 1, policyVersion: wis.WIS_POLICY_VERSION, accountId, studentUid: uid, semesterId: scope,
      enrollmentId: "enrollment-one", classId: "class_one", status: "ACTIVE", revision: 1, displayName: "합성학생",
      balance: 0, earnedTotal: 0, rankEarnedTotal: 0, adjustedTotal: 3, spentTotal: 2, recentLedgerEntries: [] },
    [mapPath]: { title: "검증 지도", pdfTagSections: [{ tags: ["고구려", "백제"] }] },
  });
  const timestamp = () => ({ seconds: Math.floor(nowMs / 1000), nanoseconds: 0 });
  const adapter = wis.createMapTagWisRewardAdapter({ loadPolicy: (transaction, scope) => policyRuntime.loadPolicy({
    get: async ref => { const row = await transaction.get(ref.path); return { exists: row.exists, data: () => row.data }; },
  }, ...scope.split("-")) });
  const core = gateway.createCommandGatewayCore({ store, projectId: "demo-map-wis", serverTimestamp: timestamp, concreteTimestamp: timestamp,
    assertSession: async request => ({ uid: request.auth.uid, email: "student@example.test", sessionId: "session-one", schemaVersion: 2, revision: 1, expiresAtMs: nowMs + 3600000 }),
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: "student@example.test", actorRole: request.auth.uid === "teacher-one" ? "teacher" : "student", actorCapability: "test" }),
    commandAdapters: { claimMapTagReward: adapter } });
  const payload = () => ({ semesterId: scope, mapId: "map_one", tag: "고구려", interactionId: randomUUID() });
  const claim = (data = payload(), commandId = randomUUID(), actorUid = uid) =>
    core.execute({ auth: { uid: actorUid, token: {} }, data: { commandType: mapReward.COMMAND_TYPE, commandId, payload: data } });
  const update = (path, patch) => store.documents.set(path, { ...store.documents.get(path), ...patch });
  return { store, core, claim, payload, update, setNow: ms => { nowMs = ms; }, timestamp,
    account: () => store.documents.get(accountPath),
    ledger: () => [...store.documents].filter(([path]) => path.startsWith(wis.WIS_LEDGER_COLLECTION + "/")).map(([, data]) => data) };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log("PASS " + name); }
async function rejected(h, fn) { const before = JSON.stringify([...h.store.documents]); await assert.rejects(fn); assert.equal(JSON.stringify([...h.store.documents]), before); }
(async () => {
  await test("policy default gives 10 Wis and keeps adjusted/spent totals", async () => {
    const h = harness(), response = await h.claim(); assert.equal(response.result.totalAwarded, 10); assert.equal(h.ledger().length, 1);
    assert.equal(h.account().balance, 10); assert.equal(h.account().earnedTotal, 10); assert.equal(h.account().rankEarnedTotal, 10);
    assert.equal(h.account().adjustedTotal, 3); assert.equal(h.account().spentTotal, 2);
    for (const collection of [wis.WIS_BALANCE_COLLECTION, wis.WIS_RANKING_COLLECTION])
      assert.equal(h.store.documents.get(collection + "/" + accountId).balance, 10);
    assert.equal(h.store.documents.get(economyPath).ledgerEntryCount, 1);
    assert.equal(h.ledger()[0].activityType, "map_tag");
    const receipts = [...h.store.documents].filter(([path]) => path.startsWith("command_receipts/"));
    assert.equal(receipts.length, 1); assert.match(receipts[0][1].sourceHash, /^[a-f0-9]{64}$/);
  });
  await test("receipt replay and same interaction with new command never repay", async () => {
    const h = harness(), payload = h.payload(), command = randomUUID(); await h.claim(payload, command);
    const before = JSON.stringify([...h.store.documents]); assert((await h.claim(payload, command)).replayed);
    assert.equal(JSON.stringify([...h.store.documents]), before);
    h.update(policyPath, { mapTagAmount: 999 }); assert.equal((await h.claim(payload)).result.totalAwarded, 0);
    assert.equal(h.account().balance, 10);
    await rejected(h, () => h.claim({ ...payload, tag: "백제" }, command));
  });
  await test("two concurrent interactions give only one payment", async () => {
    const h = harness(); const results = await Promise.all([h.claim(), h.claim()]);
    assert.equal(results.filter(r => r.result.awarded).length, 1); assert.equal(h.ledger().length, 1);
  });
  await test("24-hour cooldown then five lifetime claims", async () => {
    const h = harness(); for (let i = 0; i < 5; i++) { h.setNow(Date.parse("2026-09-12T00:00:00Z") + i * 86400000); assert((await h.claim()).result.awarded); }
    h.setNow(Date.parse("2026-09-20T00:00:00Z")); assert.equal((await h.claim()).result.blockedReason, "max_claims_reached");
    assert.equal(h.account().balance, 50);
  });
  await test("legacy scoped claims enforce cooldown and cap", async () => {
    const h = harness(); const root = "years/2026/semesters/2/point_transactions/";
    h.store.documents.set(root + "old", { uid, type: "map_tag", sourceId: "old", createdAt: h.timestamp() });
    assert.equal((await h.claim()).result.blockedReason, "cooldown_active");
    for (let i = 0; i < 4; i++) h.store.documents.set(root + i, { uid, type: "map_tag", createdAt: h.timestamp() });
    assert.equal((await h.claim()).result.blockedReason, "max_claims_reached"); assert.equal(h.ledger().length, 0);
  });
  for (const policy of [{ autoRewardEnabled: false }, { mapTagEnabled: false }, { mapTagAmount: 0 }]) await test("disabled policy " + JSON.stringify(policy), async () => {
    const h = harness(); h.update(policyPath, policy); assert.equal((await h.claim()).result.status, "DISABLED"); assert.equal(h.ledger().length, 0);
  });
  await test("configured policy keeps amount and cooldown", async () => {
    const h = harness(); h.update(policyPath, { mapTagAmount: 7, rewardPolicy: { mapTag: { cooldownHours: 2 } } });
    assert.equal((await h.claim()).result.amount, 7); h.setNow(Date.parse("2026-09-12T02:00:00Z")); assert.equal((await h.claim()).result.amount, 7);
  });
  await test("legacy resource fallback only if scoped resource absent", async () => {
    const h = harness(); h.store.documents.set("map_resources/map_one", { title: "이전 지도", pdfRegions: [{ tags: ["고구려"] }] });
    h.store.documents.delete(mapPath); assert((await h.claim()).result.awarded);
  });
  for (const [path, patch] of [
    ["users/" + uid, { registrationApprovalStatus: "PENDING" }],
    ["student_identities/" + uid, { accountStatus: "BLOCKED" }],
    ["site_settings/semester_active", { revision: 8 }],
    ["semester_manifests/2026-2", { readOnly: true }],
    [slotPath, { studentUid: "other" }],
    ["semester_enrollments/enrollment-one", { enrollmentStatus: "CLOSED" }],
    ["semester_classes/class_one", { readOnly: true }],
    [accountPath, { classId: "different" }], [accountPath, { status: "CLOSED" }],
    [economyPath, { status: "CLOSED" }], [mapPath, { isVisibleToStudents: false }],
  ]) await test("deny invalid state " + path + JSON.stringify(patch), async () => { const h = harness(); h.update(path, patch); await rejected(h, () => h.claim()); });
  for (const actor of ["teacher-one", "another-student"]) await test("deny other actor " + actor, async () => { const h = harness(); await rejected(h, () => h.claim(h.payload(), undefined, actor)); });
  for (const patch of [{ tag: "없는 태그" }, { mapId: "../map_one" }, { semesterId: "2025-1" }, { amount: 999 }, { studentUid: "other" }, { interactionId: "../bad" }])
    await test("deny forged payload " + JSON.stringify(patch), async () => { const h = harness(); await rejected(h, () => h.claim({ ...h.payload(), ...patch })); });
  await test("malformed reward timestamp fails closed", async () => {
    const h = harness(); h.store.documents.set("years/2026/semesters/2/point_transactions/bad", { uid, type: "map_tag", createdAt: null }); await rejected(h, () => h.claim());
  });
  await test("atomic write abort leaves no wallet payment or receipt", async () => {
    const h = harness(), payload = h.payload(); const source = "map-tag:map_one:" + encodeURIComponent(payload.tag) + ":" + payload.interactionId;
    const hash = require("node:crypto").createHash("sha256").update([scope, accountId, "GRANT", source].join("\n")).digest("hex");
    h.store.failCreate = wis.WIS_LEDGER_COLLECTION + "/wisled_" + hash; await rejected(h, () => h.claim(payload));
  });
  console.log("PASS map-tag Gateway/policy/ledger: " + count + " scenarios");
})().catch(error => { console.error(error); process.exitCode = 1; });
