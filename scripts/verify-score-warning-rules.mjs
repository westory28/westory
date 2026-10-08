import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";

const projectId = "demo-westory-score-warning";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Local Firestore emulator required");
const [firestoreHost, rawPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const firestorePort = Number(rawPort);
const authTime = Math.floor(Date.now() / 1000) - 10;
let testEnv;
const createClient = async (name, email) => ({
  db: testEnv.authenticatedContext(name, { email, auth_time: authTime }).firestore(),
  user: { uid: name }, email,
});

const existingStudentDoc = (uid, email) => ({
  uid,
  email,
  photoURL: "",
  role: "student",
  registrationApprovalStatus: "APPROVED",
  staffPermissions: [],
  teacherPortalEnabled: false,
  name: "기존학생",
  customNameConfirmed: true,
  studentName: "Legacy Student",
  studentGrade: "2",
  studentClass: "6",
  studentNumber: "10",
  displayName: "Legacy Display",
  nickname: "Legacy Nickname",
  customName: "Legacy Custom",
  grade: "2",
  class: "6",
  number: "10",
  privacyAgreed: true,
  privacyAgreedAt: "seed-privacy",
  consentAgreedItems: ["privacy"],
  profileIcon: "😀",
  profileEmojiId: "smile",
  createdAt: "seed-created",
  updatedAt: "seed-updated",
  lastLogin: "seed-login",
});

const newStudentDoc = (uid, email) => ({
  uid,
  email,
  photoURL: "",
  role: "student",
  staffPermissions: [],
  teacherPortalEnabled: false,
  name: "신규학생",
  grade: "1",
  class: "2",
  number: "3",
  privacyAgreed: true,
  consentAgreedItems: ["privacy", "score-warning"],
  profileIcon: "😀",
  profileEmojiId: "smile",
  scoreWarningAcknowledged: true,
  scoreWarningAcknowledgedAt: "seed-warning",
  createdAt: "seed-created",
  updatedAt: "seed-updated",
  lastLogin: "seed-login",
});

const main = async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules,
    },
  });

  await testEnv.clearFirestore();

  const existingStudent = await createClient(
    "score-warning-existing",
    "existing.student@yongshin-ms.ms.kr",
    "Password!123",
  );
  const newStudent = await createClient(
    "score-warning-new",
    "new.student@yongshin-ms.ms.kr",
    "Password!123",
  );
  const otherStudent = await createClient(
    "score-warning-other",
    "other.student@yongshin-ms.ms.kr",
    "Password!123",
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, "site_settings", "student_maintenance"), {
      enabled: false, blockedRoles: ["student"], bypassUids: [], title: "점검", message: "점검 중입니다.",
      startedAt: null, updatedAt: Timestamp.now(), updatedBy: "teacher-test", revision: 1,
    });
    await setDoc(
      doc(adminDb, "users", existingStudent.user.uid),
      existingStudentDoc(existingStudent.user.uid, existingStudent.email),
    );
    await setDoc(
      doc(adminDb, "users", otherStudent.user.uid),
      existingStudentDoc(otherStudent.user.uid, otherStudent.email),
    );
    for (const student of [existingStudent, newStudent, otherStudent]) {
      await setDoc(doc(adminDb, "application_sessions", student.user.uid, "sessions", String(authTime)), {
        schemaVersion: 2, authTime, status: "active", authorityGeneration: "w1r2-2026-08-09",
        protocolVersion: 2, sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE",
        generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
      });
    }
  });

  await assertSucceeds(
    setDoc(
      doc(existingStudent.db, "users", existingStudent.user.uid),
      {
        scoreWarningAcknowledged: true,
        scoreWarningAcknowledgedAt: "warning-updated",
        updatedAt: "updated-now",
        consentAgreedItems: ["privacy", "score-warning"],
      },
      { merge: true },
    ),
  );

  const updatedSnap = await getDoc(
    doc(existingStudent.db, "users", existingStudent.user.uid),
  );
  const updatedData = updatedSnap.data() || {};
  if (
    updatedData.profileEmojiId !== "smile" ||
    updatedData.studentName !== "Legacy Student" ||
    updatedData.scoreWarningAcknowledged !== true
  ) {
    throw new Error(
      "Existing student update did not preserve legacy profile fields or warning fields.",
    );
  }

  await assertFails(
    setDoc(
      doc(newStudent.db, "users", newStudent.user.uid),
      newStudentDoc(newStudent.user.uid, newStudent.email),
    ),
  );

  await assertFails(
    setDoc(
      doc(existingStudent.db, "users", existingStudent.user.uid),
      {
        legacyExtra: true,
        updatedAt: "invalid-extra",
      },
      { merge: true },
    ),
  );

  await assertFails(
    setDoc(
      doc(otherStudent.db, "users", existingStudent.user.uid),
      {
        scoreWarningAcknowledged: true,
        updatedAt: "cross-user-update",
      },
      { merge: true },
    ),
  );

  const performanceYear = "2026";
  const performanceSemester = "1";
  const performanceScoreId = "performance-score-1";
  const performanceScoreOtherSemesterId = "performance-score-2";
  const warningVersion = "warning-test-version";
  const warningTextHash = "abc12345";
  const scoreUpdatedAt = Timestamp.fromMillis(Date.now() - 60000);
  const signaturePayload = {
    uid: existingStudent.user.uid,
    rosterId: performanceScoreId,
    signatureName: "기존학생",
    signatureImage: "data:image/png;base64,AAAA",
    scoreUpdatedAt,
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(
      doc(
        adminDb,
        "years",
        performanceYear,
        "semesters",
        performanceSemester,
        "assessment_config",
        "performance_score",
      ),
      {
        warningText: "수행평가 점수 확인 경고",
        warningVersion,
        warningTextHash,
        updatedAt: "seed-updated",
      },
    );
    await setDoc(
      doc(
        adminDb,
        "users",
        existingStudent.user.uid,
        "performance_scores",
        performanceScoreId,
      ),
      {
        uid: existingStudent.user.uid,
        rosterId: performanceScoreId,
        academicYear: performanceYear,
        semester: performanceSemester,
        updatedAt: scoreUpdatedAt,
      },
    );
    await setDoc(
      doc(
        adminDb,
        "users",
        existingStudent.user.uid,
        "performance_scores",
        performanceScoreOtherSemesterId,
      ),
      {
        uid: existingStudent.user.uid,
        rosterId: performanceScoreOtherSemesterId,
        academicYear: performanceYear,
        semester: "2",
        updatedAt: scoreUpdatedAt,
      },
    );
  });

  await assertFails(
    setDoc(
      doc(
        existingStudent.db,
        "users",
        existingStudent.user.uid,
        "performance_scores",
        performanceScoreId,
        "confirmations",
        existingStudent.user.uid,
      ),
      signaturePayload,
    ),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(
      doc(
        adminDb,
        "users",
        existingStudent.user.uid,
        "performance_score_consents",
        "current",
      ),
      {
        uid: existingStudent.user.uid,
        academicYear: performanceYear,
        semester: performanceSemester,
        acknowledged: false,
        warningVersion: "legacy-warning-version",
        warningTextHash: "legacyhash",
        legacyExtra: true,
        acknowledgedAt: "legacy-acknowledged",
        updatedAt: "legacy-updated",
      },
    );
  });

  await assertSucceeds(
    setDoc(
      doc(
        existingStudent.db,
        "users",
        existingStudent.user.uid,
        "performance_score_consents",
        "current",
      ),
      {
        uid: existingStudent.user.uid,
        academicYear: performanceYear,
        semester: performanceSemester,
        acknowledged: true,
        warningVersion,
        warningTextHash,
        acknowledgedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    ),
  );

  await assertSucceeds(
    setDoc(
      doc(
        existingStudent.db,
        "users",
        existingStudent.user.uid,
        "performance_scores",
        performanceScoreId,
        "confirmations",
        existingStudent.user.uid,
      ),
      signaturePayload,
    ),
  );

  await assertFails(
    setDoc(
      doc(
        existingStudent.db,
        "users",
        existingStudent.user.uid,
        "performance_scores",
        performanceScoreOtherSemesterId,
        "confirmations",
        existingStudent.user.uid,
      ),
      {
        ...signaturePayload,
        rosterId: performanceScoreOtherSemesterId,
      },
    ),
  );

  const confirmationRef = doc(
    existingStudent.db,
    "users",
    existingStudent.user.uid,
    "performance_scores",
    performanceScoreId,
    "confirmations",
    existingStudent.user.uid,
  );
  // A completed signature remains immutable, even for its owner.
  await assertFails(setDoc(confirmationRef, signaturePayload));
  await assertFails(
    setDoc(doc(otherStudent.db, confirmationRef.path), {
      ...signaturePayload,
      signatureName: "다른학생",
    }),
  );

  // Old partial records must remain repairable when a field was never stored.
  for (const missingField of ["signatureImage", "signatureName"]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const incomplete = { ...signaturePayload };
      delete incomplete[missingField];
      await setDoc(doc(context.firestore(), confirmationRef.path), incomplete);
    });
    await assertSucceeds(setDoc(confirmationRef, signaturePayload));
    const storedSignature = (await getDoc(confirmationRef)).data();
    if (
      storedSignature?.signatureImage !== signaturePayload.signatureImage ||
      storedSignature?.signatureName !== signaturePayload.signatureName ||
      !storedSignature?.confirmedAt
    ) {
      throw new Error(`Signature repair did not persist ${missingField}.`);
    }
    await assertFails(setDoc(confirmationRef, signaturePayload));
  }

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), confirmationRef.path), {
      uid: existingStudent.user.uid,
      rosterId: performanceScoreId,
    });
  });
  await assertFails(
    setDoc(confirmationRef, { ...signaturePayload, signatureImage: "" }),
  );
  await assertFails(
    setDoc(confirmationRef, {
      ...signaturePayload,
      signatureImage: `data:image/png;base64,${"A".repeat(120000)}`,
    }),
  );
  await assertSucceeds(setDoc(confirmationRef, signaturePayload));

  for (const invalidScore of [
    { enteredScoreCount: 0 },
    { objectionPending: true },
    { updatedAt: Timestamp.fromMillis(scoreUpdatedAt.toMillis() + 1000) },
  ]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, confirmationRef.path), { uid: existingStudent.user.uid, rosterId: performanceScoreId });
      await setDoc(doc(adminDb, "users", existingStudent.user.uid, "performance_scores", performanceScoreId), {
        uid: existingStudent.user.uid, rosterId: performanceScoreId,
        academicYear: performanceYear, semester: performanceSemester,
        updatedAt: scoreUpdatedAt, enteredScoreCount: 1, objectionPending: false, ...invalidScore,
      });
    });
    await assertFails(setDoc(confirmationRef, signaturePayload));
  }

  console.log(
    JSON.stringify(
      {
        projectId,
        checks: [
          "existing student warning update with profileEmojiId passes",
          "legacy student profile fields do not block warning acknowledgement",
          "direct student bootstrap remains denied; server registration is required",
          "unexpected extra key remains blocked",
          "cross-user update remains blocked",
          "performance score signature requires scoped warning consent",
          "performance score consent does not authorize another semester",
          "complete signatures cannot be overwritten or changed by another student",
          "legacy signatures with a missing image or name can be repaired and read back",
          "empty and oversized signature images remain blocked",
          "zero entered score, pending objection and stale score version cannot be signed",
        ],
      },
      null,
      2,
    ),
  );

  await testEnv.cleanup();
};

main().catch(async (error) => {
  console.error(error);
  await testEnv?.cleanup();
  process.exitCode = 1;
});
