import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";

// Run the real assessment and application-session adapters. Only SDK/network
// boundaries are synthetic; no production accounts, records or writes are used.
const compiled = new Map();
const compile = (name) => {
  if (!compiled.has(name)) {
    compiled.set(
      name,
      ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    );
  }
  return compiled.get(name);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = () => new Promise(setImmediate);
const failure = (code) => Object.assign(new Error(code), { code });
function harness({ storage = new Map(), receipts = new Map() } = {}) {
  const state = {
    epoch: 1700000000,
    holdCommand: null,
    holdOpen: null,
    onCommand: null,
    onAdapterCheck: null,
    commandError: null,
    statusError: null,
    commitThenThrow: null,
    blockedStorage: false,
    applied: 0,
  };
  const calls = [];
  const makeUser = (uid = "synthetic-student") => ({
    uid,
    getIdTokenResult: async () => ({ claims: { auth_time: state.epoch } }),
  });
  const auth = { currentUser: makeUser() };
  const firebase = {
    auth,
    getHttpsCallable: async (name) => async (input) => {
      const uid = auth.currentUser?.uid;
      calls.push({ name, input, uid });
      if (name === "openApplicationSession") {
        const authTime = state.epoch;
        if (state.holdOpen) await state.holdOpen;
        return {
          data: {
            status: "active",
            authTime,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            revision: "a".repeat(64),
          },
        };
      }
      if (name === "getCommandStatus") {
        if (state.statusError) throw state.statusError;
        return {
          data: receipts.get(`${uid}:${input.commandId}`) || {
            commandId: input.commandId,
            commandType: input.commandType,
            status: "NOT_FOUND",
            result: null,
          },
        };
      }
      if (state.holdCommand) await state.holdCommand;
      if (state.commandError) throw state.commandError;
      const id = input.commandId || input.saveId;
      const receiptKey = `${uid}:${id}`;
      let data = receipts.get(receiptKey);
      if (!data) {
        state.applied++;
        data =
          name === "saveAssessmentProgress"
            ? {
                attemptId: input.attemptId,
                revision: input.expectedRevision + 1,
                status: "IN_PROGRESS",
              }
            : {
                commandId: id,
                commandType: input.commandType,
                status: "SUCCEEDED",
                result: { attemptId: "synthetic-attempt", status: "STARTED" },
              };
        receipts.set(receiptKey, data);
      }
      state.onCommand?.(name);
      if (state.commitThenThrow) throw state.commitThenThrow;
      return { data };
    },
  };
  const modules = new Map();
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(compile(name), {
      exports,
      crypto: { randomUUID },
      console,
      setTimeout,
      clearTimeout,
      window: {
        sessionStorage: {
          getItem(key) {
            if (state.blockedStorage) throw Error("storage blocked");
            return storage.get(key) || null;
          },
          setItem(key, value) {
            if (state.blockedStorage) throw Error("storage blocked");
            storage.set(key, value);
          },
          removeItem(key) {
            if (state.blockedStorage) throw Error("storage blocked");
            storage.delete(key);
          },
        },
      },
      require(dependency) {
        if (dependency === "./firebase") return firebase;
        if (dependency === "./semesterArchive")
          return { isSemesterArchive: false };
        if (dependency === "./sensitiveOperation")
          return { ensureSensitiveOperation: async () => {} };
        if (dependency === "firebase/auth")
          return {
            getIdTokenResult: async () => {
              state.onAdapterCheck?.();
              return { authTime: new Date(state.epoch * 1000).toISOString() };
            },
          };
        if (dependency.startsWith("./")) return load(dependency.slice(2));
        throw Error(`Unexpected dependency: ${dependency}`);
      },
    });
    return exports;
  };
  return {
    api: load("assessmentLifecycle"),
    auth,
    state,
    calls,
    makeUser,
    storage,
    receipts,
    mutations: () =>
      calls.filter(
        ({ name }) =>
          name === "executeCommand" || name === "saveAssessmentProgress",
      ),
    statuses: () => calls.filter(({ name }) => name === "getCommandStatus"),
  };
}

let cases = 0;
const check = async (name, run) => {
  try {
    await run();
    cases++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
const start = (h) =>
  h.api.startAssessmentAttempt({
    definitionId: "quiz:2026-2:fixture:exam_prep:round_1",
  });
const save = (h) =>
  h.api.saveAssessmentProgress({
    attemptId: "synthetic-attempt",
    expectedRevision: 2,
    answers: { 1: "합성 답안" },
    currentItemId: "1",
  });
const idOf = (call) => call.input.commandId || call.input.saveId;

for (const [label, invoke] of [
  ["START", start],
  ["autosave", save],
]) {
  for (const boundary of ["session wrapper", "assessment owner guard"]) {
    await check(
      `${label} keeps its committed receipt across ${boundary} auth changes`,
      async () => {
        const h = harness();
        h.state.onCommand = () => {
          if (boundary === "session wrapper") h.state.epoch++;
          else
            h.state.onAdapterCheck = () => {
              h.state.onAdapterCheck = null;
              h.state.epoch++;
            };
        };
        await assert.rejects(invoke(h), {
          applicationSessionResponseReceived: true,
        });
        assert.equal(h.mutations().length, 1, "No automatic write replay");
        assert.equal(h.statuses().length, 0, "No old-epoch status read");
        const first = idOf(h.mutations()[0]);
        h.state.onCommand = null;
        await invoke(h);
        assert.equal(
          idOf(h.mutations()[1]),
          first,
          "Explicit retry keeps the receipt",
        );
        assert.equal(
          h.state.applied,
          1,
          "Retry does not create another server effect",
        );
      },
    );
  }
}

await check(
  "A different account cannot receive or recover the previous owner's response",
  async () => {
    const h = harness();
    h.state.onCommand = () => {
      h.auth.currentUser = h.makeUser("other-student");
    };
    await assert.rejects(start(h), {
      applicationSessionResponseReceived: true,
    });
    const original = idOf(h.mutations()[0]);
    h.state.onCommand = null;
    await start(h);
    assert.notEqual(idOf(h.mutations()[1]), original);
    assert.equal(h.mutations()[1].uid, "other-student");
    h.auth.currentUser = h.makeUser();
    await start(h);
    assert.equal(
      idOf(h.mutations()[2]),
      original,
      "Original owner retains its own receipt",
    );
    assert.equal(h.statuses().length, 0);
  },
);

await check(
  "Account changes before the session opens issue no mutation",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.holdOpen = gate.promise;
    const rejected = assert.rejects(start(h));
    await flush();
    h.auth.currentUser = h.makeUser("other-student");
    gate.resolve();
    await rejected;
    assert.equal(h.mutations().length, 0);
  },
);

for (const code of [
  "functions/internal",
  "functions/unavailable",
  "functions/deadline-exceeded",
]) {
  await check(
    `${code} recovers a committed START by reading its receipt`,
    async () => {
      const h = harness();
      h.state.commitThenThrow = failure(code);
      const result = await start(h);
      assert.equal(result.attemptId, "synthetic-attempt");
      assert.equal(h.mutations().length, 1);
      assert.equal(h.statuses().length, 1);
      assert.equal(h.state.applied, 1);
    },
  );
}

await check(
  "Lost START and status responses keep the same receipt after page reload",
  async () => {
    const h = harness();
    h.state.commitThenThrow = failure("functions/unavailable");
    h.state.statusError = failure("functions/unavailable");
    await assert.rejects(start(h));
    const first = idOf(h.mutations()[0]);
    const restored = harness({ storage: h.storage, receipts: h.receipts });
    await start(restored);
    assert.equal(idOf(restored.mutations()[0]), first);
    assert.equal(restored.state.applied, 0);
  },
);

await check(
  "Concurrent START requests and blocked storage preserve one receipt",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.blockedStorage = true;
    h.state.holdCommand = gate.promise;
    h.state.commitThenThrow = failure("functions/deadline-exceeded");
    h.state.statusError = failure("functions/unavailable");
    const pending = [assert.rejects(start(h)), assert.rejects(start(h))];
    await flush();
    gate.resolve();
    await Promise.all(pending);
    assert.equal(h.mutations().length, 2);
    assert.equal(idOf(h.mutations()[0]), idOf(h.mutations()[1]));
    assert.equal(h.state.applied, 1);
    h.state.commitThenThrow = null;
    h.state.statusError = null;
    await start(h);
    assert.equal(idOf(h.mutations()[2]), idOf(h.mutations()[0]));
    assert.equal(h.state.applied, 1);
  },
);

await check(
  "Definite pre-commit denial clears its receipt and is never replayed automatically",
  async () => {
    const h = harness();
    h.state.commandError = failure("functions/permission-denied");
    await assert.rejects(start(h));
    assert.equal(h.state.applied, 0);
    assert.equal(h.statuses().length, 0);
    h.state.commandError = null;
    await start(h);
    assert.notEqual(idOf(h.mutations()[0]), idOf(h.mutations()[1]));
  },
);

console.log(
  `Assessment recovery: ${cases} cases passed; committed response/epoch guards, owner isolation, lost-response receipts, concurrent START, blocked storage and explicit retries; network 0.`,
);
