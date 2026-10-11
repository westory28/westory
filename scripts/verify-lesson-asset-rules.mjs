// firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-session-student-access "node scripts/verify-lesson-asset-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
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
  "Isolated local emulator required; never run on production.",
);
const authTime = Math.floor(Date.now() / 1000) - 60;
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
  },
});
const email = (uid) =>
  uid === "asset-admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`;
const client = (uid, token = {}) =>
  env
    .authenticatedContext(uid, {
      email: email(uid),
      auth_time: authTime,
      ...token,
    })
    .firestore();
const ticket = (db, uid, kind = "PDF") =>
  doc(db, "lesson_asset_uploads", `${uid}-${kind}`);
const check = async (label, action) => {
  await action();
  console.log(`PASS ${label}`);
};
const users = [
  "asset-teacher",
  "asset-peer",
  "asset-admin",
  "asset-student",
  "asset-staff",
  "asset-expired",
  "asset-revoked",
  "asset-no-session",
  "asset-pending",
  "asset-rejected",
];

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of users) {
      await setDoc(doc(db, "users", uid), {
        role:
          uid === "asset-student"
            ? "student"
            : uid === "asset-staff"
              ? "staff"
              : "teacher",
        teacherPortalEnabled: true,
        staffPermissions: ["lesson_read", "lesson_manage"],
        registrationApprovalStatus:
          uid === "asset-pending"
            ? "PENDING"
            : uid === "asset-rejected"
              ? "REJECTED"
              : "APPROVED",
      });
      if (uid !== "asset-no-session") {
        await setDoc(
          doc(db, "application_sessions", uid, "sessions", String(authTime)),
          {
            schemaVersion: 2,
            status: uid === "asset-revoked" ? "closed" : "active",
            authTime,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            sessionRevision: "a".repeat(64),
            authorityModeAtOpen: "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(
              Date.now() + (uid === "asset-expired" ? -60000 : 3600000),
            ),
          },
        );
      }
      for (const kind of ["PDF", "PAGE", "FOOTNOTE"]) {
        await setDoc(ticket(db, uid, kind), {
          ownerUid: uid,
          kind,
          status: "PENDING",
          semesterId: "2026-2",
          storagePath: `lesson_uploads/${uid}-${kind}/source`,
        });
      }
    }
  });

  const teacher = client("asset-teacher");
  if (process.argv.includes("--expect-upload-denied")) {
    const error = await assertFails(
      getDocFromServer(ticket(teacher, "asset-teacher")),
    );
    assert.equal(error.code, "permission-denied");
    console.log(
      "PASS baseline reproduced: active teacher cannot read their own PDF upload ticket (permission-denied)",
    );
  } else {
    await check(
      "active teacher and admin can get only their own PDF, page and footnote tickets",
      async () => {
        for (const uid of ["asset-teacher", "asset-admin"]) {
          for (const kind of ["PDF", "PAGE", "FOOTNOTE"]) {
            const snapshot = await assertSucceeds(
              getDocFromServer(ticket(client(uid), uid, kind)),
            );
            assert.equal(snapshot.data().ownerUid, uid);
          }
        }
      },
    );
    await check(
      "single-document listener receives server verification without a list permission",
      async () => {
        let stop = () => {};
        let timer;
        try {
          await new Promise((resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Upload ticket listener timed out")),
              10000,
            );
            let updated = false;
            stop = onSnapshot(
              ticket(teacher, "asset-teacher"),
              { includeMetadataChanges: true },
              (snapshot) => {
                if (
                  snapshot.metadata.fromCache ||
                  snapshot.metadata.hasPendingWrites
                )
                  return;
                if (snapshot.data()?.status === "VERIFIED") return resolve();
                if (updated) return;
                updated = true;
                env
                  .withSecurityRulesDisabled((context) =>
                    updateDoc(ticket(context.firestore(), "asset-teacher"), {
                      status: "VERIFIED",
                      url: "https://example.test/verified.pdf",
                    }),
                  )
                  .catch(reject);
              },
              reject,
            );
          });
        } finally {
          clearTimeout(timer);
          stop();
        }
      },
    );
    await check(
      "students, delegated staff, another teacher and admin cannot read another owner's ticket",
      async () => {
        for (const uid of [
          "asset-student",
          "asset-staff",
          "asset-peer",
          "asset-admin",
        ]) {
          await assertFails(
            getDocFromServer(ticket(client(uid), "asset-teacher")),
          );
        }
        for (const uid of ["asset-student", "asset-staff"]) {
          await assertFails(getDocFromServer(ticket(client(uid), uid)));
        }
        await assertFails(
          getDocFromServer(
            ticket(env.unauthenticatedContext().firestore(), "asset-teacher"),
          ),
        );
        await assertFails(
          getDocFromServer(
            ticket(
              client("asset-teacher", { email: "teacher@example.test" }),
              "asset-teacher",
            ),
          ),
        );
      },
    );
    await check(
      "expired, revoked, absent sessions and unapproved teachers remain denied",
      async () => {
        for (const uid of [
          "asset-expired",
          "asset-revoked",
          "asset-no-session",
          "asset-pending",
          "asset-rejected",
        ]) {
          await assertFails(getDocFromServer(ticket(client(uid), uid)));
        }
      },
    );
    await check(
      "ticket enumeration and direct create, update and delete stay denied, including admin",
      async () => {
        for (const uid of ["asset-teacher", "asset-admin"]) {
          const db = client(uid);
          await assertFails(
            getDocsFromServer(collection(db, "lesson_asset_uploads")),
          );
          await assertFails(
            getDocsFromServer(
              query(
                collection(db, "lesson_asset_uploads"),
                where("ownerUid", "==", uid),
              ),
            ),
          );
          await assertFails(
            setDoc(doc(db, "lesson_asset_uploads", `${uid}-forged`), {
              ownerUid: uid,
              status: "VERIFIED",
            }),
          );
          await assertFails(updateDoc(ticket(db, uid), { status: "VERIFIED" }));
          await assertFails(deleteDoc(ticket(db, uid)));
        }
      },
    );
    await check(
      "a malformed maintenance fence still denies upload ticket reads",
      async () => {
        await env.withSecurityRulesDisabled((context) =>
          setDoc(
            doc(context.firestore(), "site_settings/student_maintenance"),
            { enabled: false },
          ),
        );
        await assertFails(getDocFromServer(ticket(teacher, "asset-teacher")));
      },
    );
  }
} finally {
  await env.cleanup();
}
