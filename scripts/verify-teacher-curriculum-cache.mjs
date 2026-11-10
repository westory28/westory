import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (file, modules, globals = {}) => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    ...globals,
  });
  return exports;
};
let now = 1_000;
const auth = { currentUser: { uid: "teacher-a" } };
const calls = [];
let failure = false;
let pendingWrites = false;
let gate;
const snapshots = new Map();
const config = { year: "2026", semester: "2" };
const pathFor = (scope, collection, id) =>
  `years/${scope.year}/semesters/${scope.semester}/${collection}/${id}`;
const firestore = {
  doc: (_db, path) => path,
  async getDocFromServer(path) {
    calls.push(path);
    await gate;
    if (failure) throw new Error("synthetic read error");
    const snapshot = {
      path,
      exists: () => true,
      data: () => ({ tree: [] }),
      metadata: { fromCache: false, hasPendingWrites: pendingWrites },
    };
    snapshots.set(path, snapshot);
    return snapshot;
  },
};
const cache = compile(
  "src/lib/teacherCurriculum.ts",
  {
    "firebase/firestore": firestore,
    "./firebase": { auth, db: {} },
    "./permissions": compile("src/lib/permissions.ts", {}),
    "./semesterScope": { getSemesterDocPath: pathFor },
  },
  { Date: { now: () => now } },
);
const contextFor = (
  uid = "teacher-a",
  generation = 1,
  userData = { role: "teacher" },
) => cache.teacherCurriculumContext(uid, generation, userData);
const context = contextFor();
const read = (scope = config, owner = context, options = {}) =>
  cache.readTeacherCurriculumDocument(scope, owner, options);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const first = await Promise.all([read(), read(), read()]);
assert.equal(calls.length, 1, "Parallel teacher pages share one tree read");
assert.equal(first[0], first[1]);
assert.equal(await read(), first[0]);
assert.equal(calls.length, 1, "Recent navigation adds no read");
now += 30_001;
await read();
assert.equal(calls.length, 2, "TTL expiry revalidates on the server");
await read(config, context, { force: true });
assert.equal(calls.length, 3, "Explicit reload bypasses the value cache");
await Promise.all([
  read(config, context, { legacy: true }),
  read(config, context, { legacy: true }),
]);
assert.equal(calls.length, 4);
assert.equal(calls.at(-1), "curriculum/tree");
await read({ year: "2026", semester: "1" });
assert.equal(calls.length, 5, "Semesters have separate entries");
cache.invalidateTeacherCurriculum(config);
await read();
await read(config, context, { legacy: true });
assert.equal(
  calls.length,
  7,
  "Writes invalidate scoped and legacy tree entries",
);

failure = true;
await assert.rejects(read(config, context, { force: true }), /synthetic/);
await assert.rejects(read(), /synthetic/);
assert.equal(calls.length, 9, "Errors are never cached");
failure = false;
await read();
assert.equal(
  calls.length,
  10,
  "Retry recovers without a failed cached promise",
);
pendingWrites = true;
await assert.rejects(read(config, context, { force: true }), /저장 상태/);
pendingWrites = false;
await read();
assert.equal(calls.length, 12, "Unconfirmed snapshots are not reused");

auth.currentUser = null;
await assert.rejects(read(), /로그인 상태/);
assert.equal(calls.length, 12, "Logged-out callers cannot use cached data");
auth.currentUser = { uid: "teacher-a" };
await read(config, contextFor("teacher-a", 2));
assert.equal(
  calls.length,
  13,
  "Same-account reauthentication changes the cache boundary",
);
await read(
  config,
  contextFor("teacher-a", 2, {
    role: "staff",
    teacherPortalEnabled: true,
    staffPermissions: ["lesson_read"],
  }),
);
assert.equal(calls.length, 14, "Permission changes invalidate old metadata");
auth.currentUser = { uid: "teacher-b" };
await read(config, contextFor("teacher-b"));
assert.equal(calls.length, 15, "Another account never reuses a tree response");

const staleGate = deferred();
gate = staleGate.promise;
const stale = read(config, contextFor("teacher-b"), { force: true });
auth.currentUser = { uid: "teacher-c" };
gate = undefined;
await read(config, contextFor("teacher-c"));
staleGate.resolve();
await assert.rejects(stale, /로그인 상태/);
assert.equal(calls.length, 17);
await read(config, contextFor("teacher-c"));
assert.equal(
  calls.length,
  17,
  "A late old-account response does not replace the new cache",
);

const invalidationGate = deferred();
gate = invalidationGate.promise;
const oldRead = read(config, contextFor("teacher-c"), { force: true });
cache.invalidateTeacherCurriculum(config);
gate = undefined;
const newRead = await read(config, contextFor("teacher-c"));
invalidationGate.resolve();
await oldRead;
assert.equal(
  await read(config, contextFor("teacher-c")),
  newRead,
  "A pre-save response cannot repopulate the invalidated cache",
);
assert.equal(calls.length, 19);
console.log(
  "PASS teacher curriculum: one concurrent read, 30s TTL, explicit reload, semester/legacy isolation, write invalidation, error/retry, auth/permission and stale-response boundaries; zero writes or persistent storage.",
);
