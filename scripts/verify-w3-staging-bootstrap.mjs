import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const ACTIVE_SEMESTER_ID = "2026-2";
const PARTIAL_SEMESTER_ID = "2027-2";
const BOOTSTRAP_OWNER = "w3-staging-bootstrap";
const POLICY_VERSION = "w3-v1";

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const verifyLive = argumentsList.includes("--verify-live");
assert.equal(
  apply && verifyLive,
  false,
  "Choose exactly one live mode: --apply or --verify-live.",
);
const projectArgument = argumentsList.find((value) =>
  value.startsWith("--project="),
);
const projectId = String(projectArgument?.slice("--project=".length) || "").trim();

assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `W3 staging bootstrap requires exact --project=${STAGING_PROJECT_ID}.`,
);

const activeManifestPath = `semester_manifests/${ACTIVE_SEMESTER_ID}`;
const activePointerPath = "site_settings/semester_active";
const compatibilityConfigPath = "site_settings/config";
const activeSeedPaths = [
  "years/2026/semesters/2/point_policies/current",
  "years/2026/semesters/2/assessment_config/settings",
  "years/2026/semesters/2/exam_config/final_exam",
  "years/2026/semesters/2/grading_plans_meta/current",
  "years/2026/semesters/2/calendar_meta/current",
  "years/2026/semesters/2/notices_meta/current",
];
const partialManifestPath = `semester_manifests/${PARTIAL_SEMESTER_ID}`;
const partialSeedPaths = [
  "years/2027/semesters/2/point_policies/current",
  "years/2027/semesters/2/assessment_config/settings",
  "years/2027/semesters/2/exam_config/final_exam",
  "years/2027/semesters/2/grading_plans_meta/current",
  "years/2027/semesters/2/calendar_meta/current",
  "years/2027/semesters/2/notices_meta/current",
];

const plan = {
  suite: "w3-dedicated-staging-bootstrap",
  mode: apply ? "APPLY" : verifyLive ? "VERIFY_LIVE" : "DRY_RUN",
  verificationScope:
    apply || verifyLive
      ? "DEDICATED_STAGING_LIVE_STATE"
      : "STATIC_PLAN_ONLY_NO_NETWORK_OR_CREDENTIAL_ACCESS",
  projectId,
  productionAccess: 0,
  guards: [
    `projectId === ${STAGING_PROJECT_ID}`,
    "existing site_settings/config already selects 2026-2",
    "existing W3 documents must be compatible or the transaction aborts",
    "2027-2 fixture must contain exactly one trusted seed",
  ],
  bootstrap: {
    activeManifestPath,
    activePointerPath,
    compatibilityConfigPath,
    activeSemesterId: ACTIVE_SEMESTER_ID,
    requiredSeedPaths: activeSeedPaths,
    missingSeedsPolicy: "record-only; never create or repair legacy active seeds",
  },
  partialFixture: {
    manifestPath: partialManifestPath,
    fixture: "PARTIAL_SHELL",
    expectedSeedPaths: [partialSeedPaths[0]],
    forbiddenSeedPaths: partialSeedPaths.slice(1),
    expectedReadiness: "FAIL after authenticated validateSemesterReadiness",
  },
};

if (!apply && !verifyLive) {
  console.log(
    JSON.stringify(
      {
        ...plan,
        passed: true,
        liveStateVerified: false,
        nextStep:
          "Run with --verify-live for read-only Dedicated Staging verification or --apply for the fenced transaction.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, getApps, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { FieldValue, getFirestore } = requireFromFunctions(
  "firebase-admin/firestore",
);

const app =
  getApps().find((candidate) => candidate.name === "w3-staging-bootstrap") ||
  initializeApp(
    { credential: applicationDefault(), projectId },
    "w3-staging-bootstrap",
  );
const db = getFirestore(app);

const requireCompatibleManifest = (snapshot, semesterId, expected) => {
  if (!snapshot.exists) return;
  const data = snapshot.data() || {};
  assert.equal(data.semesterId, semesterId, `${semesterId} identity conflict.`);
  assert.equal(data.schoolYear, expected.schoolYear, `${semesterId} year conflict.`);
  assert.equal(data.term, expected.term, `${semesterId} term conflict.`);
  assert.equal(data.status, expected.status, `${semesterId} status conflict.`);
  assert.equal(
    data.stagingFixture || data.bootstrapOwner,
    expected.marker,
    `${semesterId} is not owned by the W3 staging bootstrap.`,
  );
};

const requirePositiveInteger = (value, message) => {
  assert.equal(Number.isInteger(value) && value > 0, true, message);
  return value;
};

const readLiveState = async () => {
  const [activeManifest, pointer, config, partialManifest, ...seedSnapshots] =
    await Promise.all([
      db.doc(activeManifestPath).get(),
      db.doc(activePointerPath).get(),
      db.doc(compatibilityConfigPath).get(),
      db.doc(partialManifestPath).get(),
      ...activeSeedPaths.map((path) => db.doc(path).get()),
      ...partialSeedPaths.map((path) => db.doc(path).get()),
    ]);
  return {
    activeManifest,
    pointer,
    config,
    partialManifest,
    activeSeeds: seedSnapshots.slice(0, activeSeedPaths.length),
    partialSeeds: seedSnapshots.slice(activeSeedPaths.length),
  };
};

const verifyLiveState = (state) => {
  const {
    activeManifest,
    pointer,
    config,
    partialManifest,
    activeSeeds,
    partialSeeds,
  } = state;
  assert.equal(config.exists, true, "site_settings/config is missing.");
  assert.equal(activeManifest.exists, true, `${activeManifestPath} is missing.`);
  assert.equal(pointer.exists, true, `${activePointerPath} is missing.`);
  assert.equal(partialManifest.exists, true, `${partialManifestPath} is missing.`);
  requireCompatibleManifest(activeManifest, ACTIVE_SEMESTER_ID, {
    schoolYear: "2026",
    term: "2",
    status: "ACTIVE",
    marker: BOOTSTRAP_OWNER,
  });
  requireCompatibleManifest(partialManifest, PARTIAL_SEMESTER_ID, {
    schoolYear: "2027",
    term: "2",
    status: "PREPARING",
    marker: "PARTIAL_SHELL",
  });

  const manifestRevision = requirePositiveInteger(
    activeManifest.data()?.revision,
    "Active manifest revision must be a positive integer.",
  );
  const pointerRevision = requirePositiveInteger(
    pointer.data()?.revision,
    "Active pointer revision must be a positive integer.",
  );
  const configRevision = requirePositiveInteger(
    config.data()?.activeSemesterRevision,
    "Compatibility config activeSemesterRevision must be a positive integer.",
  );
  assert.equal(pointerRevision, manifestRevision, "Pointer/manifest revision mismatch.");
  assert.equal(configRevision, manifestRevision, "Config/manifest revision mismatch.");
  assert.equal(pointer.data()?.semesterId, ACTIVE_SEMESTER_ID);
  assert.equal(`${config.data()?.year}-${config.data()?.semester}`, ACTIVE_SEMESTER_ID);
  assert.equal(config.data()?.activeSemesterId, ACTIVE_SEMESTER_ID);
  assert.equal(config.data()?.semesterLifecycleStatus, "ACTIVE");
  assert.equal(config.data()?.semesterWritesEnabled, true);

  const existingActiveSeedRefs = activeSeedPaths.filter(
    (_path, index) => activeSeeds[index].exists,
  );
  const missingActiveSeedRefs = activeSeedPaths.filter(
    (_path, index) => !activeSeeds[index].exists,
  );
  assert.equal(activeManifest.data()?.shellState, "LEGACY_BOOTSTRAPPED");
  assert.equal(activeManifest.data()?.seedCount, existingActiveSeedRefs.length);
  assert.equal(activeManifest.data()?.requiredSeedCount, activeSeedPaths.length);
  assert.deepEqual(activeManifest.data()?.seedRefs, existingActiveSeedRefs);
  assert.deepEqual(
    activeManifest.data()?.bootstrapMissingSeedRefs,
    missingActiveSeedRefs,
  );

  assert.equal(partialManifest.data()?.shellState, "PARTIAL");
  assert.equal(partialManifest.data()?.seedCount, 1);
  assert.equal(partialManifest.data()?.requiredSeedCount, partialSeedPaths.length);
  assert.deepEqual(partialManifest.data()?.seedRefs, [partialSeedPaths[0]]);
  assert.equal(partialSeeds[0].exists, true, "PARTIAL_SHELL trusted seed is missing.");
  assert.equal(
    partialSeeds.slice(1).some((snapshot) => snapshot.exists),
    false,
    "PARTIAL_SHELL fixture is contaminated by additional trusted seeds.",
  );
  assert.equal(partialSeeds[0].data()?.seedState, "COMPLETE");
  assert.equal(partialSeeds[0].data()?.managedBy, "semesterCore");
  assert.equal(partialSeeds[0].data()?.semesterId, PARTIAL_SEMESTER_ID);

  return {
    activeManifestStatus: activeManifest.data()?.status,
    activePointerSemesterId: pointer.data()?.semesterId,
    activeRevision: manifestRevision,
    activeLegacySeedCount: existingActiveSeedRefs.length,
    activeLegacyMissingSeedCount: missingActiveSeedRefs.length,
    partialSeedCount: partialSeeds.filter((snapshot) => snapshot.exists).length,
  };
};

if (verifyLive) {
  const verification = verifyLiveState(await readLiveState());
  console.log(
    JSON.stringify(
      { ...plan, passed: true, liveStateVerified: true, verification },
      null,
      2,
    ),
  );
  process.exit(0);
}

await db.runTransaction(async (transaction) => {
  const references = {
    config: db.doc(compatibilityConfigPath),
    pointer: db.doc(activePointerPath),
    activeManifest: db.doc(activeManifestPath),
    activeSeeds: activeSeedPaths.map((path) => db.doc(path)),
    partialManifest: db.doc(partialManifestPath),
    partialSeeds: partialSeedPaths.map((path) => db.doc(path)),
  };
  const [config, pointer, activeManifest, partialManifest, ...seedSnapshots] =
    await transaction.getAll(
      references.config,
      references.pointer,
      references.activeManifest,
      references.partialManifest,
      ...references.activeSeeds,
      ...references.partialSeeds,
    );
  const activeSeeds = seedSnapshots.slice(0, activeSeedPaths.length);
  const partialSeeds = seedSnapshots.slice(activeSeedPaths.length);

  assert.equal(config.exists, true, "site_settings/config must exist before bootstrap.");
  assert.equal(
    `${String(config.data()?.year || "")}-${String(config.data()?.semester || "")}`,
    ACTIVE_SEMESTER_ID,
    "Bootstrap never changes a legacy active scope; config must already select 2026-2.",
  );
  if (pointer.exists) {
    assert.equal(
      pointer.data()?.semesterId,
      ACTIVE_SEMESTER_ID,
      "Existing active pointer conflicts with the legacy active scope.",
    );
    requirePositiveInteger(
      pointer.data()?.revision,
      "Existing active pointer revision must be a positive integer.",
    );
  }
  requireCompatibleManifest(activeManifest, ACTIVE_SEMESTER_ID, {
    schoolYear: "2026",
    term: "2",
    status: "ACTIVE",
    marker: BOOTSTRAP_OWNER,
  });
  if (activeManifest.exists) {
    requirePositiveInteger(
      activeManifest.data()?.revision,
      "Existing active manifest revision must be a positive integer.",
    );
  }
  if (activeManifest.exists && pointer.exists) {
    assert.equal(
      activeManifest.data()?.revision,
      pointer.data()?.revision,
      "Existing active manifest and pointer revisions must match exactly.",
    );
  }
  requireCompatibleManifest(partialManifest, PARTIAL_SEMESTER_ID, {
    schoolYear: "2027",
    term: "2",
    status: "PREPARING",
    marker: "PARTIAL_SHELL",
  });
  assert.equal(
    partialSeeds.slice(1).some((snapshot) => snapshot.exists),
    false,
    "PARTIAL_SHELL fixture is contaminated by additional trusted seeds.",
  );

  const timestamp = FieldValue.serverTimestamp();
  const existingActiveSeedRefs = activeSeedPaths.filter(
    (_path, index) => activeSeeds[index].exists,
  );
  const missingActiveSeedRefs = activeSeedPaths.filter(
    (_path, index) => !activeSeeds[index].exists,
  );
  const activeRevision = Number(
    activeManifest.data()?.revision ?? pointer.data()?.revision ?? 1,
  );
  if (!activeManifest.exists) {
    transaction.create(references.activeManifest, {
      semesterId: ACTIVE_SEMESTER_ID,
      schoolYear: "2026",
      term: "2",
      displayName: "2026학년도 2학기",
      status: "ACTIVE",
      provenance: "CURRENT",
      startAt: "2026-08-20",
      endAt: "2027-02-28",
      schemaVersion: 1,
      revision: activeRevision,
      stateRevision: 1,
      readinessPolicyVersion: POLICY_VERSION,
      shellState: "LEGACY_BOOTSTRAPPED",
      seedCount: existingActiveSeedRefs.length,
      requiredSeedCount: activeSeedPaths.length,
      seedRefs: existingActiveSeedRefs,
      bootstrapMissingSeedRefs: missingActiveSeedRefs,
      bootstrapOwner: BOOTSTRAP_OWNER,
      bootstrapMode: "LEGACY_ACTIVE_BACKFILL",
      createdAt: timestamp,
      createdBy: BOOTSTRAP_OWNER,
      updatedAt: timestamp,
      updatedBy: BOOTSTRAP_OWNER,
      activatedAt: timestamp,
      activatedBy: BOOTSTRAP_OWNER,
    });
  } else {
    transaction.set(
      references.activeManifest,
      {
        shellState: "LEGACY_BOOTSTRAPPED",
        seedCount: existingActiveSeedRefs.length,
        requiredSeedCount: activeSeedPaths.length,
        seedRefs: existingActiveSeedRefs,
        bootstrapMissingSeedRefs: missingActiveSeedRefs,
        updatedAt: timestamp,
        updatedBy: BOOTSTRAP_OWNER,
      },
      { merge: true },
    );
  }
  if (!pointer.exists) {
    transaction.create(references.pointer, {
      semesterId: ACTIVE_SEMESTER_ID,
      revision: activeRevision,
      previousSemesterId: null,
      activatedAt: timestamp,
      activatedBy: BOOTSTRAP_OWNER,
      bootstrapOwner: BOOTSTRAP_OWNER,
    });
  }
  transaction.set(
    references.config,
    {
      activeSemesterId: ACTIVE_SEMESTER_ID,
      activeSemesterRevision: activeRevision,
      semesterCoreSchemaVersion: 1,
      semesterLifecycleStatus: "ACTIVE",
      semesterWritesEnabled: true,
    },
    { merge: true },
  );

  if (!partialManifest.exists) {
    transaction.create(references.partialManifest, {
      semesterId: PARTIAL_SEMESTER_ID,
      schoolYear: "2027",
      term: "2",
      displayName: "2027학년도 2학기 PARTIAL_SHELL",
      status: "PREPARING",
      provenance: "PREPARING",
      startAt: "2027-08-20",
      endAt: "2028-02-29",
      schemaVersion: 1,
      revision: 1,
      stateRevision: 1,
      readinessPolicyVersion: POLICY_VERSION,
      shellState: "PARTIAL",
      seedCount: 1,
      requiredSeedCount: 6,
      seedRefs: [partialSeedPaths[0]],
      stagingFixture: "PARTIAL_SHELL",
      bootstrapOwner: BOOTSTRAP_OWNER,
      createdAt: timestamp,
      createdBy: BOOTSTRAP_OWNER,
      updatedAt: timestamp,
      updatedBy: BOOTSTRAP_OWNER,
    });
  }
  if (!partialSeeds[0].exists) {
    transaction.create(references.partialSeeds[0], {
      shellReady: true,
      schemaVersion: 1,
      seedState: "COMPLETE",
      managedBy: "semesterCore",
      semesterId: PARTIAL_SEMESTER_ID,
      stagingFixture: "PARTIAL_SHELL",
      seededAt: timestamp,
      seededBy: BOOTSTRAP_OWNER,
    });
  }
});

const verification = verifyLiveState(await readLiveState());

console.log(
  JSON.stringify(
    {
      ...plan,
      passed: true,
      liveStateVerified: true,
      verification: {
        ...verification,
        nextStep:
          "Authenticate to Dedicated Staging and run validateSemesterReadiness for 2027-2; required_settings and trusted_shell_complete must FAIL.",
      },
    },
    null,
    2,
  ),
);
