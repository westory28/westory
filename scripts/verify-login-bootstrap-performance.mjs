import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the actual login bootstrap with synthetic I/O. No account or network
// is used; profile persistence decisions remain the production implementation.
const source = ts.createSourceFile(
  "Login.tsx",
  readFileSync("src/pages/Login.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = [
  "getExistingConsentItems",
  "areSameStringLists",
  "resolveTeacherPortalEnabled",
  "shouldBlockUserProfileWrite",
  "finishLoginForRole",
];
const declarations = [];
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source))) {
    declarations.push(`const ${node.getText(source)};`);
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(declarations.length, names.length);
const code = ts.transpileModule(
  declarations.join("\n") + "\nfinishLoginForRole;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const user = { uid: "synthetic-user", email: "synthetic@school.test" };
let cases = 0;
for (const scenario of ["student", "teacher", "new-student", "blocked", "session-error", "teacher-denied"]) {
  const calls = [];
  const writes = [];
  const role = scenario === "teacher" ? "teacher" : "student";
  const profile = scenario === "new-student" ? null : {
    ...user, role, name: "합성", grade: "1", class: "1", number: "1",
    staffPermissions: [], teacherPortalEnabled: role === "teacher",
    customNameConfirmed: true, privacyAgreed: true, consentAgreedItems: ["privacy"],
  };
  const finishLogin = runInNewContext(code, {
    console, auth: { currentUser: user }, db: {}, TEACHER_EMAIL: "admin@school.test",
    STUDENT_MAINTENANCE_ROUTE: "/maintenance", autoResumeUidRef: { current: null },
    markLoginPerf() {}, measureLoginPerf() {}, isAllowedLoginEmail: () => true,
    readStudentMaintenanceBootstrap: async () => {
      calls.push("maintenance");
      return { profile, accessStatus: scenario === "blocked" ? "blocked" : "allowed" };
    },
    openApplicationSession: async () => {
      calls.push("session");
      if (scenario === "session-error") throw Error("Synthetic session failure");
    },
    doc: (_db, ...parts) => parts.join("/"),
    getDoc: async () => {
      calls.push("profile-read");
      return { exists: () => !!profile, data: () => profile };
    },
    setDoc: async (_ref, payload) => { calls.push("blocking-write"); writes.push(payload); },
    scheduleDeferredUserMerge: (_ref, payload) => { calls.push("deferred-write"); writes.push(payload); },
    serverTimestamp: () => "server-timestamp",
    normalizeStaffPermissions: (permissions) => permissions || [],
    canAccessTeacherPortal: (value) => value.role === "teacher",
    hasTeacherIdentity: (value) => value.role === "teacher",
    shouldLookupStudentRosterProfile: () => false,
    completeStudentOnboarding: async () => ({
      name: "합성", grade: "1", classValue: "1", number: "1",
      privacyAgreed: true, consentAgreedItems: ["privacy"],
      newlyAgreedPrivacy: !profile, shouldPersistProfile: !profile, profileIncomplete: false,
    }),
    alert: () => calls.push("alert"), signOut: async () => calls.push("sign-out"),
    clearPendingLoginMode() {}, clearRoleCache() {}, clearRedirectAttempt() {},
    clearSessionTiming() {}, saveRoleCache() {},
    getDefaultTeacherRoute: () => "/teacher/dashboard",
    resolvePostLoginTarget: (_user, _mode, target) => target,
    forceRoute: (target) => calls.push(target), navigate: (target) => calls.push(target),
  });
  const mode = scenario === "teacher" || scenario === "teacher-denied" ? "teacher" : "student";
  if (scenario === "session-error") {
    await assert.rejects(finishLogin(user, mode), /Synthetic session failure/);
    assert.deepEqual(calls, ["maintenance", "session"]);
  } else {
    await finishLogin(user, mode);
    if (scenario === "blocked") {
      assert.deepEqual(calls, ["maintenance", "/maintenance"]);
    } else if (scenario === "teacher-denied") {
      assert.deepEqual(calls, ["maintenance", "session", "alert", "sign-out"]);
    } else if (scenario === "new-student") {
      assert.deepEqual(calls, ["maintenance", "session", "profile-read", "blocking-write", "/student/dashboard"]);
      assert.equal(writes[0].registrationApprovalStatus, "PENDING");
      assert.equal(writes[0].privacyAgreed, true);
    } else {
      assert.deepEqual(calls, ["maintenance", "session", `/${role}/dashboard`, "deferred-write"]);
      assert.equal(writes[0].role, role);
    }
  }
  cases += 1;
}
console.log(JSON.stringify({ suite: "login-bootstrap-performance", passed: true, cases, returningUserExtraProfileReads: 0, networkAccess: 0 }));
