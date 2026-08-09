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
  RECENT_AUTH_MS,
} = require("../sessionAuthority");

const email = "session.test@yongshin-ms.ms.kr";
const nowSeconds = Math.floor(Date.now() / 1000);

const requestFor = (uid, authTime) => ({
  auth: { uid, token: { email, auth_time: authTime } },
  data: {},
});

const seedSession = async (uid, authTime, overrides = {}) => {
  await getFirestore()
    .doc(`application_sessions/${uid}/sessions/${authTime}`)
    .set({
      uid,
      email,
      authTime,
      status: "active",
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
  await seedSession("active", nowSeconds);
  await assert.doesNotReject(() =>
    assertActiveApplicationSession(requestFor("active", nowSeconds)),
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
        "ACTIVE",
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
