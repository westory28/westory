import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual page loader with controlled server promises. DOM layout
// is checked separately in the browser; this checks the asynchronous boundary.
const source = readFileSync("src/pages/teacher/StudentList.tsx", "utf8");
const tree = ts.createSourceFile(
  "StudentList.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let loader;
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(tree) === "fetchStudents"
  )
    loader = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
};
visit(tree);
assert.ok(loader);
const compiled = ts.transpileModule(
  `const fetchStudents = ${loader}; return fetchStudents;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const row = {
  id: "synthetic-student",
  userId: "synthetic-student",
  name: "합성 학생",
  number: 1,
  email: "",
};
const state = {
  semesterId: "2026-2",
  provenance: "CURRENT",
  legacy: false,
  readOnly: false,
  enrollments: [{ studentUid: row.id, enrollmentStatus: "ACTIVE" }],
};
const harness = () => {
  const archive = deferred(),
    profiles = deferred();
  const values = {
    loading: true,
    profilesLoading: false,
    students: [],
    filteredStudents: [],
    profilesError: "",
    loadError: "",
  };
  const listRequestRef = { current: 0 };
  let profileRequests = 0;
  const context = {
    listRequestRef,
    config: { year: "2026", semester: "2" },
    userData: { role: "teacher" },
    currentUser: { email: "synthetic@example.invalid" },
    canEditStudentList: () => true,
    getArchiveEnrollmentState: (query) => {
      assert.equal(query.source, "CURRENT");
      return archive.promise;
    },
    loadStudentProfileEditStates: () => {
      profileRequests++;
      return profiles.promise;
    },
    scopedConfigFromSemesterId: () => ({ year: "2026", semester: "2" }),
    toStudentList: async (_state, supplied) => [
      { ...row, ...(supplied?.get(row.id) || {}) },
    ],
    sortStudents: (rows) => rows,
    console: { error() {} },
  };
  for (const name of [
    "Loading",
    "LoadError",
    "ProfilesError",
    "ProfilesLoading",
    "SemesterId",
    "ScopeReadOnly",
    "Students",
    "FilteredStudents",
  ])
    context["set" + name] = (value) => {
      values[name[0].toLowerCase() + name.slice(1)] = value;
    };
  const run = new Function(...Object.keys(context), compiled)(
    ...Object.values(context),
  );
  return {
    run,
    archive,
    profiles,
    values,
    listRequestRef,
    requests: () => profileRequests,
  };
};
const replyProfiles = () =>
  new Map([
    [
      row.id,
      {
        profile: {
          name: row.name,
          number: "1",
          email: "synthetic@example.invalid",
        },
        expectedVersion: "fixture-version",
      },
    ],
  ]);

const normal = harness();
const work = normal.run();
normal.archive.resolve(state);
await flush();
assert.equal(
  normal.values.loading,
  false,
  "canonical roster must release the initial loader before profiles finish",
);
assert.equal(normal.values.profilesLoading, true);
assert.equal(normal.values.students[0].name, row.name);
assert.equal(
  normal.values.students[0].editState,
  undefined,
  "preview rows must not carry a made-up mutation version",
);
assert.equal(normal.requests(), 1);
normal.profiles.resolve(replyProfiles());
await work;
assert.equal(normal.values.students[0].email, "synthetic@example.invalid");
assert.equal(
  normal.values.students[0].editState.expectedVersion,
  "fixture-version",
);
assert.equal(normal.values.profilesLoading, false);

const failed = harness();
const failedWork = failed.run();
failed.archive.resolve(state);
await flush();
failed.profiles.reject(new Error("synthetic backend failure"));
await failedWork;
assert.equal(failed.values.students[0].name, row.name);
assert.ok(failed.values.profilesError);
assert.equal(failed.values.loadError, "");

const stale = harness();
const staleWork = stale.run();
stale.archive.resolve(state);
await flush();
stale.listRequestRef.current++;
const prior = structuredClone(stale.values);
stale.profiles.resolve(replyProfiles());
await staleWork;
assert.deepEqual(
  stale.values,
  prior,
  "unmounted or changed-scope requests must not update any state",
);

const staleInitial = harness();
const staleInitialWork = staleInitial.run();
staleInitial.listRequestRef.current++;
staleInitial.archive.resolve(state);
await staleInitialWork;
assert.equal(staleInitial.requests(), 0);
assert.equal(staleInitial.values.students.length, 0);

const legacy = harness();
const legacyWork = legacy.run();
legacy.archive.resolve({ ...state, legacy: true, provenance: "LEGACY" });
await flush();
assert.equal(
  legacy.values.loading,
  true,
  "legacy reads must preserve the complete existing profile path",
);
assert.equal(legacy.values.students.length, 0);
legacy.profiles.resolve(replyProfiles());
await legacyWork;
assert.equal(legacy.values.loading, false);

console.log(
  JSON.stringify({
    suite: "student-roster-progressive-loading",
    passed: true,
    scenarios: 5,
    networkRequests: 0,
    writes: 0,
  }),
);
