const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-westory-session-authority";
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: process.env.GCLOUD_PROJECT,
});

initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const {
  assertActiveApplicationSession,
  MIN_CLIENT_PROTOCOL_VERSION,
  RECENT_AUTH_MS,
  SESSION_AUTHORITY_GENERATION,
  SESSION_SCHEMA_VERSION,
  callableExports,
  resolveSessionAuthorityConfig,
} = require("../sessionAuthority");

const email = "session.test@yongshin-ms.ms.kr";
const nowSeconds = Math.floor(Date.now() / 1000);

const revision = "a".repeat(64);
const requestFor = (uid, authTime, overrides = {}) => ({
  auth: { uid, token: { email, auth_time: authTime } },
  data: {
    _session: {
      authorityGeneration: SESSION_AUTHORITY_GENERATION,
      protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      revision,
    },
    ...overrides,
  },
});

const seedSession = async (uid, authTime, overrides = {}) => {
  await getFirestore()
    .doc(`application_sessions/${uid}/sessions/${authTime}`)
    .set({
      uid,
      email,
      authTime,
      status: "active",
      schemaVersion: SESSION_SCHEMA_VERSION,
      authorityGeneration: SESSION_AUTHORITY_GENERATION,
      protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      sessionRevision: revision,
      authorityModeAtOpen: "ENFORCE",
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      ...overrides,
    });
};

const rejectionReason = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error?.details?.reason || error?.code || String(error);
  }
  throw new Error("Expected operation to reject.");
};

const main = async () => {
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession({ auth: null, data: {} }),
    ),
    "SESSION_AUTH_REQUIRED",
  );
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession({
        auth: {
          uid: "wrong-domain",
          token: { email: "wrong@example.com", auth_time: nowSeconds },
        },
        data: {},
      }),
    ),
    "SESSION_ACCOUNT_NOT_ALLOWED",
  );
  assert.deepEqual(
    resolveSessionAuthorityConfig({ GCLOUD_PROJECT: "westory-staging-177587430482" }),
    {
      valid: true,
      projectId: "westory-staging-177587430482",
      mode: "ENFORCE",
      appCheckMode: "ENFORCE",
      requireAppCheck: true,
      appCheckPromotionRequired: false,
      reason: "",
    },
  );
  assert.equal(
    resolveSessionAuthorityConfig({ GCLOUD_PROJECT: "history-quiz-yongsin" }).mode,
    "OBSERVE_ONLY",
  );
  assert.equal(
    resolveSessionAuthorityConfig({
      GCLOUD_PROJECT: "history-quiz-yongsin",
      WESTORY_SESSION_IDLE_MODE: "DISABLED",
    }).mode,
    "DISABLED",
  );
  assert.equal(
    resolveSessionAuthorityConfig({
      GCLOUD_PROJECT: "history-quiz-yongsin",
      WESTORY_SESSION_IDLE_MODE: "ENFORCE",
    }).valid,
    false,
  );
  assert.equal(
    resolveSessionAuthorityConfig({
      GCLOUD_PROJECT: "history-quiz-yongsin",
      WESTORY_APP_CHECK_MODE: "ENFORCE",
    }).requireAppCheck,
    true,
  );
  assert.equal(
    resolveSessionAuthorityConfig({
      GCLOUD_PROJECT: "westory-staging-177587430482",
      WESTORY_APP_CHECK_MODE: "DISABLED",
    }).valid,
    false,
  );
  assert.equal(
    resolveSessionAuthorityConfig({ GCLOUD_PROJECT: "unknown-project" }).valid,
    false,
  );

  const demoProjectId = process.env.GCLOUD_PROJECT;
  await seedSession("observe-idle-expired", nowSeconds, {
    authorityModeAtOpen: "OBSERVE_ONLY",
    generalExpiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  await seedSession("observe-closed", nowSeconds, {
    authorityModeAtOpen: "OBSERVE_ONLY",
    status: "closed",
  });
  await seedSession("observe-old-protocol", nowSeconds, {
    authorityModeAtOpen: "OBSERVE_ONLY",
    schemaVersion: 1,
  });
  await seedSession("observe-auth-mismatch", nowSeconds, {
    authorityModeAtOpen: "OBSERVE_ONLY",
    authTime: nowSeconds - 1,
  });
  await seedSession("stale-enforce-idle-expired", nowSeconds, {
    authorityModeAtOpen: "ENFORCE",
    generalExpiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  await seedSession("touch-observe-idle-expired", nowSeconds, {
    authorityModeAtOpen: "OBSERVE_ONLY",
    generalExpiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  await seedSession("close-proofless", nowSeconds);
  process.env.GCLOUD_PROJECT = "westory-staging-177587430482";
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("app-check", nowSeconds)),
    ),
    "APP_CHECK_REQUIRED",
  );
  process.env.GCLOUD_PROJECT = "history-quiz-yongsin";
  for (const mode of ["OBSERVE_ONLY", "DISABLED"]) {
    process.env.WESTORY_SESSION_IDLE_MODE = mode;
    await assert.doesNotReject(() =>
      assertActiveApplicationSession(requestFor("observe-idle-expired", nowSeconds)),
    );
    await assert.doesNotReject(() =>
      callableExports.openApplicationSession.run({
        auth: {
          uid: "observe-idle-expired",
          token: { email, auth_time: nowSeconds },
        },
        data: {
          authorityGeneration: SESSION_AUTHORITY_GENERATION,
          protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
        },
      }),
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor(`${mode}-missing`, nowSeconds)),
      ),
      "SESSION_MISSING",
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor("observe-closed", nowSeconds)),
      ),
      "SESSION_EXPIRED",
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor("observe-old-protocol", nowSeconds)),
      ),
      "SESSION_PROTOCOL_OUTDATED",
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor("observe-auth-mismatch", nowSeconds)),
      ),
      "SESSION_EXPIRED",
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor("observe-idle-expired", nowSeconds, {
          _session: {
            authorityGeneration: SESSION_AUTHORITY_GENERATION,
            protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
            revision: "b".repeat(64),
          },
        })),
      ),
      "SESSION_PROOF_INVALID",
    );
    assert.equal(
      await rejectionReason(() =>
        assertActiveApplicationSession(requestFor("stale-enforce-idle-expired", nowSeconds)),
      ),
      "SESSION_EXPIRED",
    );
    assert.equal(
      await rejectionReason(() =>
        callableExports.openApplicationSession.run({
          auth: {
            uid: "stale-enforce-idle-expired",
            token: { email, auth_time: nowSeconds },
          },
          data: {
            authorityGeneration: SESSION_AUTHORITY_GENERATION,
            protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
          },
        }),
      ),
      "SESSION_REAUTH_REQUIRED",
    );
  }

  process.env.WESTORY_SESSION_IDLE_MODE = "OBSERVE_ONLY";
  process.env.WESTORY_APP_CHECK_MODE = "ENFORCE";
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("promoted-app-check", nowSeconds)),
    ),
    "APP_CHECK_REQUIRED",
  );
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession({
        ...requestFor("promoted-missing", nowSeconds),
        app: { appId: "test-app-id" },
      }),
    ),
    "SESSION_MISSING",
  );
  delete process.env.WESTORY_APP_CHECK_MODE;
  assert.equal(
    await rejectionReason(() =>
      callableExports.openApplicationSession.run({
        auth: { uid: "old-open", token: { email, auth_time: nowSeconds } },
        data: {},
      }),
    ),
    "SESSION_PROTOCOL_REQUIRED",
  );
  await assert.doesNotReject(() =>
    callableExports.touchApplicationSession.run({
      ...requestFor("touch-observe-idle-expired", nowSeconds),
      data: {
        ...requestFor("touch-observe-idle-expired", nowSeconds).data,
        scope: "GENERAL",
      },
    }),
  );
  assert.equal(
    await rejectionReason(() =>
      callableExports.touchApplicationSession.run(
        requestFor("touch-observe-missing", nowSeconds),
      )),
    "SESSION_MISSING",
  );
  process.env.WESTORY_SESSION_IDLE_MODE = "DISABLED";
  assert.equal(
    await rejectionReason(() =>
      callableExports.touchApplicationSession.run(
        requestFor("close-proofless", nowSeconds, {
          _session: {
            authorityGeneration: SESSION_AUTHORITY_GENERATION,
            protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
            revision: "b".repeat(64),
          },
        }),
      )),
    "SESSION_PROOF_INVALID",
  );
  await assert.doesNotReject(() =>
    callableExports.closeApplicationSession.run({
      auth: { uid: "close-proofless", token: { email, auth_time: nowSeconds } },
      data: {},
    }),
  );
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("close-proofless", nowSeconds)),
    ),
    "SESSION_EXPIRED",
  );
  const staleDisabledAuthTime = nowSeconds - Math.ceil(RECENT_AUTH_MS / 1000) - 2;
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(
        requestFor("disabled-stale-auth", staleDisabledAuthTime),
        { recentAuth: true },
      )),
    "RECENT_AUTH_REQUIRED",
  );
  delete process.env.WESTORY_SESSION_IDLE_MODE;
  process.env.GCLOUD_PROJECT = demoProjectId;

  await seedSession("active", nowSeconds);
  await assert.doesNotReject(() =>
    assertActiveApplicationSession(requestFor("active", nowSeconds)),
  );

  await seedSession("reauth-transition", nowSeconds);
  await assert.doesNotReject(() =>
    callableExports.beginApplicationSessionReauthentication.run(
      requestFor("reauth-transition", nowSeconds),
    ),
  );
  const transitionRef = getFirestore().doc(
    "application_session_transitions/reauth-transition",
  );
  const transitionSnap = await transitionRef.get();
  assert.equal(transitionSnap.exists, true);
  assert.equal(transitionSnap.data().status, "pending");
  assert.equal(transitionSnap.data().fromAuthTime, nowSeconds);
  await assert.doesNotReject(() =>
    callableExports.openApplicationSession.run({
      auth: {
        uid: "reauth-transition",
        token: { email, auth_time: nowSeconds + 1 },
      },
      data: {
        authorityGeneration: SESSION_AUTHORITY_GENERATION,
        protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
      },
    }),
  );
  assert.equal((await transitionRef.get()).exists, false);
  assert.equal(
    (
      await getFirestore()
        .doc(`application_sessions/reauth-transition/sessions/${nowSeconds}`)
        .get()
    ).data().status,
    "closed",
  );
  assert.equal(
    await rejectionReason(() =>
      callableExports.touchApplicationSession.run({
        ...requestFor("active", nowSeconds),
        data: {
          ...requestFor("active", nowSeconds).data,
          scope: "HIGH_RISK",
        },
      }),
    ),
    "HIGH_RISK_SESSION_ADMIN_ONLY",
  );

  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("active", nowSeconds, {
        _session: undefined,
      })),
    ),
    "SESSION_PROOF_INVALID",
  );
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("active", nowSeconds, {
        _session: {
          authorityGeneration: SESSION_AUTHORITY_GENERATION,
          protocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
          revision: "b".repeat(64),
        },
      })),
    ),
    "SESSION_PROOF_INVALID",
  );

  await seedSession("old-protocol", nowSeconds, { schemaVersion: 1 });
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("old-protocol", nowSeconds)),
    ),
    "SESSION_PROTOCOL_OUTDATED",
  );

  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("missing", nowSeconds)),
    ),
    "SESSION_MISSING",
  );

  await seedSession("expired", nowSeconds, {
    generalExpiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("expired", nowSeconds)),
    ),
    "SESSION_EXPIRED",
  );

  await seedSession("high-risk-expired", nowSeconds, {
    highRiskExpiresAt: Timestamp.fromMillis(Date.now() - 1),
  });
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(
        requestFor("high-risk-expired", nowSeconds),
        { highRisk: true },
      ),
    ),
    "SESSION_EXPIRED",
  );

  const oldAuthTime = nowSeconds - Math.ceil(RECENT_AUTH_MS / 1000) - 2;
  await seedSession("stale-auth", oldAuthTime);
  assert.equal(
    await rejectionReason(() =>
      assertActiveApplicationSession(requestFor("stale-auth", oldAuthTime), {
        recentAuth: true,
      }),
    ),
    "RECENT_AUTH_REQUIRED",
  );

  console.log(
    JSON.stringify({
      suite: "session-authority-functions-core",
      passed: true,
      cases: [
        "ENVIRONMENT_MODE_FAIL_CLOSED",
        "UNAUTHENTICATED_DENIED",
        "ACCOUNT_PERMISSION_DENIED",
        "HIGH_RISK_SCOPE_ADMIN_ONLY",
        "STAGING_APP_CHECK_REQUIRED",
        "PRODUCTION_OBSERVE_IDLE_ONLY",
        "PRODUCTION_OBSERVE_SESSION_FENCE_RETAINED",
        "PRODUCTION_DISABLED_SESSION_FENCE_RETAINED",
        "PRODUCTION_APP_CHECK_PROMOTION_ENFORCED",
        "STALE_MODE_FAILS_CLOSED",
        "OPEN_OLD_PROTOCOL_DENIED_IN_OBSERVE",
        "OPEN_IDLE_EXPIRED_RESUMES_ONLY_WHEN_NON_ENFORCING",
        "TOUCH_OBSERVE_IDLE_ONLY",
        "TOUCH_FENCE_RETAINED_WHEN_DISABLED",
        "CLOSE_PROOFLESS_AND_REVOKED",
        "STEP_UP_RETAINED_WHEN_DISABLED",
        "ACTIVE",
        "REAUTH_TRANSITION_CREATED_AND_CONSUMED",
        "TOKEN_REFRESH_SAME_AUTH_TIME",
        "SESSION_PROOF_REQUIRED",
        "SESSION_REVISION_MISMATCH",
        "OLD_PROTOCOL_REJECTED",
        "MISSING",
        "GENERAL_EXPIRED",
        "HIGH_RISK_EXPIRED",
        "RECENT_AUTH_REQUIRED",
      ],
      productionAccess: 0,
    }),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
