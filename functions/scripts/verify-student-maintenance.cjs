const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const {
  createStudentMaintenanceService,
  createUpdateStudentMaintenanceConfigHandler,
  evaluateStudentMaintenanceAccess,
  normalizeStoredStudentMaintenanceConfig,
  normalizeStudentMaintenanceConfig,
  normalizeUpdatePayload,
  withStudentMaintenanceGuard,
} = require("../studentMaintenance");

const baseConfig = {
  enabled: true,
  blockedRoles: ["student"],
  bypassUids: ["student-bypass"],
  title: "위스토리 점검 안내",
  message: "학생 서비스는 점검이 끝날 때까지 잠시 이용할 수 없습니다.",
  revision: 7,
};
const storedConfig = (overrides = {}) => ({
  ...baseConfig,
  startedAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_001_000),
  updatedBy: "admin-uid",
  ...overrides,
});
const auth = (uid, email = `${uid}@yongshin-ms.ms.kr`) => ({
  uid,
  token: { email },
});
const decide = (overrides = {}) => evaluateStudentMaintenanceAccess({
  auth: auth("student-1"),
  config: baseConfig,
  profile: { role: "student" },
  profileExists: true,
  ...overrides,
});
const runIntegration = process.argv.includes("--integration");

const cases = [
  ["anonymous", decide({ auth: undefined }), true, "anonymous"],
  ["disabled", decide({ config: { ...baseConfig, enabled: false } }), true, "maintenance-disabled"],
  ["admin", decide({ auth: auth("admin", "WESTORIA28@GMAIL.COM") }), true, "admin-bypass"],
  ["bypass", decide({ auth: auth("student-bypass") }), true, "uid-bypass"],
  ["teacher", decide({ profile: { role: "teacher" } }), true, "role-not-blocked"],
  ["staff", decide({ profile: { role: "staff" } }), true, "role-not-blocked"],
  ["student", decide(), false, "role-blocked"],
  ["missing profile", decide({ profileExists: false, profile: undefined }), false, "profile-missing"],
  ["malformed profile", decide({ profile: { role: 42 } }), false, "profile-malformed"],
  ["unknown profile", decide({ profile: { role: "learner" } }), false, "profile-malformed"],
  ["missing config", decide({ config: undefined }), false, "config-malformed"],
  ["malformed config", decide({ config: { ...baseConfig, enabled: "yes" } }), false, "config-malformed"],
];
for (const [name, decision, allowed, reason] of cases) {
  assert.equal(decision.allowed, allowed, `${name}: allowed`);
  assert.equal(decision.reason, reason, `${name}: reason`);
}

assert.deepEqual(normalizeStudentMaintenanceConfig(baseConfig), baseConfig);
assert.deepEqual(normalizeStoredStudentMaintenanceConfig(storedConfig()), baseConfig);
assert.deepEqual(
  normalizeUpdatePayload({
    enabled: false,
    blockedRoles: ["student"],
    bypassUids: [],
    title: "점검 해제",
    message: "학생 서비스 점검을 해제합니다.",
  }),
  {
    enabled: false,
    blockedRoles: ["student"],
    bypassUids: [],
    title: "점검 해제",
    message: "학생 서비스 점검을 해제합니다.",
    revision: 0,
  },
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({ ...baseConfig, blockedRoles: ["teacher"] }),
  /exactly/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({ ...baseConfig, bypassUids: [" same "] }),
  /non-canonical/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({ ...baseConfig, bypassUids: ["same", "same"] }),
  /duplicate/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({
    ...baseConfig,
    bypassUids: Array.from(
      { length: 20 },
      (_, index) => index === 19 ? 42 : `valid-${index}`,
    ),
  }),
  /invalid uid/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({
    ...baseConfig,
    bypassUids: Array.from(
      { length: 20 },
      (_, index) => index === 19 ? " padded " : `valid-${index}`,
    ),
  }),
  /non-canonical/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({
    ...baseConfig,
    bypassUids: Array.from(
      { length: 20 },
      (_, index) => index === 19 ? "x".repeat(129) : `valid-${index}`,
    ),
  }),
  /invalid uid/,
);
assert.throws(
  () => normalizeStoredStudentMaintenanceConfig({ ...storedConfig(), extra: true }),
  /exact 9-field/,
);
assert.throws(
  () => normalizeStoredStudentMaintenanceConfig(storedConfig({ title: " 점검 안내" })),
  /title/,
);
assert.throws(
  () => normalizeStoredStudentMaintenanceConfig(storedConfig({ message: "점검 안내 " })),
  /message/,
);
assert.throws(
  () => normalizeStoredStudentMaintenanceConfig(storedConfig({ updatedBy: " admin-uid" })),
  /malformed/,
);
assert.throws(
  () => normalizeStoredStudentMaintenanceConfig(storedConfig({ startedAt: null })),
  /malformed/,
);
assert.throws(
  () => normalizeUpdatePayload({ ...baseConfig, startedAt: null }),
  /exactly/,
);

const runAsyncChecks = async () => {
  let handlerCalls = 0;
  let guardCalls = 0;
  const guarded = withStudentMaintenanceGuard(
    async () => {
      handlerCalls += 1;
      return "ok";
    },
    { service: { assertAccess: async () => { guardCalls += 1; } } },
  );
  assert.equal(await guarded({ auth: auth("student") }), "ok");
  assert.equal(guardCalls, 1);
  assert.equal(handlerCalls, 1);

  const denied = withStudentMaintenanceGuard(
    async () => { handlerCalls += 1; },
    { service: { assertAccess: async () => { throw new Error("blocked"); } } },
  );
  await assert.rejects(denied({ auth: auth("student") }), /blocked/);
  assert.equal(handlerCalls, 1, "business handler must not run before guard passes");

  let profileReads = 0;
  const absentService = createStudentMaintenanceService({
    db: {
      doc: (path) => ({
        get: async () => {
          if (path.startsWith("users/")) profileReads += 1;
          return { exists: false };
        },
      }),
    },
  });
  await absentService.assertAccess({ auth: auth("student") });
  assert.equal(profileReads, 0, "absent config must be disabled without profile read");

  const malformedService = createStudentMaintenanceService({
    db: {
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ enabled: false }) }),
      }),
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      malformedService.assertAccess({ auth: auth("teacher") }),
      (error) => error.code === "unavailable"
        && error.details?.reason === "maintenance-config-malformed",
    );

    const readFailureService = createStudentMaintenanceService({
      db: { doc: () => ({ get: async () => { throw new Error("read failed"); } }) },
    });
    await assert.rejects(
      readFailureService.assertAccess({ auth: auth("teacher") }),
      (error) => error.code === "unavailable"
        && error.details?.reason === "maintenance-config-read-failed",
    );
  } finally {
    console.error = originalConsoleError;
  }

  const writes = [];
  const timestampSentinel = { serverTimestamp: true };
  const configRef = {
    path: "site_settings/student_maintenance",
    collection: () => ({ doc: () => ({ path: "site_settings/student_maintenance/audit/a1" }) }),
  };
  const updateService = createStudentMaintenanceService({
    db: {
      doc: (path) => {
        assert.equal(path, "site_settings/student_maintenance");
        return configRef;
      },
      runTransaction: async (callback) => callback({
        get: async () => ({
          exists: true,
          data: () => ({ enabled: "malformed", revision: 4 }),
        }),
        set: (reference, value) => writes.push({ reference, value }),
      }),
    },
    serverTimestamp: () => timestampSentinel,
  });
  const sessionChecks = [];
  const updateHandler = createUpdateStudentMaintenanceConfigHandler({
    service: updateService,
    assertActiveApplicationSession: async (request, options) => {
      assert.deepEqual(request.data._session, { revision: "verified-proof" });
      sessionChecks.push(options);
    },
  });
  const response = await updateHandler({
    auth: auth("admin-uid", "westoria28@gmail.com"),
    data: {
      _session: { revision: "verified-proof" },
      enabled: true,
      blockedRoles: ["student"],
      bypassUids: ["student-bypass"],
      title: "위스토리 점검 안내",
      message: "학생 서비스는 점검이 끝날 때까지 잠시 이용할 수 없습니다.",
    },
  });
  assert.deepEqual(sessionChecks, [{ recentAuth: true, highRisk: true }]);
  assert.equal(response.revision, 5);
  assert.equal(writes.length, 2, "config and audit must share one transaction");
  assert.equal(writes[0].value.startedAt, timestampSentinel);
  assert.equal(writes[1].value.revision, 5);
  assert.equal(writes[1].value.updatedByEmail, "westoria28@gmail.com");
  assert.equal(Object.hasOwn(writes[0].value, "_session"), false);
  await assert.rejects(updateHandler({
    auth: auth("admin-uid", "westoria28@gmail.com"),
    data: { _session: { revision: "verified-proof" }, enabled: false, blockedRoles: ["student"], bypassUids: [], title: "안내", message: "접속 안내", unexpected: true },
  }), (error) => error.code === "invalid-argument");
  assert.equal(writes.length, 2, "unknown business fields must not write");
  const deniedHandler = createUpdateStudentMaintenanceConfigHandler({
    service: { updateConfig: () => assert.fail("unverified session must never mutate access") },
    assertActiveApplicationSession: async () => { throw new Error("invalid-session"); },
  });
  await assert.rejects(deniedHandler({ auth: auth("admin-uid", "westoria28@gmail.com"), data: {} }), /invalid-session/);

  const callableFiles = [
    "index.js",
    "sessionAuthority.js",
    "commandGateway.js",
    "archiveEnrollment.js",
    "sourceArchiveBeta.js",
  ];
  for (const file of callableFiles) {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8");
    assert.match(
      source,
      /onCallWithStudentMaintenance/,
      `${file} must create callable entries through the maintenance wrapper`,
    );
    assert.doesNotMatch(
      source,
      /\{[^}]*\bonCall\b[^}]*\}\s*=\s*require\(["']firebase-functions\/v2\/https["']\)/s,
      `${file} must not import the unguarded Firebase onCall factory`,
    );
  }
  const sessionSource = readFileSync(resolve(__dirname, "..", "sessionAuthority.js"), "utf8");
  assert.match(sessionSource, /const openApplicationSession = onCall/);
  assert.match(
    readFileSync(resolve(__dirname, "..", "index.js"), "utf8"),
    /createUpdateStudentMaintenanceConfigCallable/,
  );
  const maintenanceSource = readFileSync(
    resolve(__dirname, "..", "studentMaintenance.js"),
    "utf8",
  );
  assert.match(
    maintenanceSource,
    /enforceAppCheck:\s*true/,
    "admin recovery callable must require App Check",
  );
  assert.match(
    maintenanceSource,
    /recentAuth:\s*true[\s\S]*highRisk:\s*true/,
    "admin recovery callable must require recent high-risk session authority",
  );

  if (runIntegration) {
    process.env.GCLOUD_PROJECT =
      process.env.WESTORY_TEST_PROJECT_ID ||
      "demo-westory-session-maintenance";
    process.env.FIREBASE_CONFIG = JSON.stringify({
      projectId: process.env.GCLOUD_PROJECT,
    });
    const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT });
    try {
      const db = getFirestore(app);
      const {
        MIN_CLIENT_PROTOCOL_VERSION,
        SESSION_AUTHORITY_GENERATION,
        SESSION_SCHEMA_VERSION,
        callableExports,
      } = require("../sessionAuthority");
      const nowSeconds = Math.floor(Date.now() / 1000);
      const configRef = db.doc("site_settings/student_maintenance");
      const configFor = (enabled, bypassUids = []) => ({
        enabled,
        blockedRoles: ["student"],
        bypassUids,
        title: "위스토리 점검 안내",
        message: "학생 서비스는 점검이 끝날 때까지 잠시 이용할 수 없습니다.",
        startedAt: enabled ? Timestamp.now() : null,
        updatedAt: Timestamp.now(),
        updatedBy: "integration-admin",
        revision: 1,
      });
      const requestForOpen = (uid, email, authTime = nowSeconds) => ({
        auth: { uid, token: { email, auth_time: authTime } },
        data: {
          authorityGeneration: SESSION_AUTHORITY_GENERATION,
          protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
        },
      });
      const sessionRef = (uid, authTime = nowSeconds) =>
        db.doc(`application_sessions/${uid}/sessions/${authTime}`);
      const seedProfile = (uid, email, role) => db.doc(`users/${uid}`).set({
        uid,
        email,
        role,
        teacherPortalEnabled: role === "teacher",
        staffPermissions: [],
      });

      await configRef.set(configFor(true));
      await seedProfile(
        "integration-student-blocked",
        "integration.student.blocked@yongshin-ms.ms.kr",
        "student",
      );
      await assert.rejects(
        callableExports.openApplicationSession.run(requestForOpen(
          "integration-student-blocked",
          "integration.student.blocked@yongshin-ms.ms.kr",
        )),
        (error) => error.code === "permission-denied"
          && error.details?.reason === "student-maintenance",
      );
      assert.equal(
        (await sessionRef("integration-student-blocked").get()).exists,
        false,
        "enabled student must create zero application sessions",
      );

      await seedProfile(
        "integration-teacher",
        "integration.teacher@yongshin-ms.ms.kr",
        "teacher",
      );
      await callableExports.openApplicationSession.run(requestForOpen(
        "integration-teacher",
        "integration.teacher@yongshin-ms.ms.kr",
      ));
      assert.equal((await sessionRef("integration-teacher").get()).exists, true);

      await callableExports.openApplicationSession.run(requestForOpen(
        "integration-admin",
        "westoria28@gmail.com",
      ));
      assert.equal((await sessionRef("integration-admin").get()).exists, true);

      await configRef.set(configFor(true, ["integration-bypass"]));
      await seedProfile(
        "integration-bypass",
        "integration.bypass@yongshin-ms.ms.kr",
        "student",
      );
      await callableExports.openApplicationSession.run(requestForOpen(
        "integration-bypass",
        "integration.bypass@yongshin-ms.ms.kr",
      ));
      assert.equal((await sessionRef("integration-bypass").get()).exists, true);

      const existingUid = "integration-existing-student";
      const existingEmail = "integration.existing@yongshin-ms.ms.kr";
      await seedProfile(existingUid, existingEmail, "student");
      const lastTouchAt = Timestamp.fromMillis(Date.now() - 60_000);
      await sessionRef(existingUid).set({
        uid: existingUid,
        email: existingEmail,
        authTime: nowSeconds,
        status: "active",
        schemaVersion: SESSION_SCHEMA_VERSION,
        authorityGeneration: SESSION_AUTHORITY_GENERATION,
        protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
        sessionRevision: "f".repeat(64),
        authorityModeAtOpen: "ENFORCE",
        createdAt: Timestamp.now(),
        lastActivityAt: lastTouchAt,
        lastTouchAt,
        generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
        highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
        closedAt: null,
      });
      await assert.rejects(
        callableExports.touchApplicationSession.run({
          ...requestForOpen(existingUid, existingEmail),
          data: {
            scope: "GENERAL",
            _session: {
              authorityGeneration: SESSION_AUTHORITY_GENERATION,
              protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
              revision: "f".repeat(64),
            },
          },
        }),
        (error) => error.code === "permission-denied"
          && error.details?.reason === "student-maintenance",
      );
      assert.equal(
        (await sessionRef(existingUid).get()).data().lastTouchAt.toMillis(),
        lastTouchAt.toMillis(),
        "maintenance must deny an already-open student session before mutation",
      );

      await configRef.set({ enabled: false, blockedRoles: ["student"] });
      const originalIntegrationConsoleError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(
          callableExports.openApplicationSession.run(requestForOpen(
            "integration-malformed",
            "integration.malformed@yongshin-ms.ms.kr",
          )),
          (error) => error.code === "unavailable"
            && error.details?.reason === "maintenance-config-malformed",
        );
      } finally {
        console.error = originalIntegrationConsoleError;
      }
      assert.equal((await sessionRef("integration-malformed").get()).exists, false);

      await configRef.set(configFor(false));
      await seedProfile(
        "integration-disabled",
        "integration.disabled@yongshin-ms.ms.kr",
        "student",
      );
      await callableExports.openApplicationSession.run(requestForOpen(
        "integration-disabled",
        "integration.disabled@yongshin-ms.ms.kr",
      ));
      assert.equal((await sessionRef("integration-disabled").get()).exists, true);

      await configRef.delete();
      await seedProfile(
        "integration-absent",
        "integration.absent@yongshin-ms.ms.kr",
        "student",
      );
      await callableExports.openApplicationSession.run(requestForOpen(
        "integration-absent",
        "integration.absent@yongshin-ms.ms.kr",
      ));
      assert.equal((await sessionRef("integration-absent").get()).exists, true);
    } finally {
      await deleteApp(app);
    }
  }
};

runAsyncChecks()
  .then(() => {
    const integrationChecks = runIntegration ? 13 : 0;
    console.log(
      `student maintenance verification passed (${cases.length + 32 + integrationChecks} checks)`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
