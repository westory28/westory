const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Timestamp } = require("@google-cloud/firestore");
const repair = require("./repair-history-classroom-created-metadata.cjs");

const copy = value => value instanceof Timestamp ? new Timestamp(value.seconds, value.nanoseconds)
  : Array.isArray(value) ? value.map(copy) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;
class MemoryDb {
  constructor(seed) {
    this.serial = 0;
    this.documents = new Map(Object.entries(seed).map(([key, data]) => [key, { data: copy(data), updateTime: new Timestamp(++this.serial, 123) }]));
    this.writes = [];
  }
  snapshot(item) {
    const current = this.documents.get(item);
    return { ref: this.doc(item), exists: !!current, updateTime: current?.updateTime, data: () => current ? copy(current.data) : undefined };
  }
  doc(item) { return { path: item, get: async () => this.snapshot(item) }; }
  async getAll(...refs) { return refs.map(ref => this.snapshot(ref.path)); }
  collection(item) {
    const query = { where: (field, operator, value) => {
      assert.equal(field, "target.id"); assert.equal(operator, "==");
      query.assignmentId = value; return query;
    }, limit: size => { query.size = size; return query; }, get: async () => {
      const docs = [...this.documents].filter(([key, row]) => key.startsWith(`${item}/`) && row.data.target?.id === query.assignmentId)
        .slice(0, query.size).map(([key]) => this.snapshot(key));
      return { size: docs.length, docs };
    } };
    return query;
  }
  replace(item, mutate) {
    const current = this.documents.get(item);
    const next = copy(current.data);
    mutate(next);
    this.documents.set(item, { data: next, updateTime: new Timestamp(++this.serial, 123) });
  }
  async runTransaction(callback) {
    this.beforeTransaction?.();
    const writes = [];
    const result = await callback({ getAll: (...refs) => this.getAll(...refs), update: (ref, patch, precondition) => {
      assert.equal(precondition.lastUpdateTime.toMillis(), this.documents.get(ref.path).updateTime.toMillis());
      writes.push({ path: ref.path, patch: copy(patch) });
    } });
    for (const write of writes) {
      this.replace(write.path, data => Object.assign(data, write.patch));
      this.writes.push(write);
    }
    return result;
  }
}
const semesterId = "2026-2", sourcePath = id => `years/2026/semesters/2/history_classrooms/${id}`;
const definitionPath = id => `semester_assessment_definitions/history_classroom:2026-2:${id}`;
const origin = new Timestamp(1792623949, 982000000);
const source = { contentRevision: 3, deletedAt: null, isPublished: false, publishedAt: null, updatedAt: new Timestamp(1792624120, 0),
  targetStudentReasons: { "synthetic-student": "직접 작성 사유" }, targetStudentUids: ["synthetic-student"], blanks: [{ id: "1", answer: "고려" }] };
const definition = id => ({ definitionId: `history_classroom:2026-2:${id}`, semesterId, assessmentKind: "HISTORY_CLASSROOM", sourceId: id,
  status: "PAUSED", revision: 2, createdAt: origin, createdBy: "original-teacher" });
const seedFor = () => ({
  "site_settings/semester_active": { semesterId, revision: 7 },
  "semester_manifests/2026-2": { semesterId, status: "ACTIVE", revision: 7 },
  [sourcePath("missing")]: source,
  [definitionPath("missing")]: definition("missing"),
  "command_audit_events/creation": { eventType: "COMMAND_SUCCEEDED", commandType: "saveHistoryClassroomAssignment", actorUid: "original-teacher",
    target: { kind: "history-classroom-source", id: "missing" }, result: { sourceId: "missing", contentRevision: 1 }, createdAt: origin },
  [sourcePath("legacy")]: { ...source, createdBy: "earlier-teacher" },
  [definitionPath("legacy")]: definition("legacy"),
  [sourcePath("deleted")]: { ...source, deletedAt: new Timestamp(1792624500, 0) },
  [definitionPath("deleted")]: definition("deleted"),
  [sourcePath("complete")]: { ...source, createdAt: origin, createdBy: "original-teacher" },
  [definitionPath("complete")]: definition("complete"),
  "semester_assessment_results/protected": { score: 100, studentUid: "synthetic-student" },
  "notification_inboxes/protected": { unreadCount: 1 },
});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "westory-created-metadata-test-"));
const optionsFor = ids => ({ project: "demo-westory-session-history-metadata", semesterId, assignmentIds: ids.sort(),
  plan: path.join(temporary, "plan.json"), backup: path.join(temporary, "backup.json") });
const applyOptions = (options, plan) => ({ ...options, apply: true, expectPlanHash: plan.planHash });

(async () => {
  try {
    const parsed = repair.parseArgs(["--assignment-id", "missing", "--plan", path.join(temporary, "plan.json")]);
    assert.equal(parsed.apply, false, "dry-run is the default");
    assert.throws(() => repair.parseArgs(["--assignment-id", "missing", "--plan", path.resolve(__dirname, "../bad.json")]), /outside/);
    assert.throws(() => repair.parseArgs(["--assignment-id", "../escape", "--plan", path.join(temporary, "plan.json")]), /explicit/);
    assert.throws(() => repair.parseArgs([...Array.from({ length: 21 }, (_, index) => ["--assignment-id", `item-${index}`]).flat(), "--plan", path.join(temporary, "plan.json")]), /explicit/);
    assert.throws(() => repair.parseArgs(["--assignment-id", "missing", "--plan", path.join(temporary, "plan.json"), "--apply", "--backup", path.join(temporary, "backup.json")]), /hash/);

    const db = new MemoryDb(seedFor()), options = optionsFor(["missing", "legacy", "deleted", "complete", "absent"]);
    const before = new Map([...db.documents].map(([item, row]) => [item, copy(row.data)]));
    const plan = await repair.createPlan({ db, options });
    assert.equal(db.writes.length, 0);
    assert.equal(plan.rows.find(row => row.assignmentId === "missing").evidence.kind, "definition-and-revision-one-audit");
    assert.equal(plan.rows.find(row => row.assignmentId === "legacy").evidence.kind, "definition");
    assert.deepEqual(Object.keys(plan.rows.find(row => row.assignmentId === "legacy").patch), ["createdAt"]);
    assert.equal(plan.rows.find(row => row.assignmentId === "deleted").status, "deleted-source");
    assert.equal(plan.rows.find(row => row.assignmentId === "complete").status, "complete");
    assert.equal(plan.rows.find(row => row.assignmentId === "absent").status, "missing-source");
    const result = await repair.applyPlan({ db, options: applyOptions(options, plan), plan });
    assert.equal(result.repaired, 2);
    assert.equal(db.writes.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(options.backup, "utf8")).planHash, plan.planHash);
    for (const [item, old] of before) {
      const current = db.snapshot(item).data();
      if ([sourcePath("missing"), sourcePath("legacy")].includes(item)) {
        const restored = { ...current };
        delete restored.createdAt;
        if (item === sourcePath("missing")) delete restored.createdBy;
        assert.deepEqual(restored, old, "only absent creation metadata changes");
      } else assert.deepEqual(current, old, "other documents remain byte-equivalent");
    }
    assert.equal(db.snapshot(sourcePath("legacy")).data().createdBy, "earlier-teacher");
    const replay = await repair.createPlan({ db, options });
    assert.equal(replay.rows.filter(row => row.status === "repair").length, 0, "fresh replay is idempotent");

    const twoStage = new MemoryDb(seedFor());
    twoStage.replace("command_audit_events/creation", data => { data.commandType = "upsertHistoryClassroomSource";
      data.createdAt = new Timestamp(origin.seconds - 4, 785000000); });
    const twoStagePlan = await repair.createPlan({ db: twoStage, options: optionsFor(["missing"]) });
    assert.equal(twoStagePlan.rows[0].evidence.kind, "revision-one-source-audit-and-later-definition");
    assert.deepEqual(twoStagePlan.rows[0].patch.createdAt, { __timestamp: [origin.seconds - 4, 785000000] }, "two-stage source restores its actual creation audit, not the later definition time");
    twoStage.replace("command_audit_events/creation", data => { data.createdAt = new Timestamp(origin.seconds + 1, 0); });
    await assert.rejects(repair.createPlan({ db: twoStage, options: optionsFor(["missing"]) }), /disagree/);

    const atomicConflict = new MemoryDb(seedFor()), atomicOptions = optionsFor(["missing", "legacy"]);
    const atomicPlan = await repair.createPlan({ db: atomicConflict, options: atomicOptions });
    atomicConflict.beforeTransaction = () => atomicConflict.replace(sourcePath("missing"), data => { data.syntheticChange = true; });
    await assert.rejects(repair.applyPlan({ db: atomicConflict, options: applyOptions(atomicOptions, atomicPlan), plan: atomicPlan, writeBackup() {} }), /compare-and-swap/);
    assert.equal(atomicConflict.writes.length, 0, "a later-row conflict aborts every repair in the transaction");

    for (const kind of ["source", "definition", "pointer", "audit", "malformed", "wrong-semester", "deleted", "audit-mismatch", "audit-bound", "hash", "backup-failure"]) {
      const fixture = new MemoryDb(seedFor()), setup = optionsFor(["missing"]);
      const reviewed = await repair.createPlan({ db: fixture, options: setup });
      let backups = 0;
      if (["source", "definition", "pointer", "audit", "deleted"].includes(kind)) {
        fixture.beforeTransaction = () => {
          const item = { source: sourcePath("missing"), definition: definitionPath("missing"), pointer: "site_settings/semester_active", audit: "command_audit_events/creation", deleted: sourcePath("missing") }[kind];
          fixture.replace(item, data => { if (kind === "deleted") data.deletedAt = origin; else data.syntheticChange = true; });
        };
      }
      if (kind === "malformed") fixture.replace(sourcePath("missing"), data => { data.createdAt = "not-a-timestamp"; });
      if (kind === "wrong-semester") fixture.replace("site_settings/semester_active", data => { data.semesterId = "2027-1"; });
      if (kind === "audit-mismatch") fixture.replace("command_audit_events/creation", data => { data.actorUid = "another-teacher"; });
      if (kind === "audit-bound") for (let index = 0; index < 101; index++) fixture.documents.set(`command_audit_events/extra-${index}`, {
        data: { target: { id: "missing" } }, updateTime: origin,
      });
      if (kind === "hash") reviewed.rows[0].patch.createdBy = "tampered-teacher";
      await assert.rejects(repair.applyPlan({ db: fixture, options: applyOptions(setup, reviewed), plan: reviewed,
        writeBackup: () => { backups++; if (kind === "backup-failure") throw new Error("disk unavailable"); } }), undefined, kind);
      assert.equal(fixture.writes.length, 0, `${kind}: reject without any committed writes`);
      if (["malformed", "wrong-semester", "audit-mismatch", "audit-bound", "hash"].includes(kind)) assert.equal(backups, 0);
    }
    const bounded = new MemoryDb(seedFor());
    bounded.replace("semester_manifests/2026-2", data => { data.readOnly = true; });
    await assert.rejects(repair.createPlan({ db: bounded, options: optionsFor(["missing"]) }), /writable/);
    console.log("History Classroom creation metadata repair: dry-run, provenance, narrow writes, atomic CAS, tamper, backup, bounds, deletion, archive, and replay checks passed.");
  } finally {
    const resolved = fs.realpathSync(temporary);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith("westory-created-metadata-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(failure => { console.error(failure); process.exitCode = 1; });
