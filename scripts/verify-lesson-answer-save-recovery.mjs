// Actual client helper, Gateway, key/coordinator, and callable factory with synthetic I/O.
// No Firebase initialization, network, browser, emulator, or persisted answer data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const sourcePaths = [
  "src/lib/lessonAnswers.ts",
  "src/lib/commandGateway.ts",
  "src/lib/stepUpReauth.ts",
  "src/lib/highRiskCommands.ts",
  "src/lib/semesterScope.ts",
  "src/lib/firebase.ts",
];
const sources = Object.fromEntries(sourcePaths.map(path => [path, readFileSync(path, "utf8")]));
const compile = source => transformSync(source, { loader: "ts", format: "cjs" }).code;
const code = Object.fromEntries(sourcePaths.slice(0, -1).map(path => [path, compile(sources[path])]));
// Same bounded factory extraction used by verify-lesson-core-point-identity.mjs.
const firebaseSource = sources["src/lib/firebase.ts"];
const factorySource = firebaseSource.slice(
  firebaseSource.indexOf("const getHttpsCallable ="),
  firebaseSource.indexOf("const getFirebaseStorage ="),
).replaceAll('import("firebase/functions")', "loadFunctions()")
  .replaceAll('import("./applicationSession")', "loadSession()");
assert.ok(factorySource.includes("assertExpectedOwner"), "actual factory must contain owner guard");
assert.ok(!factorySource.includes("import("), "only controlled factory imports are permitted");
const factoryCode = compile(factorySource + "\nmodule.exports = { getHttpsCallable };\n");
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
const until = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), "controlled asynchronous boundary reached before timeout");
};
const failure = (code, reason = code) => Object.assign(new Error(`Synthetic ${reason}`), {
  code: `functions/${code}`, details: { reason },
});
let networkAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error("Network is forbidden in this fixture"); };
const load = (source, dependencies = {}, globals = {}) => {
  const module = { exports: {} };
  runInNewContext(source, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder,
    fetch: denyNetwork, XMLHttpRequest: denyNetwork, WebSocket: denyNetwork,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unmocked runtime dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  return module.exports;
};
const params = (overrides = {}) => ({
  config: { year: "2026", semester: "2" }, studentUid: "student-a", unitId: "unit-a",
  expectedContentRevision: 3, expectedAnswerRevision: 7,
  answers: { "0": "original A", "worksheet-a": "original PDF A" }, ...overrides,
});
const payload = (overrides = {}) => ({
  semesterId: "2026-2", unitId: "unit-a", expectedSemesterRevision: 4,
  expectedContentRevision: 3, expectedAnswerRevision: 7,
  answers: { "0": "original A" }, ...overrides,
});

const fixture = ({ storage = new Map(), uid = "student-a" } = {}) => {
  const state = {
    auth: { app: { options: { projectId: "demo-lesson-answer-recovery" } }, currentUser: { uid } },
    storage, pointer: { semesterId: "2026-2", revision: 4 }, pointerExists: true,
    pointerReads: [], pointerFailure: null, gates: new Map(), entered: [],
    calls: [], factories: [], preparations: [], stepUps: [], receipts: new Map(),
    revisions: new Map([["student-a/unit-a", 7]]), executeMode: "success", statusMode: "receipt",
  };
  const waitAt = async (phase, name) => {
    const key = `${phase}:${name}`;
    state.entered.push(key);
    if (state.gates.has(key)) await state.gates.get(key).promise;
  };
  const stepUp = load(code["src/lib/stepUpReauth.ts"]);
  const highRisk = load(code["src/lib/highRiskCommands.ts"]);
  const semester = load(code["src/lib/semesterScope.ts"]);
  stepUp.registerStepUpReauthHandler(async name => {
    state.stepUps.push(name);
    await waitAt("step-up", name);
  });
  const receiptKey = (owner, request) => `${owner}/${request.commandType}/${request.commandId}`;
  const executeTransport = request => {
    if (state.executeMode === "session-denied") throw failure("permission-denied", "SESSION_EXPIRED");
    const key = receiptKey(state.auth.currentUser?.uid, request);
    if (state.receipts.has(key)) return { ...state.receipts.get(key), replayed: true };
    const reasons = {
      "answer-conflict": "LESSON_ANSWER_CONFLICT", "content-conflict": "LESSON_CONTENT_CONFLICT",
      "blanks-changed": "LESSON_BLANKS_CHANGED", "patch-conflict": "PATCH_NOTE_CONFLICT",
      "patch-not-found": "PATCH_NOTE_NOT_FOUND",
    };
    if (reasons[state.executeMode]) throw failure(
      state.executeMode === "patch-not-found" ? "not-found" : "aborted", reasons[state.executeMode],
    );
    if (state.executeMode === "lost-empty") throw failure("unavailable");
    let result;
    if (request.commandType === "saveLessonAnswers") {
      const revisionKey = `${state.auth.currentUser?.uid}/${request.payload.unitId}`;
      const revision = state.revisions.get(revisionKey) ?? request.payload.expectedAnswerRevision;
      if (revision !== request.payload.expectedAnswerRevision) throw failure("aborted", "LESSON_ANSWER_CONFLICT");
      result = {
        unitId: request.payload.unitId, answerRevision: revision + 1,
        contentRevision: request.payload.expectedContentRevision, correctCount: 0,
        totalCount: Object.keys(request.payload.answers).length,
        answers: Object.fromEntries(Object.entries(request.payload.answers).map(([key, value]) => [key, { value, status: "wrong" }])),
      };
      state.revisions.set(revisionKey, revision + 1);
    } else result = { noteId: "synthetic-note", noteRevision: 2 };
    const response = { status: "SUCCEEDED", commandType: request.commandType, commandId: request.commandId, replayed: false, result };
    state.receipts.set(key, response);
    if (state.executeMode === "lost-commit") throw failure("unavailable");
    return response;
  };
  const statusTransport = request => {
    if (state.statusMode === "unavailable") throw failure("unavailable");
    if (state.statusMode === "session-denied") throw failure("permission-denied", "SESSION_EXPIRED");
    const receipt = state.receipts.get(receiptKey(state.auth.currentUser?.uid, request));
    return state.statusMode !== "not-found" && receipt
      ? { ...receipt, replayed: true }
      : { commandId: request.commandId, commandType: request.commandType, status: "NOT_FOUND", result: null };
  };
  const firebase = {
    auth: state.auth, db: {},
    getHttpsCallable: async (name, options) => {
      state.factories.push({ name, options: plain(options || {}) });
      const rawCallable = async request => {
        state.calls.push({ name, uid: state.auth.currentUser?.uid, request: plain(request), original: request });
        let response;
        try { response = name === "executeCommand" ? executeTransport(request) : statusTransport(request); }
        catch (error) { await waitAt("error", name); throw error; }
        await waitAt("response", name);
        return { data: response };
      };
      rawCallable.stream = rawCallable;
      const actualFactory = load(factoryCode, {}, {
        auth: state.auth,
        getFirebaseFunctions: async () => { await waitAt("factory", name); return {}; },
        loadFunctions: async () => ({ httpsCallable: () => rawCallable }),
        loadSession: async () => {
          await waitAt("session", name);
          return { prepareCallableDataWithApplicationSession: (_name, request) => {
            state.preparations.push({ name, uid: state.auth.currentUser?.uid });
            return request;
          } };
        },
        ...stepUp, ...highRisk,
      });
      return actualFactory.getHttpsCallable(name, options);
    },
  };
  const storageWindow = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => {
      storage.delete(key);
      state.afterRemove?.();
    },
  } };
  const reload = () => {
    state.gateway = load(code["src/lib/commandGateway.ts"], {
      "./firebase": firebase, "./highRiskCommands": highRisk, "./stepUpReauth": stepUp,
    }, { window: storageWindow });
    state.api = load(code["src/lib/lessonAnswers.ts"], {
      "./firebase": firebase, "./commandGateway": state.gateway, "./semesterScope": semester,
      "firebase/firestore": {
        doc: (_db, path) => ({ path }),
        getDocFromServer: async ref => {
          state.pointerReads.push({ path: ref.path, uid: state.auth.currentUser?.uid });
          await waitAt("pointer", "read");
          if (state.pointerFailure) throw state.pointerFailure;
          return { exists: () => state.pointerExists, data: () => plain(state.pointer) };
        },
      },
    });
  };
  reload();
  state.reload = reload;
  state.writes = () => state.calls.filter(call => call.name === "executeCommand");
  state.statuses = () => state.calls.filter(call => call.name === "getCommandStatus");
  state.handles = () => [...state.storage.values()].map(value => JSON.parse(value));
  state.hold = (phase, name) => {
    const gate = deferred(); state.gates.set(`${phase}:${name}`, gate); return gate;
  };
  return state;
};

const results = [];
const test = async (name, run) => {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack || String(error) }); }
};
const uncertain = async (f, promise) => {
  const outcome = await settle(promise);
  assert.ok(outcome.error, "request must remain uncertain");
  assert.equal(f.api.isLessonAnswerSaveUncertain(outcome.error), true);
  assert.equal(outcome.error.reason, "COMMAND_OUTCOME_UNCONFIRMED");
  assert.equal(outcome.error.outcomeConfirmed, false);
  return outcome.error;
};

await test("frozen A survives uncertainty/new draft B; same ID replay then B uses acknowledged revision", async () => {
  const f = fixture(), input = params();
  const operation = f.api.createLessonAnswerSave(input);
  input.answers["0"] = "edited before first execution";
  input.expectedContentRevision = 100;
  f.executeMode = "lost-commit"; f.statusMode = "unavailable";
  await uncertain(f, f.api.executeLessonAnswerSave(operation));
  const original = f.writes()[0].request;
  assert.equal(original.payload.answers["0"], "original A");
  assert.equal(original.payload.expectedContentRevision, 3);
  assert.equal(original.payload.expectedSemesterRevision, 4);
  assert.equal(f.handles()[0].commandId, original.commandId);
  assert.ok(Object.isFrozen(f.writes()[0].original.payload));
  assert.ok(Object.isFrozen(f.writes()[0].original.payload.answers));
  const newerDraft = { "0": "new draft B", "worksheet-a": "new PDF B" };
  f.pointer.revision = 99;
  f.executeMode = "success";
  const a = await f.api.executeLessonAnswerSave(operation);
  assert.deepEqual(f.writes()[1].request, original);
  assert.equal(a.answerRevision, 8);
  assert.equal(f.pointerReads.length, 1, "A retry must not refresh semester revision");
  assert.equal(f.storage.size, 0);
  assert.equal(await f.api.executeLessonAnswerSave(operation), a, "acknowledged operation caches the actual result");
  assert.equal(f.writes().length, 2);
  const b = await f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params({ answers: newerDraft, expectedAnswerRevision: a.answerRevision })));
  assert.equal(b.answerRevision, 9);
  assert.equal(f.writes()[2].request.payload.expectedAnswerRevision, 8);
  assert.equal(f.writes()[2].request.payload.expectedSemesterRevision, 99);
  assert.deepEqual(f.writes()[2].request.payload.answers, newerDraft);
  assert.notEqual(f.writes()[2].request.commandId, original.commandId);
  assert.equal(f.pointerReads.length, 2);
});

await test("failed pointer read retries without creating a command; operation remains frozen", async () => {
  const f = fixture(), input = params(), operation = f.api.createLessonAnswerSave(input);
  f.pointerFailure = failure("unavailable");
  const outcome = await settle(f.api.executeLessonAnswerSave(operation));
  assert.ok(outcome.error);
  assert.equal(f.api.isLessonAnswerSaveUncertain(outcome.error), false);
  assert.equal(f.writes().length, 0); assert.equal(f.storage.size, 0);
  input.answers["0"] = "later mutation";
  f.pointerFailure = null; f.pointer.revision = 5;
  const result = await f.api.executeLessonAnswerSave(operation);
  assert.equal(result.answers["0"].value, "original A");
  assert.equal(f.writes()[0].request.payload.expectedSemesterRevision, 5);
  assert.equal(f.pointerReads.length, 2);
});

for (const kind of ["missing", "wrong-semester", "invalid-revision"]) {
  await test(`pointer ${kind} sends no command and can recover`, async () => {
    const f = fixture(), operation = f.api.createLessonAnswerSave(params());
    if (kind === "missing") f.pointerExists = false;
    if (kind === "wrong-semester") f.pointer.semesterId = "2025-1";
    if (kind === "invalid-revision") f.pointer.revision = 1.5;
    assert.ok((await settle(f.api.executeLessonAnswerSave(operation))).error);
    assert.equal(f.writes().length, 0); assert.equal(f.storage.size, 0);
    f.pointerExists = true; f.pointer = { semesterId: "2026-2", revision: 4 };
    assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
  });
}

await test("same operation deduplicates both pointer and in-flight command; acknowledged cache checks owner", async () => {
  const f = fixture(), pointerGate = f.hold("pointer", "read"), responseGate = f.hold("response", "executeCommand");
  const operation = f.api.createLessonAnswerSave(params());
  const a = settle(f.api.executeLessonAnswerSave(operation)), b = settle(f.api.executeLessonAnswerSave(operation));
  await until(() => f.pointerReads.length === 1);
  assert.equal(f.writes().length, 0);
  pointerGate.resolve();
  await until(() => f.writes().length === 1);
  const c = settle(f.api.executeLessonAnswerSave(operation)); responseGate.resolve();
  const all = await Promise.all([a, b, c]);
  assert.ok(all.every(item => item.value?.answerRevision === 8));
  assert.equal(f.pointerReads.length, 1); assert.equal(f.writes().length, 1);
  assert.equal(await f.api.executeLessonAnswerSave(operation), all[0].value);
  f.auth.currentUser = { uid: "student-b" };
  assert.ok((await settle(f.api.executeLessonAnswerSave(operation))).error);
  assert.equal(f.writes().length, 1, "cached A result must not be returned to B");
});

await test("actual Gateway coordinator deduplicates identical independent operations", async () => {
  const f = fixture(), gate = f.hold("response", "executeCommand");
  const a = settle(f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params())));
  const b = settle(f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params())));
  await until(() => f.writes().length === 1 && f.pointerReads.length === 2);
  gate.resolve();
  assert.ok((await Promise.all([a, b])).every(item => item.value?.answerRevision === 8));
  assert.equal(f.writes().length, 1);
});

await test("stored handle survives SESSION denial and module reload before same-ID replay", async () => {
  const f = fixture(); f.executeMode = "lost-commit"; f.statusMode = "unavailable";
  await uncertain(f, f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params())));
  const id = f.writes()[0].request.commandId;
  f.reload(); f.executeMode = "session-denied";
  await uncertain(f, f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params())));
  assert.equal(f.writes().at(-1).request.commandId, id);
  assert.equal(f.handles()[0].commandId, id);
  f.reload(); f.executeMode = "success";
  assert.equal((await f.api.executeLessonAnswerSave(f.api.createLessonAnswerSave(params()))).answerRevision, 8);
  assert.equal(f.writes().at(-1).request.commandId, id); assert.equal(f.storage.size, 0);
});

for (const reason of ["answer-conflict", "content-conflict", "blanks-changed"]) {
  await test(`uncertain -> ${reason}: only answer CAS is confirmed and clears handle`, async () => {
    const f = fixture(), operation = f.api.createLessonAnswerSave(params());
    f.executeMode = "lost-empty"; f.statusMode = "not-found";
    await uncertain(f, f.api.executeLessonAnswerSave(operation));
    const id = f.handles()[0].commandId;
    f.executeMode = reason;
    const { error } = await settle(f.api.executeLessonAnswerSave(operation));
    assert.ok(error);
    assert.equal(f.writes().at(-1).request.commandId, id);
    if (reason === "answer-conflict") {
      assert.equal(f.api.isLessonAnswerSaveConflict(error), true);
      assert.equal(error.outcomeConfirmed, true); assert.equal(error.retryable, false);
      assert.equal(f.storage.size, 0);
    } else {
      assert.equal(f.api.isLessonAnswerSaveConflict(error), false);
      assert.equal(f.api.isLessonAnswerSaveUncertain(error), true);
      assert.equal(error.outcomeConfirmed, false); assert.equal(f.handles()[0].commandId, id);
    }
  });
}

await test("committed A receipt replays even after a later answer revision", async () => {
  const f = fixture(), operation = f.api.createLessonAnswerSave(params());
  f.executeMode = "lost-commit"; f.statusMode = "unavailable";
  await uncertain(f, f.api.executeLessonAnswerSave(operation));
  f.revisions.set("student-a/unit-a", 12); f.executeMode = "answer-conflict";
  assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
  assert.equal(f.storage.size, 0);
});

for (const reason of ["patch-conflict", "patch-not-found"]) {
  await test(`teacher compatibility: ${reason} still confirms after uncertainty`, async () => {
    const f = fixture({ uid: "teacher-a" }), draft = { noteId: "one", expectedRevision: 1, content: { body: "memo" } };
    f.executeMode = "lost-empty"; f.statusMode = "not-found";
    await uncertain(f, f.gateway.executeWestoryCommand("updateTeacherPatchNote", draft));
    const id = f.handles()[0].commandId;
    f.executeMode = reason;
    const { error } = await settle(f.gateway.executeWestoryCommand("updateTeacherPatchNote", draft));
    assert.equal(error?.outcomeConfirmed, true); assert.equal(error.retryable, false);
    assert.equal(f.writes().at(-1).request.commandId, id); assert.equal(f.storage.size, 0);
    assert.equal(f.api.isLessonAnswerSaveConflict(error), false);
  });
}

await test("lesson conflict reason on another command is not promoted to confirmed failure", async () => {
  const f = fixture({ uid: "teacher-a" }), draft = { content: { body: "memo" } };
  f.executeMode = "lost-empty"; f.statusMode = "not-found";
  await uncertain(f, f.gateway.executeWestoryCommand("createTeacherPatchNote", draft));
  f.executeMode = "answer-conflict";
  await uncertain(f, f.gateway.executeWestoryCommand("createTeacherPatchNote", draft));
  assert.equal(f.storage.size, 1);
});

await test("pointer response after UID change creates no command or retry handle", async () => {
  const f = fixture(), gate = f.hold("pointer", "read");
  const operation = f.api.createLessonAnswerSave(params()), pending = settle(f.api.executeLessonAnswerSave(operation));
  await until(() => f.pointerReads.length === 1);
  f.auth.currentUser = { uid: "student-b" }; gate.resolve();
  assert.ok((await pending).error); assert.equal(f.writes().length, 0); assert.equal(f.storage.size, 0);
  f.auth.currentUser = { uid: "student-a" };
  assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
});

for (const phase of ["factory", "session", "response"]) {
  await test(`execute ${phase} owner flip blocks application and preserves original handle`, async () => {
    const f = fixture(), gate = f.hold(phase, "executeCommand");
    const operation = f.api.createLessonAnswerSave(params()), pending = settle(f.api.executeLessonAnswerSave(operation));
    await until(() => f.entered.includes(`${phase}:executeCommand`));
    const id = f.handles()[0].commandId;
    f.auth.currentUser = { uid: "student-b" }; gate.resolve();
    const outcome = await pending;
    assert.equal(f.api.isLessonAnswerSaveUncertain(outcome.error), true);
    assert.equal(f.writes().length, phase === "response" ? 1 : 0);
    assert.ok(f.calls.every(call => call.uid === "student-a"));
    assert.equal(f.handles()[0].ownerUid, "student-a"); assert.equal(f.handles()[0].commandId, id);
    assert.equal(f.factories[0].options.expectedUid, "student-a");
    f.gates.clear(); f.auth.currentUser = { uid: "student-a" };
    assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
    assert.equal(f.writes().at(-1).request.commandId, id); assert.equal(f.storage.size, 0);
  });
}

for (const phase of ["factory", "session", "response"]) {
  await test(`automatic status ${phase} owner flip keeps the original committed request unresolved`, async () => {
    const f = fixture(), gate = f.hold(phase, "getCommandStatus");
    f.executeMode = "lost-commit"; f.statusMode = "receipt";
    const operation = f.api.createLessonAnswerSave(params()), pending = settle(f.api.executeLessonAnswerSave(operation));
    await until(() => f.entered.includes(`${phase}:getCommandStatus`));
    const id = f.handles()[0].commandId;
    f.auth.currentUser = { uid: "student-b" }; gate.resolve();
    assert.equal(f.api.isLessonAnswerSaveUncertain((await pending).error), true);
    assert.equal(f.statuses().length, phase === "response" ? 1 : 0);
    assert.ok(f.calls.every(call => call.uid === "student-a"));
    assert.equal(f.handles()[0].commandId, id);
    assert.equal(f.factories.find(item => item.name === "getCommandStatus").options.expectedUid, "student-a");
    f.gates.clear(); f.auth.currentUser = { uid: "student-a" }; f.executeMode = "success";
    assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
    assert.equal(f.writes().at(-1).request.commandId, id); assert.equal(f.storage.size, 0);
  });
}

for (const phase of ["factory", "session", "response"]) {
  await test(`public status ${phase} owner flip does not return another identity's status`, async () => {
    const f = fixture(), gate = f.hold(phase, "getCommandStatus");
    const pending = settle(f.gateway.getWestoryCommandStatus("synthetic-command", "saveLessonAnswers"));
    await until(() => f.entered.includes(`${phase}:getCommandStatus`));
    f.auth.currentUser = { uid: "student-b" }; gate.resolve();
    assert.ok((await pending).error);
    assert.equal(f.statuses().length, phase === "response" ? 1 : 0);
    assert.ok(f.calls.every(call => call.uid === "student-a"));
    assert.equal(f.factories[0].options.expectedUid, "student-a");
  });
}

await test("public high-risk status holds its original owner across step-up", async () => {
  const f = fixture({ uid: "teacher-a" }), gate = f.hold("step-up", "updateTermsSettings");
  const pending = settle(f.gateway.getWestoryCommandStatus("synthetic-command", "updateTermsSettings"));
  await until(() => f.stepUps.length === 1);
  f.auth.currentUser = { uid: "teacher-b" }; gate.resolve();
  assert.ok((await pending).error); assert.equal(f.calls.length, 0);
  assert.equal(f.factories[0].options.expectedUid, "teacher-a");
});

await test("explicit stale expectedUid rejects before storage, factory, or command", async () => {
  const f = fixture({ uid: "student-b" });
  const { error } = await settle(f.gateway.executeWestoryCommand("saveLessonAnswers", payload(), { expectedUid: "student-a" }));
  assert.equal(error?.code, "IDENTITY_CHANGED");
  assert.equal(f.calls.length, 0); assert.equal(f.factories.length, 0); assert.equal(f.storage.size, 0);
});

for (const recovered of [false, true]) {
  await test(`${recovered ? "status recovery" : "execute success"} owner flip during handle removal restores original handle`, async () => {
    const f = fixture(), operation = f.api.createLessonAnswerSave(params());
    if (recovered) { f.executeMode = "lost-commit"; f.statusMode = "receipt"; }
    f.afterRemove = () => { f.auth.currentUser = { uid: "student-b" }; };
    await uncertain(f, f.api.executeLessonAnswerSave(operation));
    const originalId = f.writes()[0].request.commandId;
    assert.equal(f.handles()[0].commandId, originalId);
    assert.equal(f.handles()[0].ownerUid, "student-a");
    assert.equal(f.statuses().length, recovered ? 1 : 0);
    f.afterRemove = null; f.auth.currentUser = { uid: "student-a" }; f.executeMode = "success";
    assert.equal((await f.api.executeLessonAnswerSave(operation)).answerRevision, 8);
    assert.equal(f.writes().at(-1).request.commandId, originalId); assert.equal(f.storage.size, 0);
  });
}

await test("late answer conflict after owner flip is not classified as confirmed failure", async () => {
  const f = fixture(), operation = f.api.createLessonAnswerSave(params());
  f.executeMode = "lost-empty"; f.statusMode = "not-found";
  await uncertain(f, f.api.executeLessonAnswerSave(operation));
  const id = f.handles()[0].commandId;
  f.executeMode = "answer-conflict";
  const gate = f.hold("error", "executeCommand");
  const before = f.entered.filter(value => value === "error:executeCommand").length;
  const pending = settle(f.api.executeLessonAnswerSave(operation));
  await until(() => f.entered.filter(value => value === "error:executeCommand").length > before);
  f.auth.currentUser = { uid: "student-b" }; gate.resolve();
  const { error } = await pending;
  assert.equal(f.api.isLessonAnswerSaveUncertain(error), true);
  assert.equal(f.api.isLessonAnswerSaveConflict(error), false);
  assert.equal(f.handles()[0].commandId, id);
});

assert.equal(networkAttempts, 0);
const failures = results.filter(result => !result.passed);
console.log(JSON.stringify({
  passed: failures.length === 0, cases: results.length, failed: failures.length,
  networkAttempts, stagingAccess: 0, productionAccess: 0,
  actualSources: sourcePaths,
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(sources[path]).digest("hex")])),
  limits: "Synthetic transport, pointer, auth state and storage; no actual Firebase initializer, browser UI, Rules, server transaction, Google or multi-context acceptance.",
  results,
}, null, 2));
if (failures.length) process.exitCode = 1;
