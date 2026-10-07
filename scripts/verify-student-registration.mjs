// Local command/query doubles only; never connects to Firebase or real students.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const normalizeSource = process.env.STUDENT_APPROVAL_SERVER_SOURCE;
let normalizeStudentRegistrationApprovalPayload = (_type, payload) => payload;
if (normalizeSource) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(normalizeSource, "utf8"), {
    exports: module.exports,
    module,
    require: (name) =>
      name === "node:crypto"
        ? require(name)
        : name === "firebase-functions/v2/https"
          ? {
              HttpsError: class extends Error {
                constructor(code, message) {
                  super(message);
                  this.code = code;
                }
              },
            }
          : {},
  });
  normalizeStudentRegistrationApprovalPayload =
    module.exports.normalizeStudentRegistrationApprovalPayload;
}
const profile = {
  uid: "qa-new",
  grade: "3",
  class: "1",
  number: 5,
  name: "등록예시",
  email: "qa-new@yongshin-ms.ms.kr",
};
const config = { year: "2026", semester: "2" };
function fixture(options = {}) {
  const calls = [],
    receipts = new Map(),
    modules = new Map();
  let attempts = 0;
  const student = {
    studentUid: profile.uid,
    status: options.prepared ? "APPROVED_PENDING_ACCOUNT" : "PENDING",
    profileVersion: "a".repeat(64),
    submittedProfile: { ...profile, number: String(profile.number) },
    enrollmentId: options.prepared ? "enr-qa" : "",
    accountState: options.prepared ? "PREPARED" : "NOT_PREPARED",
    accountRevision: options.prepared ? 1 : null,
    blockedReason: "",
  };
  const state = {
    semesterId: "2026-2",
    manifestRevision: 2,
    economyRevision: 3,
    economyReady: !options.economyBlocked,
    students: options.missing ? [] : [student],
    classes: [
      { classId: "class-3-1", revision: 4, grade: "3", classNumber: "1" },
    ],
  };
  const firebase = { auth: { currentUser: { uid: "qa-teacher" } } };
  const service = async (name, input, owner) => {
    assert.equal(owner, "qa-teacher");
    calls.push({ name, input: structuredClone(input) });
    if (name === "getStudentRegistrationApprovalState")
      return structuredClone(state);
    if (name === "getCommandStatus")
      return options.receiptMissing
        ? { status: "NOT_FOUND" }
        : receipts.get(input.commandId);
    assert.equal(name, "executeCommand");
    const payload = normalizeStudentRegistrationApprovalPayload(
      input.commandType,
      input.payload,
    );
    attempts += 1;
    if (options.schoolRequired)
      throw Object.assign(new Error("학교 계정 확인 필요"), {
        code: "functions/failed-precondition",
        details: { reason: "REGISTRATION_SCHOOL_ACCOUNT_REQUIRED" },
      });
    if (options.timeoutBefore && attempts === 1)
      throw Object.assign(new Error("ack lost"), {
        code: "functions/unavailable",
      });
    let response = receipts.get(input.commandId);
    if (!response) {
      assert.equal(payload.expectedProfileVersion, student.profileVersion);
      if (payload.action === "APPROVE") {
        student.status = "APPROVED_PENDING_ACCOUNT";
        student.enrollmentId = "enr-qa";
        student.profileVersion = "b".repeat(64);
      }
      if (payload.action === "PREPARE_ACCOUNT") {
        student.accountState = "PREPARED";
        student.accountRevision = 1;
      }
      if (payload.action === "FINALIZE") student.status = "APPROVED";
      response = {
        status: "SUCCEEDED",
        result: {
          studentUid: profile.uid,
          action: payload.action,
          status: student.status,
          enrollmentId: "enr-qa",
          ...(payload.action === "APPROVE" ? { semesterId: "2026-2" } : {}),
        },
      };
      receipts.set(input.commandId, response);
    }
    if (options.loseAck === payload.action)
      throw Object.assign(new Error("ack lost"), {
        code: "functions/unavailable",
      });
    return response;
  };
  const load = (name) => {
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {} };
    modules.set(name, module);
    const code = ts.transpileModule(
      fs.readFileSync(path.join(root, "src/lib", name + ".ts"), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports: module.exports,
      module,
      crypto: globalThis.crypto,
      require: (dependency) => {
        if (dependency === "./firebase") return firebase;
        if (dependency === "./semesterScope")
          return { getYearSemester: (value) => value };
        if (dependency === "./studentProfileCommands")
          return { callStudentDataService: service };
        throw new Error(dependency);
      },
    });
    return module.exports;
  };
  return {
    approve: load("studentRegistration").approveStudentRegistration,
    roster: load("studentRoster"),
    calls,
    state,
    student,
  };
}
for (const loseAck of [undefined, "APPROVE", "PREPARE_ACCOUNT", "FINALIZE"]) {
  const test = fixture({ loseAck });
  await test.approve(config, profile);
  assert.deepEqual(
    test.calls
      .filter((item) => item.name === "executeCommand")
      .map((item) => item.input.payload.action),
    ["APPROVE", "PREPARE_ACCOUNT", "FINALIZE"],
  );
  assert.equal(test.student.status, "APPROVED");
}
const pending = fixture({ schoolRequired: true });
await assert.rejects(
  () => pending.approve(config, profile),
  (error) => error.details.reason === "REGISTRATION_SCHOOL_ACCOUNT_REQUIRED",
);
assert.equal(pending.student.status, "PENDING");
const missing = fixture({ missing: true });
await assert.rejects(() => missing.approve(config, profile), /등록 대기/);
assert.equal(
  missing.calls.some((item) => item.name === "executeCommand"),
  false,
);
const changed = fixture();
await assert.rejects(
  () => changed.approve(config, { ...profile, number: 6 }),
  /등록 정보가 바뀌었습니다/,
);
const partial = fixture({ economyBlocked: true });
await assert.rejects(() => partial.approve(config, profile), /Wis/);
assert.equal(partial.student.status, "APPROVED_PENDING_ACCOUNT");
partial.state.economyReady = true;
await partial.approve(config, profile);
assert.deepEqual(
  partial.calls
    .filter((item) => item.name === "executeCommand")
    .map((item) => item.input.payload.action),
  ["APPROVE", "PREPARE_ACCOUNT", "FINALIZE"],
);
const prepared = fixture({ prepared: true });
await prepared.approve(config, profile);
assert.equal(
  prepared.calls.find((item) => item.name === "executeCommand").input.payload
    .action,
  "FINALIZE",
);
const retry = fixture({ timeoutBefore: true, receiptMissing: true });
await assert.rejects(() => retry.approve(config, profile));
await retry.approve(config, profile);
const executions = retry.calls.filter((item) => item.name === "executeCommand");
assert.equal(executions[0].input.commandId, executions[1].input.commandId);
const concurrent = fixture();
await Promise.all([
  concurrent.approve(config, profile),
  concurrent.approve(config, profile),
]);
assert.equal(
  concurrent.calls.filter((item) => item.name === "executeCommand").length,
  3,
);
for (const registrationApprovalStatus of [
  "PENDING",
  "APPROVED_PENDING_ACCOUNT",
  "REJECTED",
  null,
  "",
  undefined,
])
  assert.equal(
    concurrent.roster.isActiveRosterStudent({ registrationApprovalStatus }),
    false,
  );
assert.equal(concurrent.roster.isActiveRosterStudent({}), true);
for (const registrationApprovalStatus of ["APPROVED"])
  assert.equal(
    concurrent.roster.isActiveRosterStudent({ registrationApprovalStatus }),
    true,
  );
console.log(
  `Registration: ${normalizeSource ? "server payload normalizer, " : ""}all three stages, first-login wait, partial resume, every-stage receipt recovery, retained retry ID, no missing-state success, stale confirmation rejection and pending-roster exclusion passed.`,
);
