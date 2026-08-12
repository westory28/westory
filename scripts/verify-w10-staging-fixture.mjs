import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w10-ui-ux-staging";
const SEMESTER_ID = "2026-2";
const modes = ["dry-run", "setup", "verify", "cleanup"];
const args = process.argv.slice(2);
const value = (name) =>
  String(
    args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ||
      "",
  ).trim();
const mode = modes.find((item) => args.includes(`--${item}`));
const projectId = value("--project");
const testRunId = value("--test-run-id");
const evidenceRoot = value("--evidence-root");

assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production access is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.equal(
  modes.filter((item) => args.includes(`--${item}`)).length,
  1,
  "Choose exactly one mode.",
);
assert.match(
  testRunId,
  /^w10-[a-z0-9][a-z0-9-]{7,63}$/u,
  "A scoped W10 testRunId is required.",
);

const sha256 = (input) =>
  createHash("sha256").update(String(input), "utf8").digest("hex");
const suffix = sha256(testRunId).slice(0, 20);
const teacherUid = `w10-teacher-${suffix}`;
const studentUid = `w10-student-${suffix}`;
const teacherEmail = `w10.teacher.${suffix}@yongshin-ms.ms.kr`;
const studentEmail = `w10.student.${suffix}@yongshin-ms.ms.kr`;
const classId = `class-w10-${suffix}`;
const enrollmentId = `enr-w10-${suffix}`;
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const runPath = `w10_verification_runs/${testRunId}`;
const fixturePaths = [
  runPath,
  `users/${teacherUid}`,
  `users/${studentUid}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
];

if (mode === "dry-run") {
  console.log(
    JSON.stringify({
      suite: "w10-staging-fixture-dry-run",
      passed: true,
      projectId,
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      plannedAuthUsers: 2,
      plannedFixtureDocuments: fixturePaths.length,
      exactOwnerFence: true,
      cleanupResidualContract: [
        "auth",
        "fixture",
        "business",
        "receipt",
        "audit",
        "session",
        "token",
      ],
      businessWrites: 0,
      productionAccess: 0,
    }),
  );
  process.exit(0);
}

if (["verify", "cleanup"].includes(mode)) {
  assert.ok(evidenceRoot, "--evidence-root is required.");
  assert.equal(
    resolve(evidenceRoot),
    resolve("docs/evidence/w10-ui-ux", testRunId),
    "Evidence must stay in the exact testRunId-scoped W10 evidence directory.",
  );
  const metadataPath = resolve(evidenceRoot, "metadata.json");
  assert.equal(
    existsSync(metadataPath),
    true,
    "W10 metadata evidence is missing.",
  );
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.fixtureOwner, FIXTURE_OWNER);
  assert.equal(metadata.testRunId, testRunId);
  assert.equal(metadata.projectId, projectId);
  assert.equal(metadata.productionAccess, 0);
  assert.equal(metadata.productionMutationCount, 0);
  assert.equal(metadata.credentialValueCount, 0);
  assert.equal(metadata.tokenValueCount, 0);
}

const password = String(process.env.WESTORY_W10_STAGING_PASSWORD || "");
if (mode === "setup") {
  assert.match(
    password,
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
  );
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue, getFirestore } = requireFromFunctions(
  "firebase-admin/firestore",
);
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w10-fixture-${suffix.slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);
const toMillis = (input) => {
  if (typeof input?.toMillis === "function") return input.toMillis();
  if (input instanceof Date) return input.getTime();
  return Date.parse(String(input || ""));
};
const allowedBusinessCollections = new Set([
  "teacher_drafts",
  "teacher_bulk_jobs",
  "semester_learning_contents",
  "semester_learning_progress",
  "semester_learning_exemptions",
  "semester_learning_exemption_requests",
  "semester_schedule_events",
  "semester_attendance_sessions",
  "semester_attendance_records",
  "semester_attendance_revisions",
  "semester_notices",
  "semester_notice_deliveries",
  "semester_notice_acknowledgements",
]);

const requiredScopes = async () => {
  const [manifest, maintenance] = await db.getAll(
    db.doc(`semester_manifests/${SEMESTER_ID}`),
    db.doc("site_settings/student_maintenance"),
  );
  assert.equal(manifest.exists, true, "Staging semester manifest is missing.");
  assert.equal(manifest.data()?.status, "ACTIVE");
  assert.equal(
    maintenance.exists ? maintenance.data()?.enabled === true : false,
    false,
  );
  return Number(manifest.data()?.revision || 0);
};
const commandDocuments = async (createdAfter) => {
  const rows = [];
  for (const collection of ["command_receipts", "command_audit_events"]) {
    for (const actorUid of [teacherUid, studentUid]) {
      const snapshot = await db
        .collection(collection)
        .where("actorUid", "==", actorUid)
        .get();
      rows.push(
        ...snapshot.docs.filter(
          (item) => toMillis(item.data()?.createdAt) >= createdAfter,
        ),
      );
    }
  }
  return rows;
};
const ownedBusinessPaths = (commandDocs) =>
  [...new Set(commandDocs.flatMap((item) => item.data()?.target?.refs || []))]
    .filter((path) => {
      const [collection, id, ...rest] = String(path).split("/");
      if (!allowedBusinessCollections.has(collection)) return false;
      assert.ok(id && rest.length === 0, `Malformed target ref: ${path}`);
      return true;
    })
    .sort();
const assertOwnedBusiness = (snapshot) => {
  const data = snapshot.data() || {};
  assert.equal(data.semesterId, SEMESTER_ID);
  const actors = [
    data.ownerUid,
    data.studentUid,
    data.createdBy,
    data.updatedBy,
    data.openedBy,
    data.recordedBy,
  ].filter(Boolean);
  assert.equal(
    actors.some((actor) => [teacherUid, studentUid].includes(actor)),
    true,
    `Refusing foreign business document: ${snapshot.ref.path}`,
  );
};
const deleteDocuments = async (documents) => {
  const unique = [
    ...new Map(documents.map((item) => [item.ref.path, item])).values(),
  ];
  for (let index = 0; index < unique.length; index += 400) {
    const batch = db.batch();
    unique.slice(index, index + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  return unique.length;
};

try {
  const manifestRevision = await requiredScopes();
  if (mode === "setup") {
    const existing = await db.getAll(
      ...fixturePaths.map((path) => db.doc(path)),
    );
    assert.equal(
      existing.some((item) => item.exists),
      false,
      "Fixture path collision.",
    );
    const createdAuthUids = [];
    try {
      for (const user of [
        { uid: teacherUid, email: teacherEmail, displayName: "합성교사" },
        { uid: studentUid, email: studentEmail, displayName: "합성학생" },
      ]) {
        await auth.createUser({ ...user, password, emailVerified: true });
        createdAuthUids.push(user.uid);
        await auth.setCustomUserClaims(user.uid, {
          fixtureOwner: FIXTURE_OWNER,
          testRunId,
        });
      }
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const batch = db.batch();
      const create = (path, data) =>
        batch.create(db.doc(path), {
          ...data,
          fixtureOwner: FIXTURE_OWNER,
          testRunId,
          expiresAt,
        });
      create(`users/${teacherUid}`, {
        uid: teacherUid,
        role: "teacher",
        email: teacherEmail,
        name: "합성교사",
        teacherPortalEnabled: true,
        staffPermissions: [
          "lesson_read",
          "learning_manage",
          "attendance_manage",
        ],
      });
      create(`users/${studentUid}`, {
        uid: studentUid,
        role: "student",
        email: studentEmail,
        name: "합성학생",
        privacyAgreed: true,
        consentAgreedItems: ["privacy", "terms"],
      });
      create(`semester_classes/${classId}`, {
        classId,
        semesterId: SEMESTER_ID,
        grade: "3",
        classNumber: "1",
        displayName: "3학년 1반",
        homeroomTeacherUid: teacherUid,
        status: "ACTIVE",
      });
      create(`semester_enrollments/${enrollmentId}`, {
        enrollmentId,
        semesterId: SEMESTER_ID,
        studentUid,
        classId,
        enrollmentStatus: "ACTIVE",
        provenance: "CURRENT",
        studentNumber: "97",
        snapshot: { displayName: "합성학생", studentNumber: "97" },
      });
      create(`semester_enrollment_slots/${slotId}`, {
        slotId,
        semesterId: SEMESTER_ID,
        studentUid,
        activeEnrollmentId: enrollmentId,
        status: "ACTIVE",
      });
      create(runPath, {
        projectId,
        status: "READY",
        teacherUid,
        studentUid,
        teacherEmail,
        studentEmail,
        classId,
        enrollmentId,
        manifestRevision,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      for (const uid of createdAuthUids) {
        try {
          const user = await auth.getUser(uid);
          assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
          assert.equal(user.customClaims?.testRunId, testRunId);
          await auth.deleteUser(uid);
        } catch (rollbackError) {
          if (rollbackError?.code !== "auth/user-not-found")
            throw rollbackError;
        }
      }
      throw error;
    }
    console.log(
      JSON.stringify({
        suite: "w10-staging-fixture-setup",
        passed: true,
        projectId,
        testRunId,
        teacherUid,
        studentUid,
        teacherEmail,
        studentEmail,
        classId,
        enrollmentId,
        manifestRevision,
        productionAccess: 0,
      }),
    );
  } else {
    const run = await db.doc(runPath).get();
    assert.equal(run.exists, true, "W10 run marker is missing.");
    assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(run.data()?.testRunId, testRunId);
    const createdAfter = toMillis(run.data()?.createdAt);
    assert.equal(Number.isFinite(createdAfter), true);
    const commandDocs = await commandDocuments(createdAfter);
    const businessPaths = ownedBusinessPaths(commandDocs);
    const business = businessPaths.length
      ? await db.getAll(...businessPaths.map((path) => db.doc(path)))
      : [];
    business.filter((item) => item.exists).forEach(assertOwnedBusiness);
    if (mode === "verify") {
      const fixtures = await db.getAll(
        ...fixturePaths.map((path) => db.doc(path)),
      );
      fixtures.forEach((item) => {
        assert.equal(item.exists, true);
        assert.equal(item.data()?.fixtureOwner, FIXTURE_OWNER);
        assert.equal(item.data()?.testRunId, testRunId);
      });
      console.log(
        JSON.stringify({
          suite: "w10-staging-fixture-verify",
          passed: true,
          projectId,
          testRunId,
          commandDocuments: commandDocs.length,
          ownedBusinessDocuments: business.filter((item) => item.exists).length,
          queryMountWriteCount: 0,
          productionAccess: 0,
        }),
      );
    } else {
      const fixtures = await db.getAll(
        ...fixturePaths.map((path) => db.doc(path)),
      );
      fixtures
        .filter((item) => item.exists)
        .forEach((item) => {
          assert.equal(item.data()?.fixtureOwner, FIXTURE_OWNER);
          assert.equal(item.data()?.testRunId, testRunId);
        });
      const deletedBusinessDocuments = await deleteDocuments(
        business.filter((item) => item.exists),
      );
      const deletedCommandDocuments = await deleteDocuments(commandDocs);
      let deletedSessions = 0;
      for (const uid of [teacherUid, studentUid]) {
        const sessions = await db
          .collection(`application_sessions/${uid}/sessions`)
          .get();
        deletedSessions += await deleteDocuments(sessions.docs);
      }
      const deletedFixtureDocuments = await deleteDocuments(
        fixtures.filter((item) => item.exists),
      );
      let deletedAuthUsers = 0;
      for (const uid of [teacherUid, studentUid]) {
        try {
          const user = await auth.getUser(uid);
          assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
          assert.equal(user.customClaims?.testRunId, testRunId);
          await auth.deleteUser(uid);
          deletedAuthUsers += 1;
        } catch (error) {
          if (error?.code !== "auth/user-not-found") throw error;
        }
      }
      assert.equal(
        (await db.getAll(...fixturePaths.map((path) => db.doc(path)))).some(
          (item) => item.exists,
        ),
        false,
      );
      assert.equal((await commandDocuments(createdAfter)).length, 0);
      const residualBusiness = businessPaths.length
        ? await db.getAll(...businessPaths.map((path) => db.doc(path)))
        : [];
      assert.equal(
        residualBusiness.some((item) => item.exists),
        false,
      );
      for (const uid of [teacherUid, studentUid]) {
        assert.equal(
          (await db.collection(`application_sessions/${uid}/sessions`).get())
            .empty,
          true,
        );
        await assert.rejects(
          auth.getUser(uid),
          (error) => error?.code === "auth/user-not-found",
        );
      }
      console.log(
        JSON.stringify({
          suite: "w10-staging-fixture-cleanup",
          passed: true,
          projectId,
          testRunId,
          deletedBusinessDocuments,
          deletedCommandDocuments,
          deletedSessions,
          deletedFixtureDocuments,
          deletedAuthUsers,
          residualAuthUsers: 0,
          residualFixtureDocuments: 0,
          residualSessions: 0,
          residualBusinessDocuments: 0,
          residualReceipts: 0,
          residualAudits: 0,
          residualTokens: 0,
          productionAccess: 0,
        }),
      );
    }
  }
} finally {
  await deleteApp(app);
}
