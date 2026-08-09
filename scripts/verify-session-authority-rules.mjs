import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-westory-session-authority";
const authTime = Math.floor(Date.now() / 1000) - 30;
const staleAdminAuthTime = Math.floor(Date.now() / 1000) - 6 * 60;
const future = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
const past = Timestamp.fromMillis(Date.now() - 1000);
const rules = readFileSync(resolve("firestore.rules"), "utf8");

const sessionPath = (uid, tokenAuthTime = authTime) =>
  `application_sessions/${uid}/sessions/${tokenAuthTime}`;

const token = (email, tokenAuthTime = authTime) => ({
  email,
  auth_time: tokenAuthTime,
});

const activeSession = (uid, tokenAuthTime = authTime) => ({
  uid,
  authTime: tokenAuthTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: future,
  highRiskExpiresAt: future,
});

const main = async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });

  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "site_settings", "config"), {
        year: "2026",
        semester: "1",
      });
      await setDoc(
        doc(adminDb, sessionPath("active-user")),
        activeSession("active-user"),
      );
      await setDoc(doc(adminDb, sessionPath("expired-user")), {
        ...activeSession("expired-user"),
        generalExpiresAt: past,
      });
      await setDoc(doc(adminDb, sessionPath("closed-user")), {
        ...activeSession("closed-user"),
        status: "closed",
      });
      await setDoc(doc(adminDb, sessionPath("corrupt-user")), {
        ...activeSession("corrupt-user"),
        generalExpiresAt: "not-a-timestamp",
      });
      await setDoc(doc(adminDb, sessionPath("mismatch-user")), {
        ...activeSession("mismatch-user"),
        authTime: authTime - 1,
      });
      await setDoc(doc(adminDb, sessionPath("old-protocol-user")), {
        ...activeSession("old-protocol-user"),
        schemaVersion: 1,
      });
      await setDoc(doc(adminDb, sessionPath("observe-expired-user")), {
        ...activeSession("observe-expired-user"),
        authorityModeAtOpen: "OBSERVE_ONLY",
        generalExpiresAt: past,
      });
      await setDoc(doc(adminDb, sessionPath("observe-closed-user")), {
        ...activeSession("observe-closed-user"),
        authorityModeAtOpen: "OBSERVE_ONLY",
        status: "closed",
      });
      await setDoc(doc(adminDb, sessionPath("disabled-expired-user")), {
        ...activeSession("disabled-expired-user"),
        authorityModeAtOpen: "DISABLED",
        generalExpiresAt: past,
      });
      await setDoc(doc(adminDb, sessionPath("invalid-mode-user")), {
        ...activeSession("invalid-mode-user"),
        authorityModeAtOpen: "ALLOW",
      });
      await setDoc(
        doc(adminDb, sessionPath("recent-admin")),
        activeSession("recent-admin"),
      );
      await setDoc(
        doc(adminDb, sessionPath("stale-admin", staleAdminAuthTime)),
        activeSession("stale-admin", staleAdminAuthTime),
      );
    });

    const protectedRead = (uid, claims) =>
      getDoc(doc(env.authenticatedContext(uid, claims).firestore(), "site_settings", "config"));

    await assertSucceeds(
      protectedRead("active-user", token("active@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("missing-user", token("missing@yongshin-ms.ms.kr")),
    );

    const recentAdminDb = env.authenticatedContext("recent-admin", {
      email: "westoria28@gmail.com",
      auth_time: authTime,
    }).firestore();
    const staleAdminDb = env.authenticatedContext("stale-admin", {
      email: "westoria28@gmail.com",
      auth_time: staleAdminAuthTime,
    }).firestore();
    await assertSucceeds(
      setDoc(doc(recentAdminDb, "site_settings", "menu_config"), {
        updatedAt: "recent-auth",
      }),
    );
    await assertFails(
      setDoc(doc(staleAdminDb, "site_settings", "menu_config"), {
        updatedAt: "stale-auth",
      }),
    );
    await assertFails(
      protectedRead("expired-user", token("expired@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("closed-user", token("closed@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("corrupt-user", token("corrupt@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("mismatch-user", token("mismatch@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("old-protocol-user", token("old.protocol@yongshin-ms.ms.kr")),
    );
    await assertSucceeds(
      protectedRead("observe-expired-user", token("observe.expired@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("observe-closed-user", token("observe.closed@yongshin-ms.ms.kr")),
    );
    await assertSucceeds(
      protectedRead("disabled-expired-user", token("disabled.expired@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("invalid-mode-user", token("invalid.mode@yongshin-ms.ms.kr")),
    );

    const directDb = env
      .authenticatedContext("active-user", token("active@yongshin-ms.ms.kr"))
      .firestore();
    await assertFails(
      setDoc(doc(directDb, sessionPath("active-user")), {
        generalExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      }, { merge: true }),
    );

    console.log(
      JSON.stringify({
        suite: "session-authority-firestore-rules",
        passed: true,
        cases: ["ACTIVE", "MISSING", "EXPIRED", "CLOSED", "CORRUPT", "AUTH_TIME_MISMATCH", "OLD_PROTOCOL_DENIED", "OBSERVE_IDLE_EXPIRED_ALLOWED", "OBSERVE_CLOSED_DENIED", "DISABLED_IDLE_EXPIRED_ALLOWED", "INVALID_MODE_DENIED", "STALE_ENFORCE_MODE_NOT_DOWNGRADED", "DIRECT_SESSION_WRITE", "RECENT_ADMIN_WRITE", "STALE_ADMIN_WRITE_DENIED"],
        productionAccess: 0,
      }),
    );
  } finally {
    await env.cleanup();
  }
};

await main();
