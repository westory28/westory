// firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-session-student-access "node scripts/verify-student-access.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from "firebase/firestore";

const projectId = "demo-westory-session-student-access";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(
  process.env.FIRESTORE_EMULATOR_HOST,
  "127.0.0.1:18220",
  "Isolated emulator required; never run on production.",
);
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const api = require("./index.js");
const {
  getFirestore,
  Timestamp: AdminTimestamp,
} = require("firebase-admin/firestore");
const adminDb = getFirestore();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const authTime = Math.floor(Date.now() / 1000) - 60;
const proof = {
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const session = {
  schemaVersion: 2,
  status: "active",
  authTime,
  authorityGeneration: proof.authorityGeneration,
  protocolVersion: 2,
  sessionRevision: proof.revision,
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
};
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const email = (uid) =>
  uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`;
const client = (uid, options = {}) =>
  env
    .authenticatedContext(uid, {
      email: email(uid),
      auth_time: authTime,
      ...options,
    })
    .firestore();
const call = (name, uid = "student", data = {}) =>
  api[name].run({
    auth: { uid, token: { email: email(uid), auth_time: authTime } },
    data: { year: "2026", semester: "2", _session: proof, ...data },
  });
const check = async (name, action) => {
  await action();
  console.log(`PASS ${name}`);
};
const expectCode = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
const setMaintenance = async (enabled, bypassUids = []) =>
  adminDb.doc("site_settings/student_maintenance").set({
    enabled,
    blockedRoles: ["student"],
    bypassUids,
    title: "점검",
    message: "잠시 점검 중입니다.",
    startedAt: enabled ? AdminTimestamp.now() : null,
    updatedAt: AdminTimestamp.now(),
    updatedBy: "admin",
    revision: 1,
  });

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "site_settings/config"), {
      year: "2026",
      semester: "2",
    });
    await setDoc(doc(db, "site_settings/menu_config"), { student: [] });
    await setDoc(doc(db, "site_settings/school_config"), {
      schoolName: "검증학교",
    });
    await setDoc(doc(db, "site_settings/consent/items/public"), {
      enabled: true,
      title: "동의",
    });
    await setDoc(doc(db, "site_settings/consent/items/disabled"), {
      enabled: false,
      title: "비활성 동의",
    });
    for (const uid of [
      "student",
      "peer",
      "teacher",
      "staff",
      "pending",
      "rejected",
      "legacy",
      "no-session",
      "revoked",
      "expired",
      "observe",
      "admin",
    ]) {
      const profile = {
        uid,
        email: email(uid),
        role: ["teacher", "admin"].includes(uid)
          ? "teacher"
          : uid === "staff"
            ? "staff"
            : "student",
        customNameConfirmed: true,
        photoURL: "",
        name: "검증학생",
        grade: "2",
        class: "1",
        number: "1",
        privacyAgreed: true,
        consentAgreedItems: ["privacy"],
        profileIcon: "😀",
        profileEmojiId: "smile",
        myPageGoalScore: "90",
        myPageSubjectGoals: { history: "90" },
        scoreWarningAcknowledged: true,
        teacherPortalEnabled: false,
        staffPermissions: [],
      };
      if (uid !== "legacy")
        profile.registrationApprovalStatus =
          uid === "pending"
            ? "PENDING"
            : uid === "rejected"
              ? "REJECTED"
              : "APPROVED";
      await setDoc(doc(db, "users", uid), profile);
      await setDoc(doc(db, "users", uid, "performance_scores", "score"), {
        uid,
        score: 50,
      });
      await setDoc(doc(db, "years/2026/semesters/2/point_wallets", uid), {
        uid,
        balance: 100,
      });
      if (uid !== "no-session")
        await setDoc(
          doc(db, "application_sessions", uid, "sessions", String(authTime)),
          {
            ...session,
            status: uid === "revoked" ? "closed" : "active",
            authorityModeAtOpen: uid === "observe" ? "OBSERVE_ONLY" : "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(
              Date.now() +
                (["expired", "observe"].includes(uid) ? -60000 : 3600000),
            ),
          },
        );
    }
    const lesson = (unitId, updatedAt, extra = {}) => ({
      unitId,
      title: unitId,
      contentHtml: "[고조선] [삼국시대] [훈민정음]",
      updatedAt,
      ...extra,
    });
    await setDoc(
      doc(db, "years/2026/semesters/2/lessons/public"),
      lesson("public", 1, { isVisibleToStudents: true }),
    );
    await setDoc(
      doc(db, "years/2026/semesters/2/lessons/old"),
      lesson("hidden", 1, { isVisibleToStudents: true }),
    );
    await setDoc(
      doc(db, "years/2026/semesters/2/lessons/hidden"),
      lesson("hidden", 2, { isVisibleToStudents: false }),
    );
    await setDoc(
      doc(db, "lessons/hidden"),
      lesson("hidden", 3, { isVisibleToStudents: true }),
    );
    await setDoc(doc(db, "lessons/legacy"), lesson("legacy", 4));
    await setDoc(
      doc(db, "years/2026/semesters/2/lessons/deleted"),
      lesson("deleted", 5, { deletedAt: "deleted" }),
    );
    await setDoc(doc(db, "lessons/deleted"), lesson("deleted", 4));
  });
  await setMaintenance(false);
  await adminDb
    .doc("site_settings/semester_active")
    .set({ semesterId: "2026-2", revision: 1 });
  await adminDb
    .doc("semester_manifests/2026-2")
    .set({ semesterId: "2026-2", status: "ACTIVE", revision: 1 });
  await adminDb.doc("semester_wis_economies/2026-2").set({
    semesterId: "2026-2",
    status: "ACTIVE_OPEN",
    revision: 1,
    ledgerEntryCount: 0,
  });
  const accountId = "wisacct_" + hash("2026-2\nstudent");
  await adminDb
    .doc("student_identities/student")
    .set({ studentUid: "student", accountStatus: "ACTIVE" });
  await adminDb
    .doc(
      "semester_enrollment_slots/slot_" + hash("2026-2\nstudent").slice(0, 40),
    )
    .set({
      semesterId: "2026-2",
      studentUid: "student",
      activeEnrollmentId: "enrollment-student",
    });
  await adminDb.doc("semester_enrollments/enrollment-student").set({
    enrollmentId: "enrollment-student",
    semesterId: "2026-2",
    studentUid: "student",
    enrollmentStatus: "ACTIVE",
    classId: "class-2-1",
  });
  await adminDb
    .doc("semester_classes/class-2-1")
    .set({ semesterId: "2026-2", classId: "class-2-1", status: "ACTIVE" });
  await adminDb.doc("semester_wis_accounts/" + accountId).set({
    schemaVersion: 1,
    policyVersion: "w7-v1",
    accountId,
    semesterId: "2026-2",
    studentUid: "student",
    enrollmentId: "enrollment-student",
    classId: "class-2-1",
    status: "ACTIVE",
    revision: 1,
    balance: 100,
    earnedTotal: 100,
    rankEarnedTotal: 100,
    spentTotal: 0,
    adjustedTotal: 100,
    recentLedgerEntries: [],
  });
  const student = client("student"),
    fresh = client("fresh");
  await check(
    "public settings and authenticated own-profile/config/consent bootstrap remain available",
    async () => {
      await assertSucceeds(
        getDoc(
          doc(
            env.unauthenticatedContext().firestore(),
            "site_settings/school_config",
          ),
        ),
      );
      await assertSucceeds(
        getDoc(doc(client("no-session"), "users/no-session")),
      );
      await assertSucceeds(getDoc(doc(fresh, "users/fresh")));
      await assertSucceeds(getDoc(doc(fresh, "site_settings/config")));
      await assertSucceeds(getDoc(doc(fresh, "site_settings/menu_config")));
      await assertSucceeds(
        getDocs(
          query(
            collection(fresh, "site_settings/consent/items"),
            where("enabled", "==", true),
          ),
        ),
      );
      await assertFails(
        getDoc(doc(fresh, "site_settings/consent/items/disabled")),
      );
      const profile = {
        uid: "fresh",
        email: email("fresh"),
        role: "student",
        teacherPortalEnabled: false,
        staffPermissions: [],
      };
      await assertFails(setDoc(doc(fresh, "users/fresh"), profile));
      await assertFails(
        setDoc(doc(fresh, "users/fresh"), {
          ...profile,
          registrationApprovalStatus: "APPROVED",
        }),
      );
      await assertSucceeds(
        setDoc(doc(fresh, "users/fresh"), {
          ...profile,
          registrationApprovalStatus: "PENDING",
        }),
      );
    },
  );
  await check(
    "approved current sessions and existing legacy approvals keep own access; peer data stays private",
    async () => {
      for (const uid of ["student", "legacy", "observe"])
        await assertSucceeds(
          getDoc(doc(client(uid), `users/${uid}/performance_scores/score`)),
        );
      await assertSucceeds(
        updateDoc(doc(student, "users/student"), {
          photoURL: "",
          lastLogin: "now",
        }),
      );
      await assertFails(getDoc(doc(student, "users/peer")));
      await assertFails(
        getDoc(doc(student, "users/peer/performance_scores/score")),
      );
      await assertFails(
        getDoc(doc(student, "years/2026/semesters/2/point_wallets/peer")),
      );
      await assertFails(
        updateDoc(doc(student, "users/student"), { role: "teacher" }),
      );
      await assertFails(
        updateDoc(
          doc(student, "years/2026/semesters/2/point_wallets/student"),
          { balance: 9999 },
        ),
      );
    },
  );
  await check(
    "missing/revoked/expired sessions and pending/rejected registration cannot read private records",
    async () => {
      for (const uid of [
        "no-session",
        "revoked",
        "expired",
        "pending",
        "rejected",
      ]) {
        await assertFails(
          getDoc(doc(client(uid), `users/${uid}/performance_scores/score`)),
        );
        await assertSucceeds(getDoc(doc(client(uid), `users/${uid}`)));
      }
      await assertFails(
        getDoc(
          doc(
            client("student", { email: "outside@example.com" }),
            "users/student/performance_scores/score",
          ),
        ),
      );
    },
  );
  await check(
    "maintenance blocks student data and callables while retaining teachers and explicit bypass",
    async () => {
      await setMaintenance(true);
      await assertFails(
        getDoc(doc(student, "users/student/performance_scores/score")),
      );
      await assertSucceeds(
        getDoc(
          doc(client("teacher"), "users/student/performance_scores/score"),
        ),
      );
      await expectCode(call("getWeplayLobby"), "permission-denied");
      await expectCode(call("getStudentVisibleLessons"), "permission-denied");
      await setMaintenance(true, ["student"]);
      await assertSucceeds(
        getDoc(doc(student, "users/student/performance_scores/score")),
      );
      await call("getStudentVisibleLessons");
      await adminDb
        .doc("site_settings/student_maintenance")
        .set({ enabled: false });
      await assertFails(
        getDoc(doc(student, "users/student/performance_scores/score")),
      );
      await setMaintenance(false);
    },
  );
  await check(
    "student lessons are server-filtered with newest scoped hidden/deleted precedence and legacy fallback",
    async () => {
      await assertFails(
        getDoc(doc(student, "years/2026/semesters/2/lessons/hidden")),
      );
      await assertFails(
        getDocs(collection(student, "years/2026/semesters/2/lessons")),
      );
      await assertSucceeds(
        getDocs(
          collection(client("teacher"), "years/2026/semesters/2/lessons"),
        ),
      );
      const result = await call("getStudentVisibleLessons");
      assert.deepEqual(
        result.scopedLessons.map((row) => row.unitId),
        ["public"],
      );
      assert.deepEqual(
        result.legacyLessons.map((row) => row.unitId),
        ["legacy"],
      );
      assert.equal(result.scopedLessons[0].semesterRevision, 1);
      await adminDb
        .doc("years/2026/semesters/2/lessons/class-only")
        .set({
          unitId: "class-only",
          title: "다른 반",
          contentHtml: "비공개",
          assignedClassIds: ["class-other"],
          contentRevision: 2,
        });
      await adminDb
        .doc("lessons/class-only")
        .set({ unitId: "class-only", title: "과거 공개", contentHtml: "과거" });
      assert.equal(
        (await call("getStudentVisibleLessons")).scopedLessons.some(
          (row) => row.unitId === "class-only",
        ),
        false,
      );
      assert.equal(
        (await call("getStudentVisibleLessons")).legacyLessons.some(
          (row) => row.unitId === "class-only",
        ),
        false,
      );
      await adminDb
        .doc("years/2026/semesters/2/lessons/class-only")
        .update({ assignedClassIds: ["class-2-1"] });
      assert.equal(
        (await call("getStudentVisibleLessons")).scopedLessons.find(
          (row) => row.unitId === "class-only",
        ).contentRevision,
        2,
      );
      for (const [path, field, invalid, valid] of [
        ["semester_manifests/2026-2", "revision", 2, 1],
        ["semester_manifests/2026-2", "status", "ARCHIVED", "ACTIVE"],
        [
          "semester_enrollment_slots/slot_" +
            hash("2026-2\nstudent").slice(0, 40),
          "studentUid",
          "peer",
          "student",
        ],
        [
          "semester_enrollments/enrollment-student",
          "enrollmentStatus",
          "INACTIVE",
          "ACTIVE",
        ],
        ["semester_classes/class-2-1", "status", "CLOSED", "ACTIVE"],
      ]) {
        await adminDb.doc(path).update({ [field]: invalid });
        await expectCode(call("getStudentVisibleLessons"), "permission-denied");
        await adminDb.doc(path).update({ [field]: valid });
      }
      await adminDb.doc("years/2026/semesters/2/lessons/class-only").delete();
      await adminDb.doc("lessons/class-only").delete();
      await expectCode(
        call("getStudentVisibleLessons", "student", { year: "2025" }),
        "failed-precondition",
      );
      await expectCode(
        call("getStudentVisibleLessons", "pending"),
        "permission-denied",
      );
      await expectCode(
        call("getStudentVisibleLessons", "no-session"),
        "unauthenticated",
      );
    },
  );
  await check(
    "ThinkCloud writes require command authority and anonymous students cannot read raw author identities",
    async () => {
      const prefix = "years/2026/semesters/2/think_cloud_sessions/test-session";
      await adminDb
        .doc(prefix)
        .set({
          title: "생각모아",
          targetGrade: "2",
          targetClass: "1",
          status: "active",
        });
      await adminDb
        .doc(prefix + "/responses/response")
        .set({ uid: "peer", displayName: "비공개 이름", textRaw: "고조선" });
      await assertFails(getDoc(doc(student, prefix + "/responses/response")));
      await assertSucceeds(
        getDoc(doc(client("teacher"), prefix + "/responses/response")),
      );
      await assertFails(
        setDoc(doc(student, prefix + "/responses/new"), {
          uid: "student",
          textRaw: "고조선",
        }),
      );
      await assertFails(
        setDoc(
          doc(client("admin"), prefix),
          { title: "직접 변경" },
          { merge: true },
        ),
      );
      await assertFails(
        setDoc(
          doc(
            client("admin"),
            "years/2026/semesters/2/think_cloud_state/class-2-1",
          ),
          { activeSessionId: "test-session" },
        ),
      );
    },
  );
  await check(
    "Weplay callable checks session proof and registration before lobby/start/guide",
    async () => {
      for (const name of [
        "getWeplayLobby",
        "startWeplayGame",
        "completeWeplayGuide",
      ]) {
        await expectCode(call(name, "pending"), "permission-denied");
        await expectCode(call(name, "no-session"), "unauthenticated");
        await expectCode(call(name, "revoked"), "unauthenticated");
        await expectCode(
          call(name, "student", {
            _session: { ...proof, revision: "b".repeat(64) },
          }),
          "unauthenticated",
        );
      }
      const lobby = await call("getWeplayLobby");
      assert.ok(lobby.wordCount >= 3);
      const game = await call("startWeplayGame", "student", {
        mode: "practice",
        difficulty: "medium",
        requestKey: "approved-access",
      });
      assert.equal(game.status, "active");
      assert.equal(
        (
          await call("completeWeplayGuide", "student", {
            accountUid: "student",
          })
        ).guideCompleted,
        true,
      );
    },
  );
  await check(
    "canonical attendance, concurrent game debit/reward/rank settlement share one balance and never repay",
    async () => {
      const prefix = "years/2026/semesters/2";
      const {
        DEFAULT_POLICY,
        PERIOD_SETTLEMENT_DELAY_MS,
      } = require("./weplayCore");
      const get = async (path) => (await adminDb.doc(path).get()).data();
      const balance = async () =>
        (await get("semester_wis_accounts/" + accountId)).balance;
      const player = await get(prefix + "/weplay_players/student");
      await call("finishWeplayGame", "student", {
        sessionId: player.activeSessionId,
        exitEarly: true,
      });
      await adminDb
        .doc("users/student")
        .update({ grade: "2", class: "1", number: "1" });
      await adminDb
        .doc(prefix + "/point_policies/current")
        .set({ attendanceDaily: 75, attendanceMonthlyBonus: 1000 });
      await adminDb
        .doc(prefix + "/weplay_policies/current")
        .set(DEFAULT_POLICY);
      const attendance = await Promise.all([
        call("checkStudentAttendance"),
        call("checkStudentAttendance"),
        call("checkStudentAttendance"),
      ]);
      assert.equal(
        attendance.reduce((sum, row) => sum + row.totalAwarded, 0),
        75,
      );
      assert.equal(await balance(), 175);
      assert.equal((await call("getWeplayLobby")).balance, 175);
      const starts = await Promise.all(
        Array.from({ length: 5 }, () =>
          call("startWeplayGame", "student", {
            mode: "challenge",
            difficulty: "medium",
            requestKey: "canonical-concurrent",
          }),
        ),
      );
      assert.equal(new Set(starts.map((row) => row.id)).size, 1);
      assert.equal(await balance(), 173);
      assert.equal(
        (await get(prefix + "/weplay_players/student")).challengeUsed,
        1,
      );
      const game = starts[0];
      await expectCode(
        call("finishWeplayGame", "peer", { sessionId: game.id }),
        "permission-denied",
      );
      const endsAtMs = Date.now() - 1000;
      await adminDb.doc(prefix + "/weplay_sessions/" + game.id).update({
        acceptedWordIds: game.words.map((word) => word.id),
        acceptedEvents: game.words.map((word) => ({
          wordId: word.id,
          elapsedMs: word.spawnAtMs + 500,
        })),
        startsAtMs: endsAtMs - (game.endsAtMs - game.startsAtMs),
        endsAtMs,
      });
      const finishes = await Promise.all(
        Array.from({ length: 3 }, () =>
          call("finishWeplayGame", "student", {
            sessionId: game.id,
            score: 999999,
            reward: 999999,
          }),
        ),
      );
      assert.equal(finishes[0].correctCount, 60);
      assert.equal(finishes[0].reward, 5);
      finishes.forEach((row) => assert.deepEqual(row, finishes[0]));
      assert.equal(await balance(), 178);
      const periodId = (await get(prefix + "/weplay_meta/current")).periodId;
      await adminDb
        .doc(prefix + "/weplay_periods/" + periodId)
        .update({ endsAtMs: Date.now() - PERIOD_SETTLEMENT_DELAY_MS - 10000 });
      await adminDb
        .doc("weplay_period_queue/" + hash("2026:2:" + periodId))
        .update({ dueAtMs: Date.now() - 1 });
      await Promise.all([
        api.settleWeplayOnSchedule.run({}),
        api.settleWeplayOnSchedule.run({}),
      ]);
      await api.settleWeplayOnSchedule.run({});
      assert.equal(await balance(), 188);
      assert.equal(
        (await get("semester_wis_balances/" + accountId)).balance,
        188,
      );
      assert.equal(
        (await get("semester_wis_rankings/" + accountId)).balance,
        188,
      );
      assert.equal(
        (await get(prefix + "/point_wallets/student")).balance,
        100,
        "Stale legacy wallet is never used or modified.",
      );
      const canonicalLedger = await adminDb
        .collection("semester_wis_ledger")
        .where("studentUid", "==", "student")
        .get();
      assert.equal(canonicalLedger.size, 4);
      for (const entry of canonicalLedger.docs) {
        const ledger = entry.data();
        assert.equal(typeof ledger.receiptId, "string");
        assert.equal(
          (await adminDb.doc(ledger.receiptId).get()).exists,
          true,
          `${ledger.activityType} ledger must reference its actual receipt.`,
        );
      }
      assert.equal(
        (await get("semester_wis_economies/2026-2")).ledgerEntryCount,
        4,
      );
      assert.equal((await call("getWeplayLobby")).balance, 188);
      await adminDb
        .doc(prefix + "/weplay_policies/current")
        .set({ ...DEFAULT_POLICY, dailyChallengeLimit: 1 });
      await expectCode(
        call("startWeplayGame", "student", {
          mode: "challenge",
          difficulty: "spicy",
          requestKey: "canonical-daily-cap",
        }),
        "resource-exhausted",
      );
      assert.equal(await balance(), 188);
    },
  );
  console.log("Student access verification: all groups passed.");
} finally {
  await env.cleanup();
  const { getApps, deleteApp } = require("firebase-admin/app");
  await Promise.all(getApps().map(deleteApp));
}
