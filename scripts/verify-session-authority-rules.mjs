import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
} from "firebase/firestore";

const projectId =
  process.env.GCLOUD_PROJECT || "demo-westory-session-authority";
const authTime = Math.floor(Date.now() / 1000) - 30;
const staleAdminAuthTime = Math.floor(Date.now() / 1000) - 6 * 60;
const future = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
const past = Timestamp.fromMillis(Date.now() - 1000);
const transitionAuthTime = authTime + 1;
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
      await setDoc(doc(adminDb, "site_settings", "student_maintenance"), {
        enabled: false,
        blockedRoles: ["student"],
        bypassUids: [],
        title: "W10P 시각 검증 점검 안내",
        message: "W10P 시각 검증에서는 점검 모드를 사용하지 않습니다.",
        startedAt: null,
        updatedAt: Timestamp.fromMillis(Date.now()),
        updatedBy: "fixture-admin",
        revision: 1,
      });
      const userProfiles = [
        [
          "w10p-visual-admin",
          "w10p-visual-admin@yongshin-ms.ms.kr",
          "teacher",
          true,
          [],
        ],
        ["teacher-user", "teacher@yongshin-ms.ms.kr", "teacher", true, []],
        [
          "staff-user",
          "staff@yongshin-ms.ms.kr",
          "staff",
          true,
          ["student_list_read"],
        ],
        ["student-user", "student@yongshin-ms.ms.kr", "student", false, []],
        ["staff-denied", "staff.denied@yongshin-ms.ms.kr", "staff", true, []],
        [
          "expired-list-user",
          "expired.list@yongshin-ms.ms.kr",
          "teacher",
          true,
          [],
        ],
      ];
      for (const [
        uid,
        email,
        role,
        teacherPortalEnabled,
        staffPermissions,
      ] of userProfiles) {
        await setDoc(doc(adminDb, "users", uid), {
          uid,
          email,
          role,
          teacherPortalEnabled,
          staffPermissions,
        });
        await setDoc(doc(adminDb, sessionPath(uid)), activeSession(uid));
      }
      await setDoc(doc(adminDb, sessionPath("expired-list-user")), {
        ...activeSession("expired-list-user"),
        generalExpiresAt: past,
      });
      await setDoc(
        doc(adminDb, sessionPath("real-admin")),
        activeSession("real-admin"),
      );
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
      await setDoc(
        doc(adminDb, "application_session_transitions", "transition-user"),
        {
          uid: "transition-user",
          status: "pending",
          fromAuthTime: authTime,
          expiresAt: future,
          schemaVersion: 1,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
        },
      );
      await setDoc(
        doc(
          adminDb,
          "application_session_transitions",
          "expired-transition-user",
        ),
        {
          uid: "expired-transition-user",
          status: "pending",
          fromAuthTime: authTime,
          expiresAt: past,
          schemaVersion: 1,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
        },
      );
    });

    const protectedRead = (uid, claims) =>
      getDoc(
        doc(
          env.authenticatedContext(uid, claims).firestore(),
          "site_settings",
          "config",
        ),
      );

    await assertSucceeds(
      protectedRead("active-user", token("active@yongshin-ms.ms.kr")),
    );
    await assertFails(
      protectedRead("missing-user", token("missing@yongshin-ms.ms.kr")),
    );
    await assertSucceeds(
      protectedRead(
        "transition-user",
        token("transition@yongshin-ms.ms.kr", transitionAuthTime),
      ),
    );
    await assertFails(
      protectedRead(
        "transition-user",
        token("transition.old@yongshin-ms.ms.kr", authTime),
      ),
    );
    await assertFails(
      protectedRead(
        "expired-transition-user",
        token("transition.expired@yongshin-ms.ms.kr", transitionAuthTime),
      ),
    );

    const listUsers = (uid, claims) =>
      getDocs(
        collection(env.authenticatedContext(uid, claims).firestore(), "users"),
      );
    await assertSucceeds(
      listUsers("w10p-visual-admin", {
        ...token("w10p-visual-admin@yongshin-ms.ms.kr"),
        fixtureOwner: "w10p-visual-parity",
        fixtureId: "w10p-visual-fixture-v1",
        fixtureRole: "admin",
      }),
    );
    await assertSucceeds(
      listUsers("teacher-user", token("teacher@yongshin-ms.ms.kr")),
    );
    await assertSucceeds(
      listUsers("staff-user", token("staff@yongshin-ms.ms.kr")),
    );
    await assertSucceeds(
      listUsers("real-admin", token("westoria28@gmail.com")),
    );
    await assertFails(
      listUsers("student-user", token("student@yongshin-ms.ms.kr")),
    );
    await assertFails(
      listUsers("staff-denied", token("staff.denied@yongshin-ms.ms.kr")),
    );
    await assertFails(
      listUsers("expired-list-user", token("expired.list@yongshin-ms.ms.kr")),
    );

    const recentAdminDb = env
      .authenticatedContext("recent-admin", {
        email: "westoria28@gmail.com",
        auth_time: authTime,
      })
      .firestore();
    const staleAdminDb = env
      .authenticatedContext("stale-admin", {
        email: "westoria28@gmail.com",
        auth_time: staleAdminAuthTime,
      })
      .firestore();
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
      protectedRead(
        "old-protocol-user",
        token("old.protocol@yongshin-ms.ms.kr"),
      ),
    );
    await assertSucceeds(
      protectedRead(
        "observe-expired-user",
        token("observe.expired@yongshin-ms.ms.kr"),
      ),
    );
    await assertFails(
      protectedRead(
        "observe-closed-user",
        token("observe.closed@yongshin-ms.ms.kr"),
      ),
    );
    await assertSucceeds(
      protectedRead(
        "disabled-expired-user",
        token("disabled.expired@yongshin-ms.ms.kr"),
      ),
    );
    await assertFails(
      protectedRead(
        "invalid-mode-user",
        token("invalid.mode@yongshin-ms.ms.kr"),
      ),
    );

    const directDb = env
      .authenticatedContext("active-user", token("active@yongshin-ms.ms.kr"))
      .firestore();
    await assertFails(
      setDoc(
        doc(directDb, sessionPath("active-user")),
        {
          generalExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
        },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(doc(directDb, "application_session_transitions", "active-user"), {
        status: "pending",
      }),
    );

    console.log(
      JSON.stringify({
        suite: "session-authority-firestore-rules",
        passed: true,
        cases: [
          "ACTIVE",
          "MISSING",
          "REAUTH_TRANSITION_NEW_EPOCH",
          "REAUTH_TRANSITION_OLD_EPOCH_DENIED",
          "REAUTH_TRANSITION_EXPIRED_DENIED",
          "EXACT_FIXTURE_ADMIN_USER_LIST",
          "TEACHER_USER_LIST",
          "STAFF_PERMISSION_USER_LIST",
          "REAL_ADMIN_USER_LIST",
          "STUDENT_USER_LIST_DENIED",
          "STAFF_WITHOUT_PERMISSION_USER_LIST_DENIED",
          "EXPIRED_SESSION_USER_LIST_DENIED",
          "EXPIRED",
          "CLOSED",
          "CORRUPT",
          "AUTH_TIME_MISMATCH",
          "OLD_PROTOCOL_DENIED",
          "OBSERVE_IDLE_EXPIRED_ALLOWED",
          "OBSERVE_CLOSED_DENIED",
          "DISABLED_IDLE_EXPIRED_ALLOWED",
          "INVALID_MODE_DENIED",
          "STALE_ENFORCE_MODE_NOT_DOWNGRADED",
          "DIRECT_SESSION_WRITE",
          "DIRECT_TRANSITION_WRITE_DENIED",
          "RECENT_ADMIN_WRITE",
          "STALE_ADMIN_WRITE_DENIED",
        ],
        productionAccess: 0,
      }),
    );
  } finally {
    await env.cleanup();
  }
};

await main();
