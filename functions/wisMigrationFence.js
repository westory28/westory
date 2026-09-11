const { HttpsError } = require("firebase-functions/v2/https");
const controlPath = semesterId => {
  if (!/^\d{4}-[12]$/.test(semesterId)) throw new Error("Invalid Wis migration scope");
  return `wis_legacy_migration_controls/${semesterId}`;
};
const assertControl = data => {
  if (data?.enabled === true || data?.writesBlocked === true)
    throw new HttpsError("failed-precondition", "위스 자료를 이전하는 중입니다. 잠시 후 다시 시도해 주세요.", { reason: "WIS_MIGRATION_WRITES_BLOCKED" });
};
const assertWisWriteAllowed = async (transaction, semesterId) => {
  const snapshot = await transaction.get(controlPath(semesterId));
  assertControl(snapshot.exists ? snapshot.data : null);
};
const assertNativeWisWriteAllowed = async (db, transaction, semesterId) => {
  const snapshot = await transaction.get(db.doc(controlPath(semesterId)));
  assertControl(snapshot.exists ? snapshot.data() : null);
};
const legacyScopeForPath = path => {
  const match = /^years\/(\d{4})\/semesters\/([12])\/point_(?:wallets|transactions|orders)\//.exec(path);
  return match ? `${match[1]}-${match[2]}` : null;
};
// Migrated financial source documents are audit evidence. Student profile
// cleanup may continue, but must not mutate or erase those original snapshots.
const filterMutableLegacyRefs = async (db, transaction, refs) => {
  const financial = refs.filter(ref => legacyScopeForPath(ref.path));
  if (!financial.length) return refs;
  const snapshots = await transaction.getAll(...financial);
  const migration = require("./wisLegacyMigration");
  const retained = new Set();
  const markers = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const uid = snapshot.data()?.uid;
    if (typeof uid !== "string" || !uid || uid.includes("/")) continue;
    const scope = legacyScopeForPath(snapshot.ref.path);
    const paths = migration.pathsFor(scope, uid);
    if (!markers.has(paths.marker)) markers.set(paths.marker, await transaction.get(db.doc(paths.marker)));
    const marker = markers.get(paths.marker);
    if (marker.exists) {
      const data = marker.data();
      if (data.status !== "MIGRATED" || data.studentUid !== uid || data.semesterId !== scope || data.migrationId !== paths.migrationId)
        throw new HttpsError("failed-precondition", "이전된 위스 기록의 출처를 확인해야 합니다.", { reason: "WIS_MIGRATION_MARKER_INVALID" });
      retained.add(snapshot.ref.path);
    }
  }
  return refs.filter(ref => !retained.has(ref.path));
};
module.exports = { controlPath, assertControl, assertWisWriteAllowed, assertNativeWisWriteAllowed, legacyScopeForPath, filterMutableLegacyRefs };
