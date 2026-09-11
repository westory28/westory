const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/lib/studentData.ts", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let count = 0;
class CommandError extends Error { constructor(retryable) { super("command failed"); this.retryable = retryable; } }
function harness() {
  const auth = { currentUser: { uid: "teacher-a" } }, calls = [], queries = [], legacy = [];
  let sender = async (_, payload) => ({ result: { studentUid: payload.studentUid, semesterId: payload.semesterId } });
  let pending = false;
  const classes = [{ classId: "class-a", grade: "2", classNumber: "1", revision: 1 }, { classId: "class-b", grade: "2", classNumber: "2", revision: 3 }];
  const queryStudent = uid => ({ studentUid: uid, source: "CANONICAL", expectedVersion: "a".repeat(64),
    profile: { grade: "2", class: "1", number: "7", name: "학생", email: "student@example.com" } });
  const mockRequire = name => {
    if (name === "./firebase") return { auth, getHttpsCallable: async name => async data => {
      if (name === "getStudentEnrollmentProfileState") { queries.push(structuredClone(data)); return { data: { semesterId: data.semesterId, classes, students: data.studentUids.map(queryStudent) } }; }
      legacy.push({ name, data }); return { data: { uid: data.uid } };
    } };
    if (name === "./semesterScope") return { getYearSemester: config => ({ year: String(config?.year || "2026"), semester: String(config?.semester || "2") }) };
    if (name === "./commandGateway") return { WestoryCommandError: CommandError,
      hasPendingWestoryCommand: async () => pending,
      executeWestoryCommand: async (name, payload, options) => { calls.push({ name, payload: structuredClone(payload), options }); return sender(name, payload, options); } };
    throw Error(`unexpected import ${name}`);
  };
  const exports = {}; vm.runInNewContext(code, { exports, require: mockRequire, console, Map, Set, Promise, Error, JSON });
  return { api: exports, auth, calls, queries, legacy, classes, setSender: value => { sender = value; }, setPending: value => { pending = value; } };
}
const config = { year: "2026", semester: "2" };
const input = editState => ({ uid: "student-a", grade: "2", class: "1", number: 8, name: "새 이름", email: "student@example.com", editState });
async function stateFor(h) { return (await h.api.loadStudentProfileEditStates(config, ["student-a"])).get("student-a"); }
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
(async () => {
  await test("CAS is captured at load and save does not refresh it", async () => {
    const h = harness(), state = await stateFor(h); await h.api.updateStudentData(config, input(state));
    assert.equal(h.queries.length, 1); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, "updateStudentEnrollmentProfile");
    assert.equal(h.calls[0].payload.expectedVersion, state.expectedVersion); assert.equal(h.legacy.length, 0);
    assert.equal(h.calls[0].options.expectedUid, "teacher-a");
  });
  await test("scope and owner changes reject before dispatch", async () => {
    const h = harness(), state = await stateFor(h);
    await assert.rejects(h.api.updateStudentData({ year: "2026", semester: "1" }, input(state)));
    h.auth.currentUser.uid = "teacher-b"; await assert.rejects(h.api.updateStudentData(config, input(state))); assert.equal(h.calls.length, 0);
  });
  await test("unknown target class and blocked row cannot fall back to legacy", async () => {
    const h = harness(), state = await stateFor(h);
    await assert.rejects(h.api.updateStudentData(config, { ...input(state), class: "99" }));
    await assert.rejects(h.api.updateStudentData(config, input({ ...state, source: "BLOCKED", error: "blocked" })));
    assert.equal(h.calls.length, 0); assert.equal(h.legacy.length, 0);
  });
  await test("unconfirmed result keeps original payload/draft and explicit retry resends it", async () => {
    const h = harness(), state = await stateFor(h); h.setPending(true); h.setSender(async () => { throw new CommandError(true); });
    await assert.rejects(h.api.updateStudentData(config, input(state)));
    assert.equal(h.api.hasPendingStudentProfileUpdate(state), true);
    assert.equal(h.api.getPendingStudentProfileDraft(state).name, "새 이름");
    await assert.rejects(h.api.updateStudentData(config, { ...input(state), name: "changed draft" }));
    assert.equal(h.calls.length, 1);
    h.setSender(async (_, payload) => ({ result: { studentUid: payload.studentUid, semesterId: payload.semesterId } }));
    await h.api.retryStudentProfileUpdate(state);
    assert.deepEqual(h.calls[1].payload, h.calls[0].payload); assert.equal(h.api.hasPendingStudentProfileUpdate(state), false);
    assert.equal(h.queries.length, 1);
  });
  await test("new teacher cannot view or resend former teacher pending draft", async () => {
    const h = harness(), state = await stateFor(h); h.setSender(async () => { throw new CommandError(true); });
    await assert.rejects(h.api.updateStudentData(config, input(state))); h.auth.currentUser.uid = "teacher-b";
    assert.equal(h.api.getPendingStudentProfileDraft(state), null);
    assert.throws(() => h.api.retryStudentProfileUpdate(state)); assert.equal(h.calls.length, 1);
  });
  await test("definite rejection clears flight so retained input can be corrected", async () => {
    const h = harness(), state = await stateFor(h); h.setSender(async () => { throw new CommandError(false); });
    await assert.rejects(h.api.updateStudentData(config, input(state))); assert.equal(h.api.hasPendingStudentProfileUpdate(state), false);
    h.setSender(async (_, payload) => ({ result: { studentUid: payload.studentUid, semesterId: payload.semesterId } }));
    await h.api.updateStudentData(config, { ...input(state), number: 9 }); assert.equal(h.calls[1].payload.studentNumber, "9");
  });
  await test("duplicate click does not send another in-flight command", async () => {
    const h = harness(), state = await stateFor(h); let release;
    h.setSender((_, payload) => new Promise(resolve => { release = () => resolve({ result: { studentUid: payload.studentUid, semesterId: payload.semesterId } }); }));
    const first = h.api.updateStudentData(config, input(state));
    await assert.rejects(h.api.updateStudentData(config, input(state))); assert.equal(h.calls.length, 1);
    release(); await first;
  });
  await test("legacy route sends only legacy fields and no captured edit state", async () => {
    const h = harness(), state = await stateFor(h); await h.api.updateStudentData(config, input({ ...state, source: "LEGACY", expectedVersion: null }));
    assert.equal(h.calls.length, 0); assert.equal(h.legacy[0].name, "updateStudentData");
    assert.equal(Object.hasOwn(h.legacy[0].data, "editState"), false); assert.equal(Object.hasOwn(h.legacy[0].data, "operation"), false);
  });
  await test("query chunking bounds snapshots to 100 students", async () => {
    const h = harness(); const result = await h.api.loadStudentProfileEditStates(config, Array.from({ length: 101 }, (_, i) => `student-${i}`));
    assert.equal(result.size, 101); assert.deepEqual(h.queries.map(item => item.studentUids.length), [100, 1]);
  });
  await test("move and promotion preserve operation identity", async () => {
    for (const operation of ["MOVE_CLASS", "PROMOTE_GRADE"]) {
      const h = harness(), state = await stateFor(h); await h.api.updateStudentData(config, { ...input(state), class: "2", operation });
      assert.equal(h.calls[0].payload.operation, operation); assert.equal(h.calls[0].payload.targetClassId, "class-b");
    }
  });
  for (const file of ["src/lib/studentData.ts", "src/lib/commandGateway.ts", "src/lib/highRiskCommands.ts", "src/pages/teacher/StudentList.tsx",
    "src/pages/teacher/components/MoveClassModal.tsx", "src/pages/teacher/components/StudentDetailModal.tsx"]) {
    const result = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }, reportDiagnostics: true });
    assert.equal((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, file);
  }
  console.log(`PASS student enrollment profile client: ${count} behavior scenarios + 6 transpile checks`);
})().catch(error => { console.error(error); process.exitCode = 1; });
