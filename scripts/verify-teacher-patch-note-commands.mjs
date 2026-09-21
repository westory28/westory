import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const load = (path, modules, globals = {}) => {
  const source = readFileSync(resolve(path), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(
    output,
    {
      exports,
      require(name) {
        assert.ok(name in modules, `Unexpected import ${name} in ${path}`);
        return modules[name];
      },
      console,
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename: path },
  );
  return exports;
};

const owner = "teacher-owner";
const generation = "w1r2-2026-08-09";
const validSession = {
  status: "active",
  authTime: 123,
  authorityGeneration: generation,
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const result = {
  noteId: "memo_1",
  noteRevision: 1,
  status: "open",
  deleted: false,
};
const success = { data: { status: "SUCCEEDED", result } };
const unavailable = () =>
  Object.assign(new Error("Response lost"), { code: "functions/unavailable" });
const commandPayload = { content: { title: "검증", body: "검증 메모" } };

const gatewayHarness = (options = {}) => {
  let tokenCalls = 0;
  let sequence = 0;
  const calls = [];
  const user = {
    uid: owner,
    async getIdTokenResult() {
      tokenCalls += 1;
      return { claims: { auth_time: options.tokenTime?.(tokenCalls) ?? 123 } };
    },
  };
  const auth = { currentUser: user };
  let authListener;
  const api = load(
    "src/lib/teacherPatchNoteCommands.ts",
    {
      "firebase/auth": {
        onAuthStateChanged: (_auth, listener) => {
          authListener = listener;
          return () => {};
        },
      },
      "./firebase": {
        auth,
        async getHttpsCallable(name) {
          return async (data) => {
            calls.push({ name, data: plain(data) });
            if (name === "openApplicationSession") {
              options.onOpen?.(auth);
              return {
                data: {
                  ...validSession,
                  ...(typeof options.session === "function"
                    ? options.session()
                    : options.session),
                },
              };
            }
            if (name === "executeCommand")
              return options.execute?.(data) ?? success;
            if (name === "getCommandStatus")
              return options.status?.(data) ?? success;
            throw new Error(`Unexpected callable ${name}`);
          };
        },
      },
    },
    {
      Date: class extends Date {
        static now() {
          return options.now?.() ?? Date.now();
        }
      },
      crypto: {
        randomUUID: () =>
          `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      },
    },
  );
  return {
    auth,
    calls,
    prepare: () => api.prepareTeacherPatchNoteSession(owner),
    authChanged: () => authListener(),
    run: (payload = commandPayload, uid = owner) =>
      api.executeTeacherPatchNoteCommand(
        "createTeacherPatchNote",
        payload,
        uid,
      ),
  };
};

const checks = [];
const check = async (name, test) => {
  await test();
  checks.push(name);
};

await check(
  "Gateway sends general application-session proof and returns result",
  async () => {
    const h = gatewayHarness();
    assert.deepEqual(plain(await h.run()), result);
    const open = h.calls.find((call) => call.name === "openApplicationSession");
    assert.deepEqual(open.data, {
      authorityGeneration: generation,
      protocolVersion: 2,
    });
    const execute = h.calls.find((call) => call.name === "executeCommand");
    assert.deepEqual(execute.data._session, {
      authorityGeneration: generation,
      protocolVersion: 2,
      revision: validSession.revision,
    });
    assert.deepEqual(execute.data.payload, commandPayload);
  },
);

await check(
  "Mismatched owner and account changes cannot execute writes",
  async () => {
    const wrongOwner = gatewayHarness();
    await assert.rejects(wrongOwner.run(commandPayload, "other-owner"));
    assert.equal(wrongOwner.calls.length, 0);
    const switched = gatewayHarness({
      onOpen: (auth) => {
        auth.currentUser = { uid: "other-owner" };
      },
    });
    await assert.rejects(switched.run());
    assert.equal(
      switched.calls.filter((call) => call.name === "executeCommand").length,
      0,
    );
  },
);

await check("Repeated saves reuse the session handshake", async () => {
  const h = gatewayHarness();
  await h.prepare();
  await h.run();
  await h.run({ content: { ...commandPayload.content, body: "다음 메모" } });
  assert.equal(
    h.calls.filter((call) => call.name === "openApplicationSession").length,
    1,
  );
  assert.equal(
    h.calls.filter((call) => call.name === "executeCommand").length,
    2,
  );
});

await check(
  "Different concurrent saves share one session handshake",
  async () => {
    const h = gatewayHarness();
    await Promise.all([
      h.prepare(),
      h.run(),
      h.run({ content: { ...commandPayload.content, body: "별도 메모" } }),
    ]);
    assert.equal(
      h.calls.filter((call) => call.name === "openApplicationSession").length,
      1,
    );
    assert.equal(
      h.calls.filter((call) => call.name === "executeCommand").length,
      2,
    );
  },
);

await check("Session proof expires after five minutes", async () => {
  let now = 1000;
  const h = gatewayHarness({ now: () => now });
  await h.run();
  now += 5 * 60 * 1000 - 1;
  await h.run();
  assert.equal(
    h.calls.filter((call) => call.name === "openApplicationSession").length,
    1,
  );
  now += 1;
  await h.run();
  assert.equal(
    h.calls.filter((call) => call.name === "openApplicationSession").length,
    2,
  );
});

await check(
  "Same UID reauthentication cannot reuse the old session proof",
  async () => {
    let authTime = 123;
    const h = gatewayHarness({
      tokenTime: () => authTime,
      session: () => ({ authTime }),
    });
    await h.run();
    h.auth.currentUser = { ...h.auth.currentUser };
    await h.run();
    authTime = 124;
    await h.run();
    assert.equal(
      h.calls.filter((call) => call.name === "openApplicationSession").length,
      3,
    );
  },
);

await check("Failed panel warm-up can recover on submit", async () => {
  let attempts = 0;
  const h = gatewayHarness({
    onOpen: () => {
      if (++attempts === 1) throw unavailable();
    },
  });
  await assert.rejects(h.prepare());
  assert.deepEqual(plain(await h.run()), result);
  assert.equal(
    h.calls.filter((call) => call.name === "openApplicationSession").length,
    2,
  );
});

await check(
  "Auth changes and server auth denial invalidate the session cache",
  async () => {
    let denied = false;
    const h = gatewayHarness({
      execute: () => {
        if (denied)
          throw Object.assign(new Error("expired"), {
            code: "functions/unauthenticated",
          });
        return success;
      },
    });
    await h.run();
    h.authChanged();
    await h.run();
    assert.equal(
      h.calls.filter((call) => call.name === "openApplicationSession").length,
      2,
    );
    denied = true;
    await assert.rejects(h.run());
    denied = false;
    await h.run();
    assert.equal(
      h.calls.filter((call) => call.name === "openApplicationSession").length,
      3,
    );
  },
);

await check(
  "Invalid session proof and changed auth_time cannot execute writes",
  async () => {
    for (const session of [
      { status: "expired" },
      { authTime: 124 },
      { authorityGeneration: "obsolete" },
      { protocolVersion: 1 },
      { revision: "invalid" },
    ]) {
      const h = gatewayHarness({ session });
      await assert.rejects(h.run());
      assert.equal(
        h.calls.filter((call) => call.name === "executeCommand").length,
        0,
      );
    }
    const h = gatewayHarness({
      tokenTime: (count) => (count === 1 ? 123 : 124),
    });
    await assert.rejects(h.run());
    assert.equal(
      h.calls.filter((call) => call.name === "executeCommand").length,
      0,
    );
  },
);

await check(
  "Lost acknowledgement recovers the original successful receipt",
  async () => {
    const h = gatewayHarness({
      execute: () => {
        throw unavailable();
      },
    });
    assert.deepEqual(plain(await h.run()), result);
    const execute = h.calls.find((call) => call.name === "executeCommand");
    const status = h.calls.find((call) => call.name === "getCommandStatus");
    assert.equal(status.data.commandId, execute.data.commandId);
    assert.deepEqual(status.data._session, execute.data._session);
    assert.equal(
      h.calls.filter((call) => call.name === "openApplicationSession").length,
      1,
    );
  },
);

await check(
  "Unconfirmed outcome retains command ID on explicit retry",
  async () => {
    let attempts = 0;
    const h = gatewayHarness({
      execute: () => {
        if (++attempts === 1) throw unavailable();
        return success;
      },
      status: () => ({ data: { status: "NOT_FOUND", result: null } }),
    });
    await assert.rejects(h.run());
    await h.run();
    const writes = h.calls.filter((call) => call.name === "executeCommand");
    assert.equal(writes.length, 2);
    assert.equal(writes[0].data.commandId, writes[1].data.commandId);
    await h.run();
    const fresh = h.calls.filter((call) => call.name === "executeCommand")[2];
    assert.notEqual(fresh.data.commandId, writes[0].data.commandId);
  },
);

await check(
  "Concurrent identical saves coalesce into one Gateway call",
  async () => {
    let release;
    const barrier = new Promise((resolveBarrier) => {
      release = resolveBarrier;
    });
    const h = gatewayHarness({
      execute: async () => {
        await barrier;
        return success;
      },
    });
    const a = h.run();
    const b = h.run();
    release();
    assert.deepEqual(plain(await Promise.all([a, b])), [result, result]);
    assert.equal(
      h.calls.filter((call) => call.name === "executeCommand").length,
      1,
    );
  },
);

await check(
  "Reauthentication failures cannot discard an earlier unconfirmed command ID",
  async () => {
    let attempts = 0;
    const h = gatewayHarness({
      execute: () => {
        attempts += 1;
        if (attempts === 1) throw unavailable();
        if (attempts === 2)
          throw Object.assign(new Error("Session expired"), {
            code: "functions/unauthenticated",
          });
        return success;
      },
      status: () => ({ data: { status: "NOT_FOUND", result: null } }),
    });
    await assert.rejects(h.run());
    await assert.rejects(h.run());
    await h.run();
    const ids = h.calls
      .filter((call) => call.name === "executeCommand")
      .map((call) => call.data.commandId);
    assert.equal(
      new Set(ids).size,
      1,
      "An auth denial cannot establish that the original write failed to commit",
    );
  },
);

await check(
  "Memo CRUD uses owner-scoped revision commands without direct Firestore writes",
  async () => {
    const writes = [];
    let listener;
    const firestore = {
      collection: (...args) => args,
      query: (...args) => args,
      orderBy: (...args) => ({ orderBy: args }),
      limit: (value) => ({ limit: value }),
      onSnapshot: (_query, next) => {
        listener = next;
        return () => {};
      },
    };
    for (const name of [
      "addDoc",
      "setDoc",
      "updateDoc",
      "deleteDoc",
      "serverTimestamp",
    ]) {
      firestore[name] = () =>
        assert.fail(`Direct Firestore ${name} must not be used`);
    }
    const api = load("src/lib/teacherPatchNotes.ts", {
      "firebase/firestore": firestore,
      "./firebase": { db: {}, auth: { currentUser: { uid: owner } } },
      "./teacherPatchNoteCommands": {
        executeTeacherPatchNoteCommand: async (...args) => {
          writes.push(plain(args));
          return result;
        },
      },
    });
    const input = {
      body: "새 패치 메모",
      type: "bug",
      priority: "normal",
      sourcePath: "/teacher/quiz?tab=log",
      targetLabel: "반별 비교",
      targetText: "3반 80",
      targetSelector: "section",
      targetRect: { x: 30, y: 433, width: 400, height: 460 },
    };
    await api.createTeacherPatchNote(owner, input);
    await api.updateTeacherPatchNote(owner, "memo_1", 3, {
      ...input,
      status: "done",
    });
    const note = { id: "memo_1", ownerUid: owner, noteRevision: 4 };
    await api.updateTeacherPatchNoteStatus(owner, note, "done");
    await api.deleteTeacherPatchNote(owner, note);
    assert.deepEqual(
      writes.map(([command]) => command),
      [
        "createTeacherPatchNote",
        "updateTeacherPatchNote",
        "updateTeacherPatchNoteStatus",
        "deleteTeacherPatchNote",
      ],
    );
    for (const [, payload, uid] of writes) {
      assert.equal(uid, owner);
      assert.ok(!("ownerUid" in payload));
      assert.ok(!("semesterId" in payload));
    }
    assert.deepEqual(Object.keys(writes[0][1]), ["content"]);
    assert.deepEqual(
      Object.keys(writes[0][1].content).sort(),
      [
        "title",
        "body",
        "type",
        "priority",
        "sourcePath",
        "targetLabel",
        "targetText",
        "targetSelector",
        "targetRect",
      ].sort(),
    );
    assert.equal(writes[0][1].content.sourcePath, input.sourcePath);
    assert.equal(writes[1][1].expectedNoteRevision, 3);
    assert.ok(!("status" in writes[1][1].content));
    assert.deepEqual(writes[2][1], {
      noteId: "memo_1",
      expectedNoteRevision: 4,
      status: "done",
    });
    assert.deepEqual(writes[3][1], {
      noteId: "memo_1",
      expectedNoteRevision: 4,
    });
    let notes;
    api.subscribeTeacherPatchNotes(owner, (value) => {
      notes = value;
    });
    listener({
      docs: [
        { id: "legacy", data: () => ({ ownerUid: owner }) },
        { id: "new", data: () => ({ ownerUid: owner, noteRevision: 7 }) },
        { id: "invalid", data: () => ({ ownerUid: owner, noteRevision: "7" }) },
      ],
    });
    assert.equal(notes.find((item) => item.id === "legacy").noteRevision, 0);
    assert.equal(notes.find((item) => item.id === "new").noteRevision, 7);
    assert.notEqual(
      notes.find((item) => item.id === "invalid").noteRevision,
      0,
    );
  },
);

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
