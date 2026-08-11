const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");

const {
  evaluateStudentMaintenanceAccess,
  normalizeStudentMaintenanceConfig,
  normalizeStoredStudentMaintenanceConfig,
} = require("../studentMaintenance");

const baseConfig = {
  enabled: true,
  blockedRoles: ["student"],
  bypassUids: ["student-bypass"],
  title: "위스토리 2학기 준비 중",
  message: "학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.",
  revision: 7,
};

const auth = (uid, email = `${uid}@yongshin-ms.ms.kr`) => ({
  uid,
  token: { email },
});

const decide = (overrides = {}) =>
  evaluateStudentMaintenanceAccess({
    auth: auth("student-1"),
    config: baseConfig,
    profile: { role: "student" },
    profileExists: true,
    ...overrides,
  });

const cases = [
  {
    name: "anonymous callers pass through to the existing handler",
    decision: decide({ auth: undefined }),
    expected: { allowed: true, reason: "anonymous" },
  },
  {
    name: "authenticated callers pass when maintenance is disabled",
    decision: decide({ config: { ...baseConfig, enabled: false } }),
    expected: { allowed: true, reason: "maintenance-disabled" },
  },
  {
    name: "the token admin email bypasses active maintenance",
    decision: decide({ auth: auth("admin-1", "WESTORIA28@GMAIL.COM") }),
    expected: { allowed: true, reason: "admin-bypass" },
  },
  {
    name: "an explicitly configured uid bypasses active maintenance",
    decision: decide({ auth: auth("student-bypass") }),
    expected: { allowed: true, reason: "uid-bypass" },
  },
  {
    name: "a student role is blocked during active maintenance",
    decision: decide(),
    expected: {
      allowed: false,
      errorCode: "permission-denied",
      reason: "role-blocked",
    },
  },
  {
    name: "a teacher role remains available during student maintenance",
    decision: decide({ profile: { role: "teacher" } }),
    expected: { allowed: true, reason: "role-not-blocked" },
  },
  {
    name: "a missing profile is denied during active maintenance",
    decision: decide({ profile: undefined, profileExists: false }),
    expected: {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-missing",
    },
  },
  {
    name: "a malformed profile is denied during active maintenance",
    decision: decide({ profile: { role: 42 } }),
    expected: {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-malformed",
    },
  },
  {
    name: "an unknown profile role is treated as malformed",
    decision: decide({ profile: { role: "learner" } }),
    expected: {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-malformed",
    },
  },
  {
    name: "a non-canonical profile role is treated as malformed",
    decision: decide({ profile: { role: " Teacher " } }),
    expected: {
      allowed: false,
      errorCode: "permission-denied",
      reason: "profile-malformed",
    },
  },
  {
    name: "a missing configuration fails closed",
    decision: decide({ config: undefined }),
    expected: {
      allowed: false,
      errorCode: "unavailable",
      reason: "config-malformed",
    },
  },
  {
    name: "a malformed configuration fails closed even for the admin",
    decision: decide({
      auth: auth("admin-1", "westoria28@gmail.com"),
      config: { ...baseConfig, enabled: "yes" },
    }),
    expected: {
      allowed: false,
      errorCode: "unavailable",
      reason: "config-malformed",
    },
  },
];

cases.forEach(({ name, decision, expected }) => {
  Object.entries(expected).forEach(([key, value]) => {
    assert.equal(decision[key], value, `${name}: ${key}`);
  });
});

assert.deepEqual(
  normalizeStudentMaintenanceConfig({
    ...baseConfig,
    blockedRoles: [" Student "],
    bypassUids: [" uid-a ", "uid-b"],
  }),
  {
    ...baseConfig,
    blockedRoles: ["student"],
    bypassUids: ["uid-a", "uid-b"],
  },
);

assert.throws(
  () =>
    normalizeStudentMaintenanceConfig({
      ...baseConfig,
      bypassUids: ["same", "same"],
    }),
  /duplicate/,
);
assert.throws(
  () => normalizeStudentMaintenanceConfig({ ...baseConfig, title: "" }),
  /title/,
);
assert.throws(
  () =>
    normalizeStudentMaintenanceConfig({
      ...baseConfig,
      blockedRoles: ["learner"],
    }),
  /blockedRoles/,
);
assert.throws(
  () =>
    normalizeStudentMaintenanceConfig({
      ...baseConfig,
      blockedRoles: ["student", "teacher"],
    }),
  /only the student role/,
);
assert.deepEqual(
  normalizeStoredStudentMaintenanceConfig({
    ...baseConfig,
    startedAt: Timestamp.fromDate(new Date("2026-08-11T00:00:00.000Z")),
    updatedAt: Timestamp.fromDate(new Date("2026-08-11T00:00:01.000Z")),
    updatedBy: "admin-1",
  }),
  baseConfig,
);
assert.throws(
  () =>
    normalizeStoredStudentMaintenanceConfig({
      ...baseConfig,
      startedAt: null,
      updatedAt: "not-a-timestamp",
      updatedBy: "",
    }),
  /Stored student maintenance configuration/,
);

console.log(
  `student maintenance verification passed (${cases.length + 7} checks)`,
);
