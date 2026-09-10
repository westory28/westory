import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes } from "firebase/storage";

const production = readFileSync("firestore.rules", "utf8");
const staging = readFileSync("firestore.staging.rules", "utf8");
const helper =
  /    function isTrustedW10PVisualFixtureAdmin\(\) \{[\s\S]*?\r?\n    \}/;
assert.match(production.match(helper)?.[0] || "", /return false;/);
assert.equal(
  production.replace(helper, "FIXTURE_HELPER"),
  staging.replace(helper, "FIXTURE_HELPER"),
  "Staging may differ only in the explicit fixture helper",
);
assert.equal(
  JSON.parse(readFileSync("firebase.json", "utf8")).firestore.rules,
  "firestore.rules",
);
assert.equal(
  JSON.parse(readFileSync("firebase.staging.json", "utf8")).firestore.rules,
  "firestore.staging.rules",
);
const projectId = "demo-westory-session-lesson-rules";
assert.ok(projectId.startsWith("demo-"));
const bucket = `gs://${projectId}.appspot.com`;
const authTime = Math.floor(Date.now() / 1000) - 10;
const firestorePort = Number(process.env.LESSON_TEST_FIRESTORE_PORT || 8080);
const storagePort = Number(process.env.LESSON_TEST_STORAGE_PORT || 9199);
const root = "years/2026/semesters/2";
let checks = 4;
for (const [variant, rules] of [
  ["production", production],
  ["staging", staging],
]) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: firestorePort, rules },
    storage: {
      host: "127.0.0.1",
      port: storagePort,
      rules: readFileSync("storage.rules", "utf8"),
    },
  });
  try {
    await env.clearFirestore();
    await env.clearStorage();
    const profiles = {
      teacher: {
        uid: "teacher",
        email: "teacher@yongshin-ms.ms.kr",
        role: "teacher",
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read"],
      },
      student: {
        uid: "student",
        email: "student@yongshin-ms.ms.kr",
        role: "student",
      },
      admin: { uid: "admin", email: "westoria28@gmail.com", role: "admin" },
      "w10p-visual-admin": {
        uid: "w10p-visual-admin",
        email: "w10p-visual-admin@yongshin-ms.ms.kr",
        role: "teacher",
        fixtureOwner: "w10p-visual-parity",
        fixtureId: "w10p-visual-fixture-v1",
      },
    };
    const ticket = {
      uploadId: "ticket",
      ownerUid: "teacher",
      semesterId: "2026-2",
      unitId: "unit-one",
      storagePath: "lesson_uploads/ticket/source",
      status: "PENDING",
      expiresAtMs: Date.now() + 600000,
      byteSize: 4,
      contentType: "image/png",
    };
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // clearStorage() targets the default bucket; clean this explicit test
      // bucket as well before switching production/staging rules in one run.
      for (const path of [
        "lesson_uploads/ticket/source",
        "lesson_uploads/expired/source",
      ]) {
        await deleteObject(ref(context.storage(bucket), path)).catch(
          (error) => {
            if (error.code !== "storage/object-not-found") throw error;
          },
        );
      }
      await setDoc(doc(db, "site_settings/student_maintenance"), {
        enabled: false,
        blockedRoles: ["student"],
        bypassUids: [],
        title: "점검",
        message: "점검하지 않습니다.",
        revision: 1,
        updatedAt: Timestamp.now(),
        updatedBy: "admin",
        startedAt: null,
      });
      for (const profile of Object.values(profiles)) {
        await setDoc(doc(db, `users/${profile.uid}`), profile);
        await setDoc(
          doc(db, `application_sessions/${profile.uid}/sessions/${authTime}`),
          {
            uid: profile.uid,
            authTime,
            status: "active",
            schemaVersion: 2,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            sessionRevision: "a".repeat(64),
            authorityModeAtOpen: "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(Date.now() + 600000),
            highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 600000),
          },
        );
      }
      await setDoc(doc(db, "lesson_asset_uploads/ticket"), ticket);
      await setDoc(doc(db, "lesson_asset_uploads/expired"), {
        ...ticket,
        uploadId: "expired",
        storagePath: "lesson_uploads/expired/source",
        expiresAtMs: 1,
      });
      await setDoc(doc(db, `${root}/lesson_progress/student/units/unit-one`), {
        answers: {},
        corePointFinds: ["core-one"],
      });
      for (const collection of [
        "calendar_meta",
        "notices_meta",
        "grading_plans_meta",
      ])
        await setDoc(doc(db, `${root}/${collection}/current`), { revision: 1 });
    });
    const clients = Object.fromEntries(
      Object.entries(profiles).map(([id, profile]) => [
        id,
        env.authenticatedContext(id, {
          email: profile.email,
          auth_time: authTime,
          ...(id === "w10p-visual-admin"
            ? {
                fixtureOwner: "w10p-visual-parity",
                fixtureId: "w10p-visual-fixture-v1",
                fixtureRole: "admin",
              }
            : {}),
        }),
      ]),
    );
    for (const role of ["teacher", "student", "admin"]) {
      const db = clients[role].firestore();
      await assertFails(
        setDoc(
          doc(db, `${root}/lesson_presentations/unit-one/teachers/${role}`),
          { annotation: [] },
        ),
      );
      await assertFails(
        setDoc(
          doc(
            db,
            `${root}/lesson_presentations/unit-one/teachers/${role}/classes/class-one`,
          ),
          { annotation: [] },
        ),
      );
      await assertFails(
        setDoc(doc(db, `${root}/lesson_progress/student/units/unit-one`), {
          answers: {},
        }),
      );
      await assertFails(setDoc(doc(db, "lesson_asset_uploads/ticket"), ticket));
      checks += 4;
      await assertFails(
        setDoc(doc(db, `${root}/curriculum/tree`), { tree: [] }),
      );
      await assertFails(setDoc(doc(db, "curriculum/tree"), { tree: [] }));
      checks += 2;
    }
    await assertSucceeds(
      getDoc(
        doc(
          clients.student.firestore(),
          `${root}/lesson_progress/student/units/unit-one`,
        ),
      ),
    );
    checks++;
    await assertFails(
      getDoc(doc(clients.student.firestore(), "lesson_asset_uploads/ticket")),
    );
    checks++;
    await assertSucceeds(
      getDoc(doc(clients.teacher.firestore(), "lesson_asset_uploads/ticket")),
    );
    checks++;
    const data = new Uint8Array([1, 2, 3, 4]);
    const storage = clients.teacher.storage(bucket);
    await assertFails(
      uploadBytes(
        ref(clients.student.storage(bucket), ticket.storagePath),
        data,
        { contentType: "image/png" },
      ),
    );
    checks++;
    await assertFails(
      uploadBytes(ref(storage, "lesson_uploads/expired/source"), data, {
        contentType: "image/png",
      }),
    );
    checks++;
    await assertFails(
      uploadBytes(ref(storage, ticket.storagePath), data, {
        contentType: "image/jpeg",
      }),
    );
    checks++;
    await assertFails(
      uploadBytes(ref(storage, ticket.storagePath), new Uint8Array([1]), {
        contentType: "image/png",
      }),
    );
    checks++;
    await assertFails(
      uploadBytes(ref(storage, ticket.storagePath), data, {
        contentType: "image/png",
      }),
    );
    checks++;
    await assertFails(
      uploadBytes(ref(storage, ticket.storagePath), data, {
        contentType: "image/png",
      }),
    );
    checks++;
    await assertFails(deleteObject(ref(storage, ticket.storagePath)));
    checks++;
    await env.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(bucket), ticket.storagePath), data, {
        contentType: "image/png", customMetadata: { ownerUid: "teacher" },
      });
    });
    await assertSucceeds(getBytes(ref(storage, ticket.storagePath)));
    await assertSucceeds(getBytes(ref(clients.admin.storage(bucket), ticket.storagePath)));
    await assertFails(getBytes(ref(clients.student.storage(bucket), ticket.storagePath)));
    checks += 3;
    await assertFails(
      uploadBytes(
        ref(storage, `${root}/lesson_pdfs/unit-one/page-1.png`),
        data,
        { contentType: "image/png" },
      ),
    );
    checks++;
    for (const collection of [
      "calendar_meta",
      "notices_meta",
      "grading_plans_meta",
    ]) {
      const read = getDoc(
        doc(
          clients["w10p-visual-admin"].firestore(),
          `${root}/${collection}/current`,
        ),
      );
      await (variant === "staging" ? assertSucceeds(read) : assertFails(read));
      checks++;
    }
  } finally {
    await env.cleanup();
  }
}
console.log(
  JSON.stringify({
    passed: true,
    checks,
    productionAccess: 0,
    emulatorOnly: true,
    variants: ["production", "staging"],
  }),
);
