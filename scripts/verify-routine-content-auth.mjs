// Exercise actual client dispatch and callable wrappers; only transport/auth I/O
// is synthetic. No production identity, token, storage, or network is used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const policy = JSON.parse(read("functions/routineContentWrites.json"));
const compile = (source) => transformSync(source, { loader: "ts", format: "cjs" }).code;
const sources = Object.fromEntries([
  "highRiskCommands", "stepUpReauth", "commandGateway", "sessionQueryCache", "teacherSemesterView",
].map((name) => [name, compile(read(`src/lib/${name}.ts`))]));
const firebaseSource = read("src/lib/firebase.ts");
const factorySource = firebaseSource.slice(
  firebaseSource.indexOf("const getHttpsCallable ="),
  firebaseSource.indexOf("const getFirebaseStorage ="),
).replaceAll('import("firebase/functions")', "loadFunctions()")
  .replaceAll('import("./applicationSession")', "loadSession()");
assert.ok(!factorySource.includes("import("));
const factoryCode = compile(`${factorySource}\nmodule.exports={getHttpsCallable};`);
const load = (code, dependencies = {}, globals = {}) => {
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder,
    fetch: () => assert.fail("Network is forbidden"),
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, ...globals,
  });
  return module.exports;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const until = async (predicate) => {
  for (let tick = 0; tick < 100 && !predicate(); tick++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(predicate(), "Expected controlled boundary");
};
const fixture = () => {
  const state = {
    auth: { app: { options: { projectId: "demo-westory-routine-content" } }, currentUser: { uid: "teacher-a" } },
    prompts: [], calls: [], storage: new Map(), cancel: false, gate: null,
  };
  const risk = load(sources.highRiskCommands, { "../../functions/routineContentWrites.json": policy });
  const view = load(sources.teacherSemesterView, {}, { window: { location: { hash: "#/teacher/settings" } } });
  const stepUp = load(sources.stepUpReauth);
  stepUp.registerStepUpReauthHandler(async (name) => {
    state.prompts.push(name);
    if (state.cancel) throw new stepUp.StepUpReauthError("CANCELLED", "Synthetic cancellation");
  });
  const cache = load(sources.sessionQueryCache, {}, { structuredClone }).createSessionQueryCache();
  const factory = load(factoryCode, {}, {
    auth: state.auth, ...risk, ...stepUp, ...view, sessionQueryCache: cache,
    getFirebaseFunctions: async () => ({}),
    loadFunctions: async () => ({ httpsCallable: (_functions, name) => {
      const callable = async (data) => {
        assert.equal(data._session.revision, "synthetic-proof");
        state.calls.push({ name, data, uid: state.auth.currentUser?.uid });
        await state.gate?.promise;
        return { data: { commandId: data.commandId, commandType: data.commandType, status: "SUCCEEDED", result: { saved: true } } };
      };
      callable.stream = callable;
      return callable;
    } }),
    loadSession: async () => ({ prepareCallableDataWithApplicationSession: (_name, data) => ({
      ...data, _session: { revision: "synthetic-proof" },
    }) }),
  });
  const gateway = load(sources.commandGateway, {
    "./firebase": { auth: state.auth, ...factory },
    "./highRiskCommands": risk, "./stepUpReauth": stepUp,
    "./teacherSemesterView": view,
  }, { window: { localStorage: {
    getItem: (key) => state.storage.get(key) ?? null,
    setItem: (key, value) => state.storage.set(key, value),
    removeItem: (key) => state.storage.delete(key),
  } } });
  return { state, risk, gateway, factory, view };
};
let checks = 0;
assert.equal(new Set(policy.commands).size, policy.commands.length);
assert.equal(new Set(policy.callables).size, policy.callables.length);
for (const name of [...policy.commands, "submitThinkCloudResponse"]) {
  const test = fixture();
  // If the old policy calls the reauth coordinator, cancel it rather than
  // silently granting a recent identity and concealing an unwanted dialog.
  test.state.cancel = true;
  const saved = await test.gateway.executeWestoryCommand(name, { sample: name });
  await test.gateway.getWestoryCommandStatus(saved.commandId, name);
  assert.equal(test.state.prompts.length, 0, `${name} must not prompt on save or result recovery`);
  assert.equal(test.state.calls.length, 2);
  assert.ok(test.state.calls.every((call) => call.uid === "teacher-a"));
  checks++;
}
for (const name of policy.callables) {
  const test = fixture();
  test.state.cancel = true;
  const callable = await test.factory.getHttpsCallable(name, { expectedUid: "teacher-a" });
  test.state.gate = deferred();
  const first = callable({ uploadId: "owned-upload", contentBase64: "eA==" });
  const second = callable({ uploadId: "owned-upload", contentBase64: "eA==" });
  await until(() => test.state.calls.length > 0);
  assert.equal(test.state.calls.length, 1, `${name} must retain in-flight duplicate protection`);
  test.state.gate.resolve();
  await Promise.all([first, second]);
  assert.equal(test.state.prompts.length, 0);
  test.state.auth.currentUser = { uid: "another-user" };
  await assert.rejects(callable({ uploadId: "owned-upload" }), (error) => error.code === "IDENTITY_CHANGED");
  assert.equal(test.state.calls.length, 1, `${name} must retain owner fencing`);
  checks++;
}
const protectedCommands = [
  "updateStudentEnrollmentProfile", "resetAssessmentAttempt", "publishOfficialGrade",
  "correctOfficialGrade", "grantWis", "deductWis", "updateOperationalSettings",
  "activateSemester", "importEnrollmentRoster", "deleteThinkCloudSession",
  "createTeacherBulkJob", "unknownFutureCommand",
];
for (const name of protectedCommands) {
  const test = fixture();
  test.state.cancel = true;
  await assert.rejects(test.gateway.executeWestoryCommand(name, { sample: name }));
  assert.deepEqual(test.state.prompts, [name]);
  assert.equal(test.state.calls.length, 0, `${name} must not dispatch after cancelled reauth`);
  checks++;
}
for (const name of ["deleteStudentData", "cleanupSourceArchiveAsset", "manageSchoolBanners", "updateStudentMaintenanceConfig"]) {
  const test = fixture();
  test.state.cancel = true;
  const callable = await test.factory.getHttpsCallable(name, { expectedUid: "teacher-a" });
  await assert.rejects(callable({ sample: name }));
  assert.deepEqual(test.state.prompts, [name]);
  assert.equal(test.state.calls.length, 0);
  checks++;
}
{
  const test = fixture();
  test.state.auth.currentUser = null;
  await assert.rejects(test.gateway.executeWestoryCommand("saveLessonTree", {}));
  assert.equal(test.state.calls.length, 0);
  checks++;
}
{
  const test = fixture();
  const upload = await test.factory.getHttpsCallable("uploadLessonAssetContent");
  test.view.setTeacherSemesterWriteScope({ uid: "teacher-a", readOnly: true });
  await assert.rejects(test.gateway.executeWestoryCommand("activateSemester", {}), /조회만/);
  await assert.rejects(test.gateway.executeWestoryCommand("saveLessonTree", {}), /조회만/);
  await assert.rejects(upload({}), /조회만/);
  await assert.rejects(upload.stream({}), /조회만/);
  assert.equal(test.state.calls.length, 0);
  assert.equal(test.state.prompts.length, 0);
  assert.equal(test.state.storage.size, 0);
  const read = await test.factory.getHttpsCallable("getTeacherSemesterOptions");
  await read({});
  assert.equal(test.state.calls.length, 1);
  checks++;
}
console.log(`Routine content client authentication: ${checks} checks passed (actual Gateway and callable wrappers; no network).`);
