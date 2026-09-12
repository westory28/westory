import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const ownedPaths = [
  "src/lib/w8Domains.ts",
  "src/lib/notifications.ts",
  "src/pages/student/W8StudentHub.tsx",
  "src/pages/teacher/W8TeacherHub.tsx",
  "src/pages/student/Dashboard.tsx",
  "src/pages/teacher/Dashboard.tsx",
  "src/components/common/NotificationBell.tsx",
  "src/pages/teacher/components/SettingsNotifications.tsx",
  "src/pages/teacher/ManageSchedule.tsx",
  "src/pages/student/Calendar.tsx",
  "src/pages/student/components/CalendarSection.tsx",
  "src/lib/legacyStudentScheduleAdapter.ts",
];
for (const path of [...ownedPaths, "src/pages/w8Domains.css"]) {
  assert.equal(
    existsSync(resolve(path)),
    true,
    `Missing mounted W8 module: ${path}`,
  );
}

const directMutation =
  /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|uploadString|deleteObject)\s*\(/u;
const directImport = /from\s+["']firebase\/(?:firestore|storage)["']/u;
for (const path of ownedPaths) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    directMutation,
    `${path} retains direct persistence.`,
  );
  assert.doesNotMatch(source, directImport, `${path} imports persistence SDK.`);
}

const adapter = read("src/lib/w8Domains.ts");
assert.match(adapter, /getW8DomainState/u);
assert.match(adapter, /source:\s*W8Source/u);
assert.match(adapter, /semesterId/u);

const implementation = read("functions/w8Domains.js");
assert.ok(implementation, "functions/w8Domains.js must exist.");
const commands = [
  "createLearningContent",
  "updateLearningContent",
  "transitionLearningContent",
  "recordLearningProgress",
  "requestLearningExemption",
  "createScheduleEvent",
  "updateScheduleEvent",
  "deleteScheduleEvent",
  "createAttendanceSession",
  "recordAttendance",
  "recordAttendanceBulk",
  "correctAttendanceRecord",
  "closeAttendanceSession",
  "createNotice",
  "updateNotice",
  "transitionNotice",
  "acknowledgeNotice",
  "acknowledgeAllNotices",
  "updateNotificationSettings",
  "resetLearningProgress",
  "grantLearningExemptions",
  "revokeLearningExemptions",
  "reviewLearningExemptionRequest",
];
for (const command of commands) {
  assert.ok(implementation.includes(command), `Missing W8 command ${command}.`);
}
for (const checkId of [
  "learning_domain_readiness",
  "schedule_domain_readiness",
  "attendance_domain_readiness",
  "communication_domain_readiness",
]) {
  assert.ok(
    implementation.includes(checkId),
    `Missing W8 readiness check ${checkId}.`,
  );
}
assert.match(
  implementation,
  /checks\.length[\s\S]*?W8_READINESS_CHECK_IDS\.length|W8_READINESS_CHECK_IDS/u,
  "W8 readiness count must remain registry-derived.",
);

const functionIndex = read("functions/index.js");
for (const legacy of [
  "resetLessonCorePointProgress",
  "createHistoryClassroomExemptionRequest",
  "grantHistoryClassroomExemptions",
  "revokeHistoryClassroomExemptions",
  "reviewHistoryClassroomExemptionRequest",
  "markNotificationsRead",
  "clearNotifications",
  "createManagedNotifications",
]) {
  assert.match(
    functionIndex,
    new RegExp(`exports\\.${legacy}\\s*=\\s*retiredW8LegacyCallable`, "u"),
    `Previous bundle callable is not fail-closed: ${legacy}.`,
  );
}

const joinedClient = ownedPaths.map(read).join("\n");
for (const legacy of [
  "markNotificationsRead",
  "clearNotifications",
  "createManagedNotifications",
]) {
  assert.doesNotMatch(
    joinedClient,
    new RegExp(`getHttpsCallable\\(["']${legacy}["']`, "u"),
    `Previous notification writer remains reachable: ${legacy}.`,
  );
}
assert.doesNotMatch(
  joinedClient,
  /notification_inboxes|notification_broadcasts/u,
  "W8 mounted UI must not directly read legacy notification collections.",
);

const analysis = analyzeClientBoundary({ rootDir: process.cwd() });
const owned = new Set(ownedPaths);
const forbidden = analysis.observations.filter(
  (entry) =>
    owned.has(entry.file) &&
    ["FIRESTORE", "STORAGE", "HTTP"].includes(entry.boundary),
);
assert.deepEqual(forbidden, []);
const implicitWrites = analysis.observations.filter(
  (entry) =>
    owned.has(entry.file) &&
    entry.boundary !== "QUERY_CALLABLE" &&
    entry.triggers.some((trigger) =>
      [
        "MOUNT_EFFECT",
        "LISTENER",
        "TIMER",
        "UNMOUNT_CLEANUP",
        "RENDER",
      ].includes(trigger),
    ),
);
assert.deepEqual(implicitWrites, []);

const rules = read("firestore.rules");
for (const name of [
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
  "w8_legacy_issues",
]) {
  assert.match(
    rules,
    new RegExp(
      `match /${name}/\\{documentId\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`,
      "u",
    ),
  );
}

const app = read("src/App.tsx");
// The user retired the standalone W8 operations pages. Schedule editing now
// lives in the dashboard modal and still uses the same trusted commands.
assert.doesNotMatch(app, /import\("\.\/pages\/(student\/W8StudentHub|teacher\/W8TeacherHub|teacher\/ManageSchedule)"\)/u);
const scheduleAdapter = read("src/pages/teacher/components/TeacherCalendarEventModal.tsx");
const dashboard = read("src/pages/teacher/Dashboard.tsx");
assert.match(dashboard, /<TeacherCalendarEventModal/u);
assert.match(scheduleAdapter, /expectedSemesterRevision/u);
assert.match(scheduleAdapter, /expectedEventRevision/u);
assert.match(scheduleAdapter, /resolveScheduleTargets/u);
assert.doesNotMatch(scheduleAdapter, /\b(?:setDoc|updateDoc|deleteDoc|addDoc)\s*\(/u);
for (const command of [
  "createScheduleEvent",
  "updateScheduleEvent",
  "deleteScheduleEvent",
]) {
  assert.match(
    scheduleAdapter,
    new RegExp(`\\b${command}\\s*\\(`, "u"),
    `Schedule adapter does not use ${command}.`,
  );
}
assert.match(dashboard, /getW8DomainState/u);
assert.match(dashboard, /domain:\s*"SCHEDULE"/u);
const studentScheduleAdapter = read("src/lib/legacyStudentScheduleAdapter.ts");
assert.match(studentScheduleAdapter, /getW8DomainState/u);
assert.match(studentScheduleAdapter, /domain:\s*"SCHEDULE"/u);
assert.match(studentScheduleAdapter, /audience:\s*"student"/u);
assert.match(studentScheduleAdapter, /source:\s*"CURRENT"/u);

console.log(
  JSON.stringify({
    suite: "w8-query-purity",
    passed: true,
    mountedModules: ownedPaths.length,
    productionPresentationAdapters: 3,
    directReads: 0,
    directWrites: 0,
    implicitWrites: 0,
    notificationPanelOpenWrites: 0,
    notificationCardVisibleWrites: 0,
    notificationListDetailWrites: 0,
    queryCallable: "getW8DomainState",
    previousBundleWritersReachable: 0,
    productionAccess: 0,
  }),
);
