// Dedicated demo emulators only; no credentials or production access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getMetadata, deleteObject } from "firebase/storage";

const projectId = "demo-westory-wis-images";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18324");
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:19324");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18324,
    rules:
      "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",
  },
  storage: {
    host: "127.0.0.1",
    port: 19324,
    rules: readFileSync("storage.rules", "utf8"),
  },
});
const bucket = `gs://${projectId}.firebasestorage.app`;
const now = Date.now(),
  fresh = Math.floor(now / 1000) - 60;
const profiles = [
  { uid: "admin", email: "westoria28@gmail.com", role: "teacher" },
  { uid: "teacher", role: "teacher", staffPermissions: ["point_manage"] },
  {
    uid: "staff",
    role: "staff",
    teacherPortalEnabled: true,
    staffPermissions: ["point_manage"],
  },
  { uid: "reader", role: "teacher", staffPermissions: ["point_read"] },
  { uid: "ordinary-teacher", role: "teacher" },
  { uid: "student", role: "student" },
  {
    uid: "external",
    role: "teacher",
    staffPermissions: ["point_manage"],
    email: "other@example.com",
  },
  {
    uid: "pending",
    role: "teacher",
    staffPermissions: ["point_manage"],
    registrationApprovalStatus: "PENDING",
  },
  {
    uid: "no-session",
    role: "teacher",
    staffPermissions: ["point_manage"],
    noSession: true,
  },
  {
    uid: "expired",
    role: "teacher",
    staffPermissions: ["point_manage"],
    highRiskExpiresAt: now - 1000,
  },
  {
    uid: "general-expired",
    role: "teacher",
    staffPermissions: ["point_manage"],
    generalExpiresAt: now - 1000,
  },
  {
    uid: "revoked",
    role: "teacher",
    staffPermissions: ["point_manage"],
    status: "revoked",
  },
  {
    uid: "stale-auth",
    role: "teacher",
    staffPermissions: ["point_manage"],
    authTime: fresh - 600,
  },
];
const clients = {},
  image = new Uint8Array(256),
  metadata = { contentType: "image/webp" };
const productPath = "years/2026/semesters/2/point_products/p1/image.webp";
const hallPath = "site-settings/interface/hall-of-fame/podium-123.jpg";
let count = 0;
const check = async (label, allowed, action) => {
  await (allowed ? assertSucceeds(action()) : assertFails(action()));
  count++;
};
try {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "site_settings/semester_active"), {
      semesterId: "2026-2",
    });
    for (const profile of profiles) {
      const email = profile.email || `${profile.uid}@yongshin-ms.ms.kr`;
      await setDoc(doc(context.firestore(), "users", profile.uid), {
        ...profile,
        email,
        registrationApprovalStatus:
          profile.registrationApprovalStatus || "APPROVED",
        staffPermissions: profile.staffPermissions || [],
      });
      const authTime = profile.authTime || fresh;
      if (!profile.noSession)
        await setDoc(
          doc(
            context.firestore(),
            "application_sessions",
            profile.uid,
            "sessions",
            String(authTime),
          ),
          {
            status: profile.status || "active",
            authTime,
            schemaVersion: 2,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            sessionRevision: "a".repeat(64),
            authorityModeAtOpen: "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(
              profile.generalExpiresAt || now + 3600000,
            ),
            highRiskExpiresAt: Timestamp.fromMillis(
              profile.highRiskExpiresAt || now + 3600000,
            ),
          },
        );
      clients[profile.uid] = env
        .authenticatedContext(profile.uid, { email, auth_time: authTime })
        .storage(bucket);
    }
    await uploadBytes(
      ref(context.storage(bucket), productPath),
      image,
      metadata,
    );
  });
  clients.anonymous = env.unauthenticatedContext().storage(bucket);
  for (const [uid, storage] of Object.entries(clients)) {
    const allowed = ["admin", "teacher", "staff"].includes(uid);
    await check(`${uid} product upload`, allowed, () =>
      uploadBytes(ref(storage, productPath), image, metadata),
    );
    await check(`${uid} hall upload`, allowed, () =>
      uploadBytes(ref(storage, hallPath), image, { contentType: "image/jpeg" }),
    );
  }
  for (const uid of ["admin", "teacher", "staff"]) {
    const storage = clients[uid];
    for (const path of [
      "years/2025/semesters/2/point_products/p1/image.webp",
      "years/2026/semesters/1/point_products/p1/image.webp",
      "years/2026/semesters/2/point_products/p1/unknown.webp",
      "site-settings/interface/hall-of-fame/freeform.webp",
      "site-settings/interface/hall-of-fame/sub/podium-123.jpg",
    ])
      await check(`${uid} invalid scope/name`, false, () =>
        uploadBytes(ref(storage, path), image, metadata),
      );
    for (const path of [productPath, hallPath]) {
      await check(`${uid} rejects html`, false, () =>
        uploadBytes(ref(storage, path), image, { contentType: "text/html" }),
      );
      await check(`${uid} rejects svg`, false, () =>
        uploadBytes(ref(storage, path), image, {
          contentType: "image/svg+xml",
        }),
      );
      await check(`${uid} rejects oversized`, false, () =>
        uploadBytes(
          ref(storage, path),
          new Uint8Array(4 * 1024 * 1024 + 1),
          metadata,
        ),
      );
      await check(`${uid} cannot delete live image`, false, () =>
        deleteObject(ref(storage, path)),
      );
    }
  }
  await check("approved student may read", true, () =>
    getMetadata(ref(clients.student, productPath)),
  );
  await check("pending cannot read", false, () =>
    getMetadata(ref(clients.pending, productPath)),
  );
  const maintenance = (bypassUids = []) => ({
    enabled: true,
    blockedRoles: ["student"],
    bypassUids,
    title: "점검",
    message: "학생 점검 중입니다.",
    startedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    updatedBy: "admin",
    revision: 1,
  });
  await env.withSecurityRulesDisabled((context) =>
    setDoc(
      doc(context.firestore(), "site_settings/student_maintenance"),
      maintenance(),
    ),
  );
  await check("maintenance keeps teacher upload", true, () =>
    uploadBytes(ref(clients.teacher, productPath), image, metadata),
  );
  await check("maintenance keeps admin upload", true, () =>
    uploadBytes(ref(clients.admin, hallPath), image, {
      contentType: "image/jpeg",
    }),
  );
  await check("maintenance blocks student read", false, () =>
    getMetadata(ref(clients.student, productPath)),
  );
  await env.withSecurityRulesDisabled((context) =>
    setDoc(
      doc(context.firestore(), "site_settings/student_maintenance"),
      maintenance(["student"]),
    ),
  );
  await check("maintenance explicit student bypass read", true, () =>
    getMetadata(ref(clients.student, productPath)),
  );
  await check("maintenance bypass never grants student upload", false, () =>
    uploadBytes(ref(clients.student, productPath), image, metadata),
  );
  await check("unrelated admin interface path preserved", true, () =>
    uploadBytes(
      ref(clients.admin, "site-settings/interface/logo.webp"),
      image,
      metadata,
    ),
  );
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), "site_settings/student_maintenance"), {
      ...maintenance(),
      bypassUids: [7],
    }),
  );
  await check("malformed maintenance fails closed", false, () =>
    uploadBytes(ref(clients.teacher, productPath), image, metadata),
  );
  console.log(
    `Wis image Storage rules: ${count} isolated emulator cases passed.`,
  );
} finally {
  await env.cleanup();
}
