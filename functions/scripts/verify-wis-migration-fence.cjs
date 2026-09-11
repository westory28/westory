const assert = require("node:assert/strict");
const fence = require("../wisMigrationFence");
const migration = require("../wisLegacyMigration");
const uid = "migration-fence-student", scope = "2026-2", paths = migration.pathsFor(scope, uid);
const financial = `${paths.transactions}/original`, profile = `users/${uid}`;
const records = new Map([[financial, { uid, delta: 150 }], [profile, { uid }]]);
const db = { doc: path => ({ path }) };
const reads = [];
const transaction = { get: async ref => {
  reads.push(ref.path); return { ref, exists: records.has(ref.path), data: () => records.get(ref.path) };
}, getAll: async (...refs) => Promise.all(refs.map(ref => transaction.get(ref))) };
(async () => {
  for (const field of ["enabled", "writesBlocked"]) {
    records.set(fence.controlPath(scope), { [field]: true });
    await assert.rejects(fence.assertNativeWisWriteAllowed(db, transaction, scope), error => error.details.reason === "WIS_MIGRATION_WRITES_BLOCKED");
  }
  records.set(fence.controlPath(scope), { enabled: false, writesBlocked: false });
  await fence.assertNativeWisWriteAllowed(db, transaction, scope);
  const refs = [db.doc(financial), db.doc(profile)];
  assert.deepEqual(await fence.filterMutableLegacyRefs(db, transaction, refs), refs);
  records.set(paths.marker, { status: "MIGRATED", semesterId: scope, studentUid: uid, migrationId: paths.migrationId });
  assert.deepEqual(await fence.filterMutableLegacyRefs(db, transaction, refs), [db.doc(profile)]);
  assert.ok(reads.includes(paths.marker));
  records.set(paths.marker, { status: "MIGRATED", semesterId: "2025-1", studentUid: uid, migrationId: paths.migrationId });
  await assert.rejects(fence.filterMutableLegacyRefs(db, transaction, refs), error => error.details.reason === "WIS_MIGRATION_MARKER_INVALID");
  assert.equal(fence.legacyScopeForPath("users/test/point_transactions/no"), null);
  console.log(JSON.stringify({ passed: true, cases: 7, retainedMigratedFinancialAudit: true, unrelatedProfileStillMutable: true, productionAccess: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
