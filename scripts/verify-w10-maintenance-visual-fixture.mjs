import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const CONFIG_PATH = "site_settings/student_maintenance";
const args = process.argv.slice(2);
const value = (name) =>
  String(
    args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ||
      "",
  ).trim();
const mode = args.includes("--enable")
  ? "enable"
  : args.includes("--restore")
    ? "restore"
    : "";
const projectId = value("--project");
const testRunId = value("--test-run-id");
const stateFileInput = value("--state-file");
const stateFile = stateFileInput ? resolve(stateFileInput) : "";

assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production access is forbidden.",
);
assert.match(testRunId, /^w10-[a-z0-9][a-z0-9-]{7,63}$/u);
assert.ok(mode, "Choose exactly one of --enable or --restore.");
assert.ok(stateFileInput, "--state-file is required.");

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getFirestore, Timestamp } = requireFromFunctions(
  "firebase-admin/firestore",
);
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w10-maintenance-${createHash("sha256").update(testRunId).digest("hex").slice(0, 12)}`,
);
const db = getFirestore(app);

const serialize = (data) => ({
  enabled: data.enabled,
  blockedRoles: data.blockedRoles,
  bypassUids: data.bypassUids,
  title: data.title,
  message: data.message,
  startedAtMs: data.startedAt?.toMillis?.() ?? null,
  updatedAtMs: data.updatedAt?.toMillis?.() ?? null,
  updatedBy: data.updatedBy,
  revision: data.revision,
});
const restoreData = (data) => ({
  enabled: data.enabled,
  blockedRoles: data.blockedRoles,
  bypassUids: data.bypassUids,
  title: data.title,
  message: data.message,
  startedAt: Timestamp.fromMillis(data.startedAtMs),
  updatedAt: Timestamp.fromMillis(data.updatedAtMs),
  updatedBy: data.updatedBy,
  revision: data.revision,
});
const hash = (data) =>
  createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");

try {
  const ref = db.doc(CONFIG_PATH);
  if (mode === "enable") {
    assert.equal(existsSync(stateFile), false, "Restore state already exists.");
    const current = await ref.get();
    const previous = current.exists ? serialize(current.data()) : null;
    if (previous)
      assert.equal(
        previous.enabled,
        false,
        "Staging maintenance must start disabled.",
      );
    writeFileSync(
      stateFile,
      JSON.stringify({
        projectId,
        testRunId,
        existed: current.exists,
        previous,
        previousHash: hash(previous),
      }),
      { encoding: "utf8", flag: "wx" },
    );
    const now = Timestamp.now();
    await ref.set({
      enabled: true,
      blockedRoles: ["student"],
      bypassUids: [],
      title: "서비스 점검 중입니다.",
      message:
        "학생 서비스 화면을 안전하게 정리하고 있습니다. 교사 안내에 따라 잠시 후 다시 확인해 주세요.",
      startedAt: now,
      updatedAt: now,
      updatedBy: "w10-ui-visual-fixture",
      revision: Number(previous?.revision || 0) + 1,
    });
    console.log(
      JSON.stringify({
        suite: "w10-maintenance-visual-enable",
        passed: true,
        projectId,
        testRunId,
        restoredAfterEvidence: false,
        productionAccess: 0,
      }),
    );
  } else {
    assert.equal(existsSync(stateFile), true, "Restore state is missing.");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(state.projectId, projectId);
    assert.equal(state.testRunId, testRunId);
    if (state.existed) await ref.set(restoreData(state.previous));
    else await ref.delete();
    const restored = await ref.get();
    assert.equal(restored.exists, state.existed);
    assert.equal(
      hash(restored.exists ? serialize(restored.data()) : null),
      state.previousHash,
    );
    unlinkSync(stateFile);
    console.log(
      JSON.stringify({
        suite: "w10-maintenance-visual-restore",
        passed: true,
        projectId,
        testRunId,
        restoredDisabled: restored.exists
          ? restored.data()?.enabled === false
          : true,
        residualStateFile: 0,
        productionAccess: 0,
      }),
    );
  }
} finally {
  await deleteApp(app);
}
