import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  clientQuery,
  collections as names,
  kinds,
} from "./score-request-client-fixture.mjs";

const projectId = "demo-westory-score-requests";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18220");
setLogLevel("silent");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 30;
const adminEmail = "westoria28@gmail.com"; // Designated admin branch of the local rules.
const clients = {};
const pathFor = (name, semester = "2") =>
  `years/2026/semesters/${semester}/${name}`;
const requests = [
  ["own", { uid: "student-a", scoreKind: "performance" }],
  ["written", { uid: "student-b", scoreKind: "written_exam_essay" }],
  ["legacy", { uid: "student-b" }],
  ["missing-owner", { scoreKind: "performance" }],
];
const privileged = (action) =>
  env.withSecurityRulesDisabled((context) => action(context.firestore()));
const maintenance = (enabled, count) =>
  privileged((db) =>
    setDoc(doc(db, "site_settings/student_maintenance"), {
      enabled,
      blockedRoles: ["student"],
      bypassUids: Array.from(
        { length: count },
        (_, index) => `synthetic-bypass-${index}`,
      ),
      title: "점검",
      message: "검증 중",
      startedAt: enabled ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
      updatedBy: "admin",
      revision: 1,
    }),
  );
const list = (actor, name, kind, semester) =>
  getDocsFromServer(clientQuery(clients[actor], name, kind, semester));
const denied = (operation) =>
  assert.rejects(operation, { code: "permission-denied" });

try {
  await env.clearFirestore();
  await privileged(async (db) => {
    for (const [uid, role] of Object.entries({
      admin: "teacher",
      teacher: "teacher",
      "student-a": "student",
      "student-b": "student",
      staff: "staff",
      pending: "teacher",
      expired: "teacher",
    })) {
      clients[uid] = env
        .authenticatedContext(uid, {
          email: uid === "admin" ? adminEmail : `${uid}@yongshin-ms.ms.kr`,
          auth_time: authTime,
        })
        .firestore();
      await setDoc(doc(db, `users/${uid}`), {
        role,
        registrationApprovalStatus: uid === "pending" ? "PENDING" : "APPROVED",
        teacherPortalEnabled: true,
        staffPermissions: ["quiz_read"],
      });
      await setDoc(
        doc(db, `application_sessions/${uid}/sessions/${authTime}`),
        {
          schemaVersion: 2,
          status: "active",
          authTime,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "a".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(
            Date.now() + (uid === "expired" ? -10000 : 3600000),
          ),
        },
      );
    }
    for (const name of names) {
      for (const [id, data] of requests)
        await setDoc(doc(db, pathFor(name), id), {
          ...data,
          requestedAt: Timestamp.now(),
        });
    }
  });
  clients.anon = env.unauthenticatedContext().firestore();
  const student = "student-a";
  const scoreId = "signature-rule-fixture";
  const scorePath = `users/${student}/performance_scores/${scoreId}`;
  const signaturePath = `${scorePath}/confirmations/${student}`;
  const siblingId = "second-signature-rule-fixture";
  const siblingPath = `users/${student}/performance_scores/${siblingId}`;
  const signature = (version) => ({
    uid: student,
    rosterId: scoreId,
    signatureName: "검증학생",
    signatureImage: "data:image/png;base64,YQ==",
    scoreUpdatedAt: version,
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const version = Timestamp.fromMillis(Date.now() - 5000);
  const changedVersion = Timestamp.fromMillis(Date.now());
  await privileged(async (db) => {
    const score = {
      uid: student,
      academicYear: "2026",
      semester: "2",
      enteredScoreCount: 1,
      updatedAt: version,
    };
    await setDoc(doc(db, scorePath), { ...score, rosterId: scoreId });
    await setDoc(doc(db, siblingPath), { ...score, rosterId: siblingId });
  });
  await maintenance(false, 20);
  await setDoc(
    doc(
      clients[student],
      `users/${student}/performance_score_consents/current`,
    ),
    {
      uid: student,
      academicYear: "2026",
      semester: "2",
      acknowledged: true,
      warningVersion: "default-20260609",
      warningTextHash: "fixture",
      acknowledgedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
  const signatureRef = doc(clients[student], signaturePath);
  const batch = writeBatch(clients[student]);
  batch.set(signatureRef, signature(version));
  batch.set(doc(clients[student], siblingPath, "confirmations", student), {
    ...signature(version),
    rosterId: siblingId,
  });
  await batch.commit();
  await denied(setDoc(signatureRef, signature(version)));
  await privileged((db) =>
    updateDoc(doc(db, scorePath), { updatedAt: changedVersion }),
  );
  await denied(setDoc(signatureRef, signature(version)));
  await setDoc(signatureRef, signature(changedVersion));
  await privileged((db) => deleteDoc(doc(db, signaturePath)));
  await maintenance(true, 20);
  await denied(setDoc(signatureRef, signature(changedVersion)));
  await privileged((db) =>
    updateDoc(doc(db, "site_settings/student_maintenance"), {
      bypassUids: [
        student,
        ...Array.from({ length: 19 }, (_, n) => `synthetic-bypass-${n}`),
      ],
    }),
  );
  await setDoc(signatureRef, signature(changedVersion));
  await privileged((db) => deleteDoc(doc(db, signaturePath)));
  await denied(
    setDoc(doc(clients["student-b"], signaturePath), signature(changedVersion)),
  );
  await privileged((db) =>
    updateDoc(doc(db, "site_settings/student_maintenance"), {
      bypassUids: [student, 12],
    }),
  );
  await denied(setDoc(signatureRef, signature(changedVersion)));
  await maintenance(false, 20);
  for (const profile of [
    { role: "staff" },
    { role: "teacher" },
    { role: "student", enrollmentStatus: "transferred" },
    {
      role: "student",
      enrollmentStatus: "active",
      registrationApprovalStatus: "PENDING",
    },
  ]) {
    await privileged((db) => updateDoc(doc(db, `users/${student}`), profile));
    await denied(setDoc(signatureRef, signature(changedVersion)));
  }
  await privileged((db) =>
    updateDoc(doc(db, `users/${student}`), {
      registrationApprovalStatus: "APPROVED",
    }),
  );
  const sessionPath = `application_sessions/${student}/sessions/${authTime}`;
  await privileged((db) =>
    updateDoc(doc(db, sessionPath), {
      generalExpiresAt: Timestamp.fromMillis(1),
    }),
  );
  await denied(setDoc(signatureRef, signature(changedVersion)));
  await privileged((db) =>
    updateDoc(doc(db, sessionPath), {
      generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    }),
  );
  console.log(
    "PASS authorized score signature creation/repair, exact version, blocked maintenance and owner boundaries",
  );
  // Frozen exam papers contain answer keys and are server-only, including for
  // privileged browser clients. Operational IAM writes are tested separately.
  const paperPath = "semester_assessment_papers/synthetic-private-paper";
  await privileged((db) => setDoc(doc(db, paperPath), {
    semesterId: "2026-2", source: { answerKey: [{ id: "q1", answer: "A" }] },
  }));
  for (const actor of ["anon", "student-a", "teacher", "admin"]) {
    await denied(getDocFromServer(doc(clients[actor], paperPath)));
    await denied(getDocsFromServer(collection(clients[actor], "semester_assessment_papers")));
    await denied(setDoc(doc(clients[actor], paperPath), { answerKey: [] }));
  }
  console.log("PASS frozen exam papers: anonymous/student/teacher/admin browser get/list/write denied (12 assertions)");
  for (const [enabled, count] of [
    [false, 0],
    [false, 1],
    [false, 20],
    [true, 20],
  ]) {
    await maintenance(enabled, count);
    for (const actor of ["admin", "teacher"]) {
      for (const name of names) {
        for (const kind of kinds) {
          const snapshot = await list(actor, name, kind);
          const expected =
            kind === "performance" ? requests.map(([id]) => id) : ["written"];
          assert.deepEqual(
            snapshot.docs.map((entry) => entry.id).sort(),
            expected.sort(),
          );
          assert.equal((await list(actor, name, kind, "1")).empty, true);
        }
      }
    }
    console.log(
      `PASS admin/teacher populated and empty score request lists (maintenance=${enabled}, bypass=${count})`,
    );
  }
  for (const name of names) {
    await denied(
      getDocsFromServer(
        query(
          collection(clients["student-a"], pathFor(name)),
          where("uid", "==", "student-a"),
        ),
      ),
    );
  }
  await maintenance(false, 20);
  for (const name of names) {
    const path = pathFor(name);
    for (const actor of ["student-a", "staff", "expired", "pending", "anon"])
      for (const kind of kinds) await denied(list(actor, name, kind));
    const owned = await getDocsFromServer(
      query(
        collection(clients["student-a"], path),
        where("uid", "==", "student-a"),
      ),
    );
    assert.deepEqual(
      owned.docs.map((entry) => entry.id),
      ["own"],
    );
    await denied(getDocFromServer(doc(clients["student-a"], path, "written")));
    await denied(
      getDocFromServer(doc(clients["student-a"], path, "missing-owner")),
    );
    await denied(
      updateDoc(doc(clients["student-a"], path, "own"), { status: "accepted" }),
    );
    await denied(
      setDoc(doc(clients.teacher, path, "bypass"), { uid: "student-a" }),
    );
    await denied(deleteDoc(doc(clients.teacher, path, "own")));
  }
  await denied(
    updateDoc(doc(clients.teacher, pathFor(names[0]), "own"), {
      status: "accepted",
    }),
  );
  await updateDoc(doc(clients.teacher, pathFor(names[1]), "own"), {
    status: "reviewed",
  });
  await privileged((db) =>
    setDoc(doc(db, "site_settings/student_maintenance"), { enabled: false }),
  );
  for (const name of names) await denied(list("admin", name, "performance"));
  console.log(
    "PASS owner-only access, blocked sessions/roles/maintenance, and review write boundaries",
  );
} finally {
  await env.cleanup();
}
