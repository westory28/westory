import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the production export, without duplicating its batching algorithm.
// Only Firebase reads are simulated. The scope helper is production code;
// any attempt to use the unneeded command gateway fails immediately.
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const studentSource = compile("../src/lib/studentData.ts");
const scopeSource = compile("../src/lib/semesterScope.ts");
const evaluate = (source, require, filename) => {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, {
    filename,
  })(require, module, module.exports);
  return module.exports;
};
const unexpectedImport = (name) => {
  throw new Error(`Unexpected runtime import: ${name}`);
};
const scope = evaluate(scopeSource, unexpectedImport, "semesterScope.ts");
const config = { year: "2026", semester: "2" };
const uids = (count) => Array.from({ length: count }, (_, i) => `fixture-${i}`);

const createHarness = () => {
  const auth = { currentUser: { uid: "fixture-admin" } };
  const requests = [];
  let active = 0;
  let peak = 0;
  let mutationAttempts = 0;
  const firebase = {
    auth,
    getHttpsCallable: async (name) => {
      assert.equal(name, "getStudentEnrollmentProfileState");
      return (payload) => {
        active += 1;
        peak = Math.max(peak, active);
        assert.ok(payload.studentUids.length <= 100);
        assert.equal(payload.semesterId, "2026-2");
        let settled = false;
        return new Promise((resolve, reject) => {
          requests.push({
            payload,
            finish(error, data) {
              assert.equal(settled, false, "a request may settle only once");
              settled = true;
              active -= 1;
              if (error) reject(error);
              else resolve({ data });
            },
          });
        });
      };
    },
  };
  const commandGateway = new Proxy(
    {},
    {
      get() {
        mutationAttempts += 1;
        throw new Error("The read-only batch test must never use commands");
      },
    },
  );
  const module = evaluate(
    studentSource,
    (name) => {
      if (name === "./firebase") return firebase;
      if (name === "./semesterScope") return scope;
      if (name === "./commandGateway") return commandGateway;
      return unexpectedImport(name);
    },
    "studentData.ts",
  );
  const reply = (index, overrides = {}) => {
    const request = requests[index];
    request.finish(null, {
      semesterId: request.payload.semesterId,
      students: request.payload.studentUids.map((studentUid) => ({
        studentUid,
        source: "CANONICAL",
        expectedVersion: `version-${studentUid}`,
        profile: {
          grade: "3",
          class: "1",
          number: "1",
          name: studentUid,
          email: "fixture@example.invalid",
        },
      })),
      classes: [
        { classId: "fixture-class", grade: "3", classNumber: "1", revision: 1 },
      ],
      ...overrides,
    });
  };
  return {
    auth,
    requests,
    reply,
    reject: (index, error) => requests[index].finish(error),
    run: (ids) => module.loadStudentProfileEditStates(config, ids),
    peak: () => peak,
    assertNoWrites: () => assert.equal(mutationAttempts, 0),
  };
};
const waitForRequests = async (harness, count) => {
  // All work is local promises; no timers, sockets, or Firebase SDK are loaded.
  for (let i = 0; i < 30 && harness.requests.length < count; i += 1)
    await Promise.resolve();
  assert.equal(harness.requests.length, count);
};

// 321 unique students launch four requests together, and duplicate input IDs
// never produce duplicate lookups. Out-of-order responses still assemble all.
{
  const h = createHarness();
  const ids = uids(321);
  const pending = h.run([...ids, ids[0], ...ids.slice(90, 115)]);
  await waitForRequests(h, 4);
  assert.deepEqual(
    h.requests.map((r) => r.payload.studentUids.length),
    [100, 100, 100, 21],
  );
  assert.equal(h.peak(), 4, "the four batches must actually run in parallel");
  assert.deepEqual(
    h.requests.flatMap((r) => r.payload.studentUids),
    ids,
  );
  for (const index of [3, 1, 2, 0]) h.reply(index);
  const states = await pending;
  assert.equal(states.size, 321);
  for (const uid of ids) {
    const state = states.get(uid);
    assert.equal(state.studentUid, uid);
    assert.equal(state.profile.name, uid);
    assert.equal(state.semesterId, "2026-2");
    assert.equal(state.ownerUid, "fixture-admin");
    assert.equal(state.classes[0].classId, "fixture-class");
  }
  h.assertNoWrites();
}

// More than 400 students must wait for the preceding group to settle.
{
  const h = createHarness();
  const pending = h.run(uids(825));
  await waitForRequests(h, 4);
  h.reply(0);
  h.reply(1);
  h.reply(2);
  await waitForRequests(h, 4);
  h.reply(3);
  await waitForRequests(h, 8);
  for (let index = 4; index < 8; index += 1) h.reply(index);
  await waitForRequests(h, 9);
  h.reply(8);
  assert.equal((await pending).size, 825);
  assert.equal(h.peak(), 4);
  assert.deepEqual(
    h.requests.map((r) => r.payload.studentUids.length),
    [100, 100, 100, 100, 100, 100, 100, 100, 25],
  );
  h.assertNoWrites();
}

// A foreign-semester response aborts the operation before the next group.
{
  const h = createHarness();
  let returned = false;
  const pending = h.run(uids(501)).then((result) => {
    returned = true;
    return result;
  });
  const rejected = assert.rejects(pending, /조회 학기가 바뀌었습니다/);
  await waitForRequests(h, 4);
  h.reply(0, { semesterId: "2026-1" });
  for (let index = 1; index < 4; index += 1) h.reply(index);
  await rejected;
  assert.equal(returned, false);
  assert.equal(h.requests.length, 4);
  h.assertNoWrites();
}

// Even after assembling 400 records internally, neither an identity change
// nor a later failed batch may return partial results to the caller.
for (const failure of ["identity", "network"]) {
  const h = createHarness();
  let returned = false;
  const pending = h.run(uids(501)).then((result) => {
    returned = true;
    return result;
  });
  const rejected = assert.rejects(
    pending,
    failure === "identity" ? /로그인 사용자가 바뀌었습니다/ : /fixture offline/,
  );
  await waitForRequests(h, 4);
  for (let index = 0; index < 4; index += 1) h.reply(index);
  await waitForRequests(h, 6);
  if (failure === "identity") {
    h.auth.currentUser = { uid: "another-admin" };
    h.reply(4);
    h.reply(5);
  } else {
    h.reject(4, new Error("fixture offline"));
    h.reply(5);
  }
  await rejected;
  assert.equal(returned, false);
  assert.equal(h.requests.length, 6);
  assert.equal(h.peak(), 4);
  h.assertNoWrites();
}

{
  const h = createHarness();
  h.auth.currentUser = null;
  await assert.rejects(h.run(uids(1)), /로그인 사용자가 바뀌었습니다/);
  assert.equal(h.requests.length, 0);
  h.assertNoWrites();
}

console.log(
  JSON.stringify({
    suite: "student-profile-batching",
    passed: true,
    implementation: "actual studentData.loadStudentProfileEditStates",
    scenarios: 6,
    checks: [
      "321 students in four concurrent requests",
      "deduplicated input",
      "825 students with concurrency capped at four",
      "semester mismatch rejected",
      "identity change rejected",
      "late batch failure never returns partial results",
      "unauthenticated request rejected before reads",
    ],
    networkRequests: 0,
    writes: 0,
  }),
);
