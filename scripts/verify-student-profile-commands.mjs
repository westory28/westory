// Local service doubles only: no Firebase SDK, account login or network writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const config = { year: "2026", semester: "2" };
const profile = {
  uid: "qa-student",
  grade: "3",
  class: "2",
  number: "7",
  name: "가상학생",
  email: "qa@example.test",
};

function fixture(options = {}) {
  const calls = [],
    modules = new Map();
  const auth = {
    currentUser: {
      uid: "qa-teacher",
      getIdTokenResult: async () => ({ claims: { auth_time: 10 } }),
    },
  };
  const state = {
    semesterId: "2026-2",
    students: [
      {
        studentUid: profile.uid,
        source: options.source || "CANONICAL",
        expectedVersion: "a".repeat(64),
        profile: { ...profile, class: "1" },
        error: "학적 상태를 확인해 주세요.",
      },
    ],
    classes: [
      { classId: "class-3-2", grade: "3", classNumber: "2", revision: 4 },
    ],
  };
  let attempt = 0;
  const firebase = {
    auth,
    getHttpsCallable: async (name) => async (input) => {
      calls.push({ name, input });
      if (name === "openApplicationSession") {
        if (options.sameUidReplacement)
          auth.currentUser = { ...auth.currentUser };
        if (options.switchOwner)
          auth.currentUser = { ...auth.currentUser, uid: "another-teacher" };
        return {
          data: {
            status: "active",
            authTime: options.badSession ? 9 : 10,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            revision: "b".repeat(64),
          },
        };
      }
      assert.ok(input._session, `${name} requires session proof`);
      if (name === "getStudentEnrollmentProfileState") {
        if (options.responseOwnerReplacement)
          auth.currentUser = { ...auth.currentUser };
        if (options.responseEpochChanged)
          auth.currentUser.getIdTokenResult = async () => ({
            claims: { auth_time: 11 },
          });
        if (options.queryError)
          throw Object.assign(new Error("query unavailable"), {
            code: "functions/unavailable",
          });
        return { data: state };
      }
      if (name === "executeCommand") {
        attempt++;
        if (options.timeout && attempt === 1)
          throw Object.assign(new Error("acknowledgement lost"), {
            code: "functions/unavailable",
          });
        return {
          data: {
            status: "SUCCEEDED",
            result: { studentUid: profile.uid, semesterId: "2026-2" },
          },
        };
      }
      if (name === "getCommandStatus")
        return {
          data: options.receiptPending
            ? { status: "NOT_FOUND" }
            : {
                status: "SUCCEEDED",
                result: { studentUid: profile.uid, semesterId: "2026-2" },
              },
        };
      if (name === "updateStudentData")
        return {
          data: {
            uid: profile.uid,
            year: "2026",
            semester: "2",
            updatedRelatedDocCount: 1,
            updatedRosterCount: 0,
            updatedRosterRowCount: 0,
          },
        };
      throw new Error(`Unexpected service ${name}`);
    },
  };
  const load = (name) => {
    if (modules.has(name)) return modules.get(name).exports;
    const source = fs.readFileSync(
      path.join(root, "src/lib", name + ".ts"),
      "utf8",
    );
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const module = { exports: {} };
    modules.set(name, module);
    const context = vm.createContext({
      exports: module.exports,
      module,
      crypto: globalThis.crypto,
      console,
      require: (specifier) => {
        if (specifier === "./firebase") return firebase;
        if (specifier === "./semesterScope")
          return { getYearSemester: (value) => value };
        if (specifier === "./studentProfileCommands")
          return load("studentProfileCommands");
        throw new Error(`Unexpected dependency ${specifier}`);
      },
    });
    vm.runInContext(code, context, { filename: name + ".js" });
    return module.exports;
  };
  return { calls, state, auth, update: load("studentData").updateStudentData };
}

const canonical = fixture();
await canonical.update(config, profile);
const execution = canonical.calls.find(
  (call) => call.name === "executeCommand",
);
assert.equal(execution.input.commandType, "updateStudentEnrollmentProfile");
assert.equal(execution.input.payload.targetClassId, "class-3-2");
assert.equal(execution.input.payload.expectedTargetClassRevision, 4);
assert.equal(execution.input.payload.expectedVersion, "a".repeat(64));
assert.equal(execution.input.payload.operation, "EDIT_PROFILE");
assert.equal(
  canonical.calls.some((call) => call.name === "updateStudentData"),
  false,
);
for (const operation of ["MOVE_CLASS", "PROMOTE_GRADE"]) {
  const test = fixture();
  await test.update(config, { ...profile, operation });
  assert.equal(
    test.calls.find((call) => call.name === "executeCommand").input.payload
      .operation,
    operation,
  );
}
const legacy = fixture({ source: "LEGACY" });
await legacy.update(config, { ...profile, operation: "MOVE_CLASS" });
assert.equal(
  legacy.calls.filter((call) => call.name === "updateStudentData").length,
  1,
);
assert.equal(
  "operation" in
    legacy.calls.find((call) => call.name === "updateStudentData").input,
  false,
);
for (const options of [
  { source: "BLOCKED" },
  { queryError: true },
  { switchOwner: true },
  { sameUidReplacement: true },
  { responseOwnerReplacement: true },
  { responseEpochChanged: true },
  { badSession: true },
]) {
  const test = fixture(options);
  await assert.rejects(() => test.update(config, profile));
  assert.equal(
    test.calls.some((call) =>
      ["executeCommand", "updateStudentData"].includes(call.name),
    ),
    false,
  );
}
const changedEmail = fixture();
await assert.rejects(
  () =>
    changedEmail.update(config, { ...profile, email: "other@example.test" }),
  /이메일/,
);
assert.equal(
  changedEmail.calls.some((call) => call.name === "executeCommand"),
  false,
);
const recovered = fixture({ timeout: true });
await recovered.update(config, profile);
assert.equal(
  recovered.calls.find((call) => call.name === "getCommandStatus").input
    .commandId,
  recovered.calls.find((call) => call.name === "executeCommand").input
    .commandId,
);
const retry = fixture({ timeout: true, receiptPending: true });
await assert.rejects(() => retry.update(config, profile));
retry.state.students[0].expectedVersion = "c".repeat(64);
await retry.update(config, profile);
const retried = retry.calls.filter((call) => call.name === "executeCommand");
assert.equal(retried[0].input.commandId, retried[1].input.commandId);
assert.equal(
  retried[0].input.payload.expectedVersion,
  retried[1].input.payload.expectedVersion,
);
assert.equal(
  retry.calls.filter((call) => call.name === "getStudentEnrollmentProfileState")
    .length,
  1,
);
const concurrent = fixture();
await Promise.all([
  concurrent.update(config, profile),
  concurrent.update(config, profile),
]);
assert.equal(
  concurrent.calls.filter((call) => call.name === "executeCommand").length,
  1,
);
console.log(
  "Student profile command adapter: canonical routing, legacy-only fallback, revision/session fences, email guard, acknowledgement recovery and duplicate-flight checks passed.",
);
