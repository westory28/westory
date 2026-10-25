import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";

// Execute real client modules against synthetic SDK boundaries only. No live
// Firebase credentials, network requests, student records or writes are used.
const code = new Map();
const compile = (name) => {
  if (!code.has(name))
    code.set(
      name,
      ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    );
  return code.get(name);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = () => new Promise(setImmediate);
const error = (code, reason) =>
  Object.assign(new Error(code), {
    code,
    ...(reason ? { details: { reason } } : {}),
  });
function harness() {
  const calls = [],
    modules = new Map();
  const state = {
    epoch: 1234,
    holdOpen: null,
    holdCommand: null,
    commandError: null,
    onCommand: null,
  };
  const makeUser = (uid = "synthetic-teacher") => ({
    uid,
    getIdTokenResult: async () => ({ claims: { auth_time: state.epoch } }),
  });
  const auth = { currentUser: makeUser() };
  const firebase = {
    auth,
    db: {},
    getHttpsCallable: async (name) => async (input) => {
      calls.push({ name, input });
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
      if (state.holdCommand) await state.holdCommand;
      if (state.commandError) throw state.commandError;
      state.onCommand?.(name);
      if (name === "getStudentEnrollmentProfileState")
        return {
          data: {
            semesterId: "2026-2",
            students: [
              {
                studentUid: "student",
                source: "CANONICAL",
                expectedVersion: "a".repeat(64),
                profile: { email: "student@example.test" },
              },
            ],
            classes: [
              { classId: "class", grade: "3", classNumber: "1", revision: 1 },
            ],
          },
        };
      return {
        data: {
          status: "SUCCEEDED",
          result: {
            resources: [],
            studentUid: "student",
            semesterId: "2026-2",
          },
          deleted: true,
        },
      };
    },
  };
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(compile(name), {
      exports,
      crypto: { randomUUID },
      console,
      require: (dependency) => {
        if (dependency === "./firebase") return firebase;
        if (dependency === "./semesterArchive")
          return { isSemesterArchive: false };
        if (dependency === "./semesterScope")
          return { getYearSemester: (value) => value };
        if (dependency === "./sensitiveOperation")
          return { ensureSensitiveOperation: async () => {} };
        if (dependency === "./appCheck")
          return { ensureWestoryAppCheck: async () => {} };
        if (dependency === "./brandWatermark")
          return {
            watermarkImageBlob: () => {
              throw new Error("Unexpected image conversion in session checks");
            },
          };
        if (dependency === "firebase/auth") return { onAuthStateChanged() {} };
        if (dependency === "firebase/firestore")
          return {
            doc: (...args) => args,
            getDocFromServer: async () => ({
              data: () => ({ semesterId: "2026-2", revision: 1 }),
            }),
            onSnapshot() {},
          };
        if (dependency.startsWith("./")) return load(dependency.slice(2));
        throw new Error(`Unexpected dependency: ${dependency}`);
      },
    });
    return exports;
  };
  return {
    api: load("applicationSession"),
    load,
    auth,
    state,
    calls,
    makeUser,
    opens: () =>
      calls.filter((call) => call.name === "openApplicationSession").length,
    commands: () =>
      calls.filter((call) => call.name !== "openApplicationSession"),
  };
}
let cases = 0;
const check = async (name, run) => {
  try {
    await run();
    cases++;
  } catch (failure) {
    failure.message = `${name}: ${failure.message}`;
    throw failure;
  }
};
const scope = { year: "2026", semester: "2" };
const commandScope = { semesterId: "2026-2", expectedSemesterRevision: 1 };
const mapSource = {
  mapId: "map",
  originScope: "semester",
  expectedRevision: 1,
  sourceExists: true,
  sourceHash: "a".repeat(64),
};

await check(
  "Startup proof is shared by all six adapters without another handshake",
  async () => {
    const h = harness();
    await h.api.prepareApplicationSession(h.auth.currentUser);
    await (
      await h
        .load("historyDictionarySession")
        .getHistoryDictionaryCallable("getDictionary")
    )({});
    await h
      .load("lessonManagement")
      .saveLessonTree(
        scope,
        { expectedRevision: 1, tree: [] },
        { commandScope },
      );
    await h.load("mapManagementCommands").deleteMapResource(scope, mapSource);
    await h
      .load("studentProfileCommands")
      .callStudentDataService("getStudentData", {});
    await h.load("academicCalendar").mutateAcademicCalendar({
      ...scope,
      action: "SAVE_CATEGORIES",
      items: [],
    });
    assert.equal(
      await h.load("noticeImages").tryDeleteNoticeImage("notice/image"),
      true,
    );
    assert.equal(h.opens(), 1);
    assert.equal(h.commands().length, 6);
    h.commands().forEach(({ input }) =>
      assert.equal(input._session.revision, "a".repeat(64)),
    );
  },
);
await check(
  "Startup never skips server validation because a completed proof exists",
  async () => {
    const h = harness();
    await h.api.prepareApplicationSession(h.auth.currentUser);
    await h.api.ensureApplicationSessionProof();
    await h.api.prepareApplicationSession(h.auth.currentUser);
    assert.equal(h.opens(), 2);
  },
);
await check(
  "Concurrent startup and operations share the same pending handshake",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.holdOpen = gate.promise;
    const startup = h.api.prepareApplicationSession(h.auth.currentUser);
    const commands = Array.from({ length: 8 }, (_, n) =>
      h.api.callWithApplicationSession("command", { n }),
    );
    await flush();
    assert.equal(h.opens(), 1);
    gate.resolve();
    await Promise.all([startup, ...commands]);
    assert.equal(h.opens(), 1);
    assert.equal(h.commands().length, 8);
  },
);
for (const boundary of ["same-uid", "other-user", "epoch", "logout"]) {
  await check(`Proof never crosses ${boundary}`, async () => {
    const h = harness();
    await h.api.ensureApplicationSessionProof();
    if (boundary === "epoch") h.state.epoch++;
    else if (boundary === "logout")
      h.api.invalidateApplicationSession(h.auth.currentUser);
    else
      h.auth.currentUser = h.makeUser(
        boundary === "same-uid" ? "synthetic-teacher" : "other",
      );
    await h.api.ensureApplicationSessionProof();
    assert.equal(h.opens(), 2);
  });
}
await check("Fresh proof explicitly revalidates at the server", async () => {
  const h = harness();
  await h.api.ensureApplicationSessionProof();
  await h.api.ensureApplicationSessionProof(h.auth.currentUser, {
    fresh: true,
  });
  assert.equal(h.opens(), 2);
});
await check(
  "A new epoch verifies immediately and retains its proof after the old flight settles",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.holdOpen = gate.promise;
    const old = h.api.prepareApplicationSession(h.auth.currentUser);
    const rejected = assert.rejects(old);
    await flush();
    h.state.epoch++;
    h.state.holdOpen = null;
    const fresh = h.api.prepareApplicationSession(h.auth.currentUser, {
      fresh: true,
    });
    await flush();
    assert.equal(
      h.opens(),
      2,
      "An earlier auth epoch cannot hold up a new login",
    );
    await fresh;
    const proof = await h.api.ensureApplicationSessionProof();
    gate.resolve();
    await rejected;
    assert.equal(await h.api.ensureApplicationSessionProof(), proof);
    assert.equal(h.opens(), 2);
  },
);
await check(
  "Concurrent consumers adopt one new auth epoch without an authentication error",
  async () => {
    const h = harness();
    await h.api.ensureApplicationSessionProof();
    h.state.epoch++;
    const result = await Promise.allSettled([
      h.api.ensureApplicationSessionProof(h.auth.currentUser),
      h.api.prepareApplicationSession(h.auth.currentUser, { fresh: true }),
    ]);
    result.forEach((item) => assert.equal(item.status, "fulfilled"));
    await h.api.ensureApplicationSessionProof();
    assert.ok(
      h.opens() >= 2 && h.opens() <= 3,
      "Fresh retry may drain one concurrent renewal, without any open loop",
    );
  },
);
await check(
  "Logout invalidates a pending success even if the same User object returns",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.holdOpen = gate.promise;
    const pending = h.api.ensureApplicationSessionProof();
    const rejected = assert.rejects(pending);
    await flush();
    h.api.invalidateApplicationSession(h.auth.currentUser);
    gate.resolve();
    await rejected;
    h.state.holdOpen = null;
    await h.api.ensureApplicationSessionProof();
    assert.equal(h.opens(), 2);
  },
);
for (const failure of [
  error("functions/unavailable"),
  error("functions/permission-denied"),
  error("functions/unauthenticated", "APP_CHECK_REQUIRED"),
]) {
  await check(
    `Transient/non-session failure keeps proof: ${failure.details?.reason || failure.code}`,
    async () => {
      const h = harness();
      await h.api.prepareApplicationSession(h.auth.currentUser);
      h.state.commandError = failure;
      await assert.rejects(h.api.callWithApplicationSession("command", {}));
      assert.equal(
        h.commands().length,
        1,
        "Never replay commands automatically",
      );
      h.state.commandError = null;
      await h.api.callWithApplicationSession("command", {});
      assert.equal(h.opens(), 1);
    },
  );
}
for (const failure of [
  error("functions/unauthenticated"),
  error("functions/failed-precondition", "SESSION_REAUTH_REQUIRED"),
]) {
  await check(
    `Explicit session denial invalidates proof: ${failure.details?.reason || failure.code}`,
    async () => {
      const h = harness();
      await h.api.ensureApplicationSessionProof();
      h.state.commandError = failure;
      await assert.rejects(h.api.callWithApplicationSession("command", {}));
      assert.equal(h.commands().length, 1);
      h.state.commandError = null;
      await h.api.callWithApplicationSession("command", {});
      assert.equal(h.opens(), 2);
    },
  );
}
await check(
  "Late old-epoch response never clears a newer verified proof",
  async () => {
    const h = harness(),
      gate = deferred();
    h.state.holdCommand = gate.promise;
    const old = h.api.callWithApplicationSession("command", {});
    const rejected = assert.rejects(old);
    await flush();
    h.state.epoch++;
    await h.api.prepareApplicationSession(h.auth.currentUser);
    gate.resolve();
    await rejected;
    await h.api.ensureApplicationSessionProof();
    assert.equal(h.opens(), 2);
  },
);
for (const adapter of ["lesson", "map", "student"]) {
  await check(
    `${adapter} retains the receipt after a successful write crosses auth epochs`,
    async () => {
      const h = harness();
      const save =
        adapter === "lesson"
          ? () =>
              h
                .load("lessonManagement")
                .saveLessonTree(
                  scope,
                  { expectedRevision: 1, tree: [] },
                  { commandScope },
                )
          : adapter === "map"
            ? () =>
                h
                  .load("mapManagementCommands")
                  .deleteMapResource(scope, mapSource)
            : () =>
                h
                  .load("studentProfileCommands")
                  .updateCanonicalStudentProfile(scope, {
                    uid: "student",
                    grade: "3",
                    class: "1",
                    number: "1",
                    name: "Test",
                    email: "student@example.test",
                  });
      h.state.onCommand = (name) => {
        if (name === "executeCommand") h.state.epoch++;
      };
      await assert.rejects(save(), {
        applicationSessionResponseReceived: true,
      });
      const first = h.calls.find((call) => call.name === "executeCommand").input
        .commandId;
      assert.equal(
        h.calls.filter((call) => call.name === "executeCommand").length,
        1,
      );
      assert.equal(
        h.calls.filter((call) => call.name === "getCommandStatus").length,
        0,
      );
      h.state.onCommand = null;
      await save();
      const executed = h.calls.filter((call) => call.name === "executeCommand");
      assert.equal(executed.length, 2);
      assert.equal(executed[1].input.commandId, first);
    },
  );
}
console.log(
  `Application session proof reuse: ${cases} deterministic cases passed; six adapters share startup proof, epoch/logout fences hold, no new command replay.`,
);
