import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";

const projectId = "demo-westory-session-authority";
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
        cases: ["ACTIVE", "MISSING", "EXPIRED", "CLOSED", "CORRUPT", "AUTH_TIME_MISMATCH", "DIRECT_SESSION_WRITE", "RECENT_ADMIN_WRITE", "STALE_ADMIN_WRITE_DENIED"],
        productionAccess: 0,
      }),
    );
  } finally {
    await env.cleanup();
  }
};

await main();
