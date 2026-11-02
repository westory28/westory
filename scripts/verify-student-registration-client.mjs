import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync("src/lib/studentRegistration.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const profile = {
  uid: "student-a",
  grade: "3",
  class: "1",
  number: 5,
  name: "합성학생",
  email: "student@example.test",
};
const config = { year: "2026", semester: "2" };
const transient = () =>
  Object.assign(new Error("response unavailable"), {
    code: "functions/unavailable",
  });
const fixture = () => {
  const calls = [];
  let state = {
    semesterId: "2026-2",
    manifestRevision: 4,
    economyReady: false,
    classes: [],
    students: [
      {
        studentUid: profile.uid,
        status: "PENDING",
        profileVersion: "a".repeat(64),
        submittedProfile: { ...profile, number: "5" },
        blockedReason: "",
      },
    ],
  };
  let commandError = null;
  let receipt = null;
  let commandResult = null;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    exports: module.exports,
    module,
    crypto: { randomUUID },
    require(name) {
      if (name === "./firebase")
        return { auth: { currentUser: { uid: "teacher-a" } } };
      if (name === "./semesterScope")
        return { getYearSemester: (value) => value };
      if (name === "./sensitiveOperation")
        return {
          ensureSensitiveOperation: async () => calls.push({ name: "reauth" }),
        };
      if (name === "./studentProfileCommands")
        return {
          callStudentDataService: async (name, input, ownerUid) => {
            calls.push({ name, input, ownerUid });
            if (name === "getStudentRegistrationApprovalState") return state;
            if (name === "getCommandStatus") return receipt;
            if (commandError) throw commandError;
            return (
              commandResult || {
                status: "SUCCEEDED",
                result: {
                  studentUid: profile.uid,
                  semesterId: "2026-2",
                  enrollmentId: "",
                  status: "REJECTED",
                  action: "REJECT",
                },
              }
            );
          },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    ...module.exports,
    calls,
    state,
    setError: (value) => (commandError = value),
    setReceipt: (value) => (receipt = value),
    setResult: (value) => (commandResult = value),
  };
};

{
  const f = fixture();
  const a = f.rejectStudentRegistration(config, profile);
  const b = f.rejectStudentRegistration(config, profile);
  assert.equal(a, b, "Double click shares one in-flight decision");
  await a;
  const commands = f.calls.filter((c) => c.name === "executeCommand");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].ownerUid, "teacher-a");
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0].input.payload)), {
    semesterId: "2026-2",
    expectedSemesterRevision: 4,
    studentUid: profile.uid,
    expectedProfileVersion: "a".repeat(64),
    action: "REJECT",
  });
  assert.equal(f.calls[0].name, "reauth");
}
{
  const f = fixture();
  f.state.students[0].submittedProfile.name = "변경된 이름";
  await assert.rejects(
    f.rejectStudentRegistration(config, profile),
    /등록 정보가 바뀌었습니다/,
  );
  assert.equal(f.calls.filter((c) => c.name === "executeCommand").length, 0);
}
{
  const f = fixture();
  f.state.students[0].status = "APPROVED_PENDING_ACCOUNT";
  await assert.rejects(
    f.rejectStudentRegistration(config, profile),
    /이미 승인이 진행/,
  );
  assert.equal(f.calls.filter((c) => c.name === "executeCommand").length, 0);
}
{
  const f = fixture();
  f.state.semesterId = "2027-1";
  await assert.rejects(
    f.rejectStudentRegistration(config, profile),
    /현재 학기가 바뀌었습니다/,
  );
}
{
  const f = fixture();
  f.setError(transient());
  await assert.rejects(
    f.rejectStudentRegistration(config, profile),
    /response unavailable/,
  );
  f.setError(null);
  await f.rejectStudentRegistration(config, profile);
  const commands = f.calls.filter((c) => c.name === "executeCommand");
  assert.equal(commands.length, 2);
  assert.equal(
    commands[0].input.commandId,
    commands[1].input.commandId,
    "Ambiguous retry reuses receipt identity",
  );
  assert.equal(
    f.calls.filter((c) => c.name === "getStudentRegistrationApprovalState")
      .length,
    1,
  );
}
{
  const f = fixture();
  f.setError(transient());
  f.setReceipt({
    status: "SUCCEEDED",
    result: {
      studentUid: profile.uid,
      semesterId: "2026-2",
      enrollmentId: "",
      status: "REJECTED",
      action: "REJECT",
    },
  });
  await f.rejectStudentRegistration(config, profile);
  assert.equal(f.calls.filter((c) => c.name === "getCommandStatus").length, 1);
}
for (const change of [
  { studentUid: "other" },
  { semesterId: "2027-1" },
  { action: "APPROVE" },
  { status: "APPROVED" },
  { enrollmentId: "unexpected" },
]) {
  const f = fixture();
  f.setResult({
    status: "SUCCEEDED",
    result: {
      studentUid: profile.uid,
      semesterId: "2026-2",
      enrollmentId: "",
      status: "REJECTED",
      action: "REJECT",
      ...change,
    },
  });
  await assert.rejects(f.rejectStudentRegistration(config, profile));
}
console.log(
  "Student registration client: confirmed rejection, stale profile/semester, partial approval guard, single flight, receipt recovery/retry and response binding passed.",
);
