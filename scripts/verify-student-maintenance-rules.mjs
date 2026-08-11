import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-maintenance";
const bucketUrl = `gs://${projectId}.appspot.com`;
const authTime = Math.floor(Date.now() / 1000) - 10;
const firestoreRules = readFileSync(resolve("firestore.rules"), "utf8");
const storageRules = readFileSync(resolve("storage.rules"), "utf8");
const checks = [];

const users = {
  student: { uid: "maintenance-student", email: "maintenance.student@yongshin-ms.ms.kr", role: "student" },
  teacher: { uid: "maintenance-teacher", email: "maintenance.teacher@yongshin-ms.ms.kr", role: "teacher" },
  admin: { uid: "maintenance-admin", email: "westoria28@gmail.com", role: "admin" },
  bypass: { uid: "maintenance-bypass", email: "maintenance.bypass@yongshin-ms.ms.kr", role: "student" },
  missing: { uid: "maintenance-missing", email: "maintenance.missing@yongshin-ms.ms.kr", role: null },
  malformed: { uid: "maintenance-malformed", email: "maintenance.malformed@yongshin-ms.ms.kr", role: 42 },
};

const sessionPayload = (user) => ({
  uid: user.uid,
  email: user.email,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "e".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const maintenancePayload = (enabled, overrides = {}) => ({
  enabled,
  blockedRoles: ["student"],
  bypassUids: [users.bypass.uid],
  title: "위스토리 점검 안내",
  message: "학생 서비스는 점검이 끝날 때까지 잠시 이용할 수 없습니다.",
  startedAt: enabled ? Timestamp.fromMillis(1_700_000_000_000) : null,
  updatedAt: Timestamp.fromMillis(1_700_000_001_000),
  updatedBy: users.admin.uid,
  revision: 1,
  ...overrides,
});

const succeeds = async (label, operation) => {
  await assertSucceeds(operation);
  checks.push(label);
};
const fails = async (label, operation) => {
  await assertFails(operation);
  checks.push(label);
};

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules: firestoreRules },
  storage: { host: "127.0.0.1", port: 9199, rules: storageRules },
});

try {
  await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const storage = context.storage(bucketUrl);
    for (const user of Object.values(users)) {
      await setDoc(
        doc(db, "application_sessions", user.uid, "sessions", String(authTime)),
        sessionPayload(user),
      );
      if (user.role !== null) {
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          email: user.email,
          role: user.role,
          teacherPortalEnabled: user.role === "teacher",
          staffPermissions: [],
        });
      }
    }
    await setDoc(doc(db, "lessons", "maintenance-probe"), { title: "probe" });
    await setDoc(
      doc(db, "site_settings", "student_maintenance"),
      maintenancePayload(true),
    );
    await uploadBytes(
      ref(storage, "lesson_pdfs/maintenance-probe/probe.pdf"),
      new Uint8Array([37, 80, 68, 70]),
      { contentType: "application/pdf" },
    );
  });

  const clients = Object.fromEntries(
    Object.entries(users).map(([key, user]) => {
      const context = testEnv.authenticatedContext(user.uid, {
        email: user.email,
        auth_time: authTime,
      });
      return [key, {
        db: context.firestore(),
        storage: context.storage(bucketUrl),
      }];
    }),
  );
  const anonymousContext = testEnv.unauthenticatedContext();
  const anonymous = {
    db: anonymousContext.firestore(),
    storage: anonymousContext.storage(bucketUrl),
  };
  const lessonRef = (client) => doc(client.db, "lessons", "maintenance-probe");
  const configRef = (client) => doc(client.db, "site_settings", "student_maintenance");
  const storageRef = (client) => ref(client.storage, "lesson_pdfs/maintenance-probe/probe.pdf");

  await fails(
    "enabled student with an existing active session is fenced from Firestore",
    getDoc(lessonRef(clients.student)),
  );
  await fails(
    "enabled student collection query is fenced",
    getDocs(collection(clients.student.db, "lessons")),
  );
  await succeeds(
    "enabled student can bootstrap its own user document",
    getDoc(doc(clients.student.db, "users", users.student.uid)),
  );
  await succeeds(
    "enabled student can bootstrap the maintenance config",
    getDoc(configRef(clients.student)),
  );
  for (const key of ["teacher", "admin", "bypass"]) {
    await succeeds(
      `enabled ${key} retains representative Firestore access`,
      getDoc(lessonRef(clients[key])),
    );
  }
  for (const key of ["missing", "malformed"]) {
    await fails(
      `enabled ${key} profile is fail-closed in Firestore`,
      getDoc(lessonRef(clients[key])),
    );
    await succeeds(
      `enabled ${key} identity keeps only the own-user bootstrap`,
      getDoc(doc(clients[key].db, "users", users[key].uid)),
    );
  }
  await fails(
    "anonymous cannot read maintenance config",
    getDoc(configRef(anonymous)),
  );
  for (const key of ["student", "teacher", "admin", "bypass"]) {
    await fails(
      `${key} cannot directly update maintenance config`,
      updateDoc(configRef(clients[key]), { message: `direct-${key}` }),
    );
    await fails(
      `${key} cannot directly create maintenance audit`,
      setDoc(
        doc(clients[key].db, "site_settings", "student_maintenance", "audit", `direct-${key}`),
        { direct: true },
      ),
    );
  }

  await fails(
    "enabled student with an existing active session is fenced from Storage",
    getBytes(storageRef(clients.student)),
  );
  for (const key of ["missing", "malformed"]) {
    await fails(
      `enabled ${key} profile is fail-closed in Storage`,
      getBytes(storageRef(clients[key])),
    );
  }
  for (const key of ["teacher", "admin", "bypass"]) {
    await succeeds(
      `enabled ${key} retains representative Storage access`,
      getBytes(storageRef(clients[key])),
    );
  }
  await fails(
    "enabled student cannot directly write Storage",
    uploadBytes(
      ref(clients.student.storage, "lesson_pdfs/direct-student/probe.pdf"),
      new Uint8Array([37, 80, 68, 70]),
      { contentType: "application/pdf" },
    ),
  );
  await succeeds(
    "enabled admin retains baseline Storage write",
    uploadBytes(
      ref(clients.admin.storage, "lesson_pdfs/direct-admin/probe.pdf"),
      new Uint8Array([37, 80, 68, 70]),
      { contentType: "application/pdf" },
    ),
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "site_settings", "student_maintenance"),
      maintenancePayload(false, { revision: 2 }),
    );
  });
  for (const key of ["student", "missing", "malformed"]) {
    await succeeds(
      `disabled maintenance restores baseline Firestore access for ${key}`,
      getDoc(lessonRef(clients[key])),
    );
    await succeeds(
      `disabled maintenance restores baseline Storage access for ${key}`,
      getBytes(storageRef(clients[key])),
    );
  }

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await deleteDoc(doc(db, "site_settings", "student_maintenance"));
  });
  await succeeds(
    "absent config is rollout-safe disabled for Firestore",
    getDoc(lessonRef(clients.student)),
  );
  await succeeds(
    "absent config is rollout-safe disabled for Storage",
    getBytes(storageRef(clients.student)),
  );

  const malformedConfigs = [
    ["extra field", maintenancePayload(false, { unexpected: true })],
    ["duplicate bypass uid", maintenancePayload(false, { bypassUids: [users.bypass.uid, users.bypass.uid] })],
    ["non-canonical bypass uid", maintenancePayload(false, { bypassUids: [" padded-uid "] })],
    ["non-string bypass uid", maintenancePayload(false, { bypassUids: [42] })],
    ["non-string twentieth bypass uid", maintenancePayload(false, {
      bypassUids: Array.from(
        { length: 20 },
        (_, index) => index === 19 ? 42 : `valid-${index}`,
      ),
    })],
    ["empty twentieth bypass uid", maintenancePayload(false, {
      bypassUids: Array.from(
        { length: 20 },
        (_, index) => index === 19 ? "" : `valid-${index}`,
      ),
    })],
    ["non-canonical twentieth bypass uid", maintenancePayload(false, {
      bypassUids: Array.from(
        { length: 20 },
        (_, index) => index === 19 ? " padded-uid " : `valid-${index}`,
      ),
    })],
    ["overlong twentieth bypass uid", maintenancePayload(false, {
      bypassUids: Array.from(
        { length: 20 },
        (_, index) => index === 19 ? "x".repeat(129) : `valid-${index}`,
      ),
    })],
    ["too many bypass uids", maintenancePayload(false, {
      bypassUids: Array.from({ length: 21 }, (_, index) => `bypass-${index}`),
    })],
    ["wrong blocked role", maintenancePayload(false, { blockedRoles: ["teacher"] })],
    ["wrong startedAt", maintenancePayload(false, { startedAt: Timestamp.fromMillis(1) })],
    ["non-canonical title", maintenancePayload(false, { title: " 점검 안내" })],
    ["non-canonical message", maintenancePayload(false, { message: "점검 안내 " })],
    ["non-canonical updatedBy", maintenancePayload(false, { updatedBy: " admin-uid" })],
  ];
  for (const [label, payload] of malformedConfigs) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
        payload,
      );
    });
    await fails(
      `${label} config fails closed in Firestore`,
      getDoc(lessonRef(clients.teacher)),
    );
    await fails(
      `${label} config fails closed in Storage`,
      getBytes(storageRef(clients.teacher)),
    );
  }

  console.log(`student maintenance rules verification passed (${checks.length} checks)`);
} finally {
  await testEnv.cleanup();
}
