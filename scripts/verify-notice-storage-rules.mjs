// Run only through the dedicated demo emulators:
// firebase emulators:exec --only firestore,storage --config firebase.notice-storage-test.json --project demo-westory-notice-storage "node scripts/verify-notice-storage-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-westory-notice-storage";
const bucket = `gs://${projectId}.firebasestorage.app`;
const firestoreHost = "127.0.0.1";
const firestorePort = 8186;
const storageHost = "127.0.0.1";
const storagePort = 9296;
const noticeRoot = "years/2026/semesters/2/notice_images";
const image = new Uint8Array(64);
const imageMetadata = { contentType: "image/webp" };
const authTime = Math.floor(Date.now() / 1000) - 60;
const checks = [];

const requireDemoEmulators = () => {
  assert.equal(
    process.env.FIRESTORE_EMULATOR_HOST,
    `${firestoreHost}:${firestorePort}`,
    "Start the dedicated Firestore emulator; production access is prohibited.",
  );
  assert.equal(
    process.env.FIREBASE_STORAGE_EMULATOR_HOST,
    `${storageHost}:${storagePort}`,
    "Start the dedicated Storage emulator; production access is prohibited.",
  );
  for (const name of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) {
    if (process.env[name]) assert.equal(process.env[name], projectId);
  }
};

const main = async () => {
  requireDemoEmulators();
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      // All fixture writes use withSecurityRulesDisabled. Cross-service reads
      // must still work without exposing session documents to client callers.
      rules:
        "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",
    },
    storage: {
      host: storageHost,
      port: storagePort,
      rules: readFileSync(resolve("storage.rules"), "utf8"),
    },
  });
  const profiles = [
    { uid: "admin", email: "westoria28@gmail.com", role: "teacher" },
    { uid: "teacher", role: "teacher" },
    { uid: "student", role: "student" },
    {
      uid: "staff",
      role: "staff",
      teacherPortalEnabled: true,
      staffPermissions: ["lesson_read", "point_manage"],
    },
    { uid: "no-session", role: "teacher", session: false },
    { uid: "expired", role: "teacher", expiresAt: Date.now() - 60_000 },
    { uid: "revoked", role: "teacher", sessionStatus: "revoked" },
    {
      uid: "unapproved",
      role: "teacher",
      registrationApprovalStatus: "PENDING",
    },
    { uid: "external", role: "teacher", email: "external@example.com" },
  ];
  const clients = {};
  const check = async (label, operation, allowed) => {
    if (allowed) await assertSucceeds(operation());
    else await assertFails(operation());
    checks.push(label);
  };
  const pathFor = (name) => `${noticeRoot}/${name}/notice.webp`;
  const fixturePath = pathFor("visible-fixture");

  try {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const profile of profiles) {
        const email = profile.email || `${profile.uid}@yongshin-ms.ms.kr`;
        await setDoc(doc(db, "users", profile.uid), {
          role: profile.role,
          email,
          registrationApprovalStatus:
            profile.registrationApprovalStatus || "APPROVED",
          teacherPortalEnabled: profile.teacherPortalEnabled || false,
          staffPermissions: profile.staffPermissions || [],
        });
        if (profile.session !== false) {
          await setDoc(
            doc(
              db,
              "application_sessions",
              profile.uid,
              "sessions",
              String(authTime),
            ),
            {
              status: profile.sessionStatus || "active",
              authTime,
              schemaVersion: 2,
              authorityGeneration: "w1r2-2026-08-09",
              protocolVersion: 2,
              sessionRevision: "a".repeat(64),
              authorityModeAtOpen: "ENFORCE",
              generalExpiresAt: Timestamp.fromMillis(
                profile.expiresAt || Date.now() + 3_600_000,
              ),
            },
          );
        }
        clients[profile.uid] = testEnv
          .authenticatedContext(profile.uid, {
            email,
            auth_time: authTime,
          })
          .storage(bucket);
      }
      await uploadBytes(
        ref(context.storage(bucket), fixturePath),
        image,
        imageMetadata,
      );
    });
    clients.unauthenticated = testEnv.unauthenticatedContext().storage(bucket);

    for (const uid of ["admin", "teacher"]) {
      const object = ref(clients[uid], pathFor(`${uid}-lifecycle`));
      await check(
        `${uid}: direct create denied; callable required`,
        () => uploadBytes(object, new Uint8Array(680 * 1024), imageMetadata),
        false,
      );
      await check(
        `${uid}: read image metadata`,
        () => getMetadata(ref(clients[uid], fixturePath)),
        true,
      );
      await check(
        `${uid}: direct replacement denied`,
        () => uploadBytes(ref(clients[uid], fixturePath), image, imageMetadata),
        false,
      );
      await check(
        `${uid}: direct deletion denied`,
        () => deleteObject(ref(clients[uid], fixturePath)),
        false,
      );

      await check(
        `${uid}: reject exact 700 KiB`,
        () => uploadBytes(object, new Uint8Array(700 * 1024), imageMetadata),
        false,
      );
      await check(
        `${uid}: reject more than 700 KiB`,
        () => uploadBytes(object, new Uint8Array(701 * 1024), imageMetadata),
        false,
      );
      await check(
        `${uid}: reject non-image`,
        () => uploadBytes(object, image, { contentType: "application/pdf" }),
        false,
      );
      await check(
        `${uid}: reject non-image replacement`,
        () =>
          uploadBytes(ref(clients[uid], fixturePath), image, {
            contentType: "text/plain",
          }),
        false,
      );
    }

    for (const uid of ["student", "staff"]) {
      await check(
        `${uid}: read image`,
        () => getMetadata(ref(clients[uid], fixturePath)),
        true,
      );
      await check(
        `${uid}: reject create`,
        () =>
          uploadBytes(ref(clients[uid], pathFor(uid)), image, imageMetadata),
        false,
      );
      await check(
        `${uid}: reject replacement`,
        () => uploadBytes(ref(clients[uid], fixturePath), image, imageMetadata),
        false,
      );
      await check(
        `${uid}: reject deletion`,
        () => deleteObject(ref(clients[uid], fixturePath)),
        false,
      );
    }

    for (const uid of [
      "unauthenticated",
      "external",
      "no-session",
      "expired",
      "revoked",
      "unapproved",
    ]) {
      await check(
        `${uid}: reject read`,
        () => getMetadata(ref(clients[uid], fixturePath)),
        false,
      );
      await check(
        `${uid}: reject create`,
        () =>
          uploadBytes(ref(clients[uid], pathFor(uid)), image, imageMetadata),
        false,
      );
      await check(
        `${uid}: reject replacement`,
        () => uploadBytes(ref(clients[uid], fixturePath), image, imageMetadata),
        false,
      );
      await check(
        `${uid}: reject deletion`,
        () => deleteObject(ref(clients[uid], fixturePath)),
        false,
      );
    }

    // Existing transport-only destinations stay closed to direct client writes.
    // The hall-of-fame path overlaps the existing admin interface rule, so this
    // regression checks its teacher denial without changing that existing policy.
    const serverPaths = [
      "lesson_uploads/fixture/source",
      "map-resources/fixture/map.webp",
      "lesson_pdfs/fixture/lesson.webp",
      "years/2026/semesters/2/lesson_pdfs/fixture/lesson.webp",
      "years/2026/semesters/2/lesson_footnotes/fixture/footnote.webp",
      "years/2026/semesters/2/point_products/fixture/product.webp",
      "source-archive/fixture/incoming/source.webp",
      "source-archive/fixture/revision/processed.webp",
    ];
    for (const uid of ["admin", "teacher"]) {
      for (const path of serverPaths) {
        await check(
          `${uid}: server-only ${path}`,
          () => uploadBytes(ref(clients[uid], path), image, imageMetadata),
          false,
        );
      }
    }
    await check(
      "teacher: hall-of-fame upload remains denied",
      () =>
        uploadBytes(
          ref(
            clients.teacher,
            "site-settings/interface/hall-of-fame/fixture.webp",
          ),
          image,
          imageMetadata,
        ),
      false,
    );
    await check(
      "teacher: legacy notice path remains denied",
      () =>
        uploadBytes(
          ref(clients.teacher, "notice_images/fixture/notice.webp"),
          image,
          imageMetadata,
        ),
      false,
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
        {
          enabled: true,
          blockedRoles: ["student"],
          bypassUids: ["synthetic-maintenance-bypass"],
          title: "점검 중",
          message: "잠시 후 다시 접속해 주세요.",
          startedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          updatedBy: "admin",
          revision: 1,
        },
      );
    });
    await check(
      "maintenance: student read denied",
      () => getMetadata(ref(clients.student, fixturePath)),
      false,
    );
    await check(
      "maintenance: admin direct upload denied",
      () =>
        uploadBytes(
          ref(clients.admin, pathFor("maintenance-admin")),
          image,
          imageMetadata,
        ),
      false,
    );
    for (const uid of ["admin", "teacher"]) {
      await check(
        `maintenance: ${uid} read preserved`,
        () => getMetadata(ref(clients[uid], fixturePath)),
        true,
      );
      await check(
        `maintenance: ${uid} direct writes denied`,
        () =>
          uploadBytes(
            ref(clients[uid], pathFor(`maintenance-${uid}`)),
            image,
            imageMetadata,
          ),
        false,
      );
    }
    console.log(
      JSON.stringify({ projectId, passed: checks.length, checks }, null, 2),
    );
  } finally {
    await testEnv.clearStorage();
    await testEnv.clearFirestore();
    await testEnv.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
