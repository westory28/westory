import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const owner = "teacher-one";
const otherOwner = "teacher-two";
const input = {
  body: "저장 확인 메모",
  type: "bug",
  priority: "normal",
  sourcePath: "/teacher/dashboard",
};
const note = (revision = 1, extra = {}) => ({
  id: "memo_1",
  ownerUid: owner,
  noteRevision: revision,
  title: input.body,
  ...input,
  status: "open",
  updatedAt: { seconds: revision },
  createdAt: { seconds: 1 },
  ...extra,
});
const receipt = (revision, extra = {}) => ({
  noteId: "memo_1",
  noteRevision: revision,
  status: "open",
  deleted: false,
  ...extra,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const docSnapshot = (value) => ({
  id: value?.id ?? "memo_1",
  exists: () => value != null,
  data: () => value,
});

const harness = () => {
  const streams = [];
  const commands = [];
  const reads = [];
  const latest = new Map();
  const timers = new Map();
  let timerId = 0;
  let nextRead;
  const modules = {
    "firebase/firestore": {
      collection: (_db, _collection, uid) => ({ uid }),
      doc: (collection, id) => ({ ...collection, id }),
      query: (collection) => collection,
      orderBy: () => null,
      limit: () => null,
      onSnapshot: (query, next, error) => {
        const stream = { uid: query.uid, next, error, closed: false };
        streams.push(stream);
        return () => {
          stream.closed = true;
        };
      },
      getDocFromServer: async (ref) => {
        reads.push(ref);
        if (nextRead) {
          const pending = nextRead;
          nextRead = undefined;
          return pending;
        }
        return docSnapshot(latest.get(JSON.stringify([ref.uid, ref.id])));
      },
      // Client writes must continue through the production command gateway.
      ...Object.fromEntries(
        ["addDoc", "setDoc", "updateDoc", "deleteDoc"].map((name) => [
          name,
          () => assert.fail(`Unexpected direct write: ${name}`),
        ]),
      ),
    },
    "./firebase": { db: {} },
    "./teacherPatchNoteCommands": {
      executeTeacherPatchNoteCommand: (type, payload, uid) => {
        const pending = deferred();
        commands.push({ type, payload: plain(payload), uid, ...pending });
        return pending.promise;
      },
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/teacherPatchNotes.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, `Unexpected import ${name}`);
        return modules[name];
      },
      console: { error() {} },
      setTimeout: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    api: exports,
    commands,
    streams,
    reads,
    latest,
    deferNextRead() {
      const pending = deferred();
      nextRead = pending.promise;
      return { resolve: (value) => pending.resolve(docSnapshot(value)) };
    },
    async flushChecks() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        await callback();
      }
    },
    subscribe(uid = owner) {
      const events = [];
      const errors = [];
      const stop = exports.subscribeTeacherPatchNotes(
        uid,
        (value) => events.push(plain(value)),
        (error) => errors.push(error),
      );
      return {
        events,
        errors,
        stop,
        get notes() {
          return events.at(-1) ?? [];
        },
      };
    },
    snapshot(values, { uid = owner, fromCache = false } = {}) {
      const stream = streams.findLast(
        (item) => item.uid === uid && !item.closed,
      );
      assert.ok(stream, `Missing subscription for ${uid}`);
      stream.next({ docs: values.map(docSnapshot), metadata: { fromCache } });
    },
  };
};

const checks = [];
const check = async (name, test) => {
  await test();
  checks.push(name);
};

await check(
  "Create, status and delete use acknowledged revisions while snapshots lag",
  async () => {
    const h = harness();
    const view = h.subscribe();
    h.snapshot([]);
    const create = h.api.createTeacherPatchNote(owner, input);
    assert.equal(
      view.notes.length,
      0,
      "Unconfirmed creates must not appear saved",
    );
    h.commands.at(-1).resolve(receipt(1));
    await create;
    assert.equal(view.notes[0].noteRevision, 1);
    assert.equal(view.notes[0].body, input.body);
    h.snapshot([]);
    assert.equal(view.notes[0].noteRevision, 1);
    const status = h.api.updateTeacherPatchNoteStatus(
      owner,
      view.notes[0],
      "done",
    );
    assert.equal(h.commands.at(-1).payload.expectedNoteRevision, 1);
    h.commands.at(-1).resolve(receipt(2, { status: "done" }));
    await status;
    h.snapshot([note(1)]);
    assert.equal(view.notes[0].noteRevision, 2);
    assert.equal(view.notes[0].status, "done");
    const remove = h.api.deleteTeacherPatchNote(owner, view.notes[0]);
    assert.equal(h.commands.at(-1).payload.expectedNoteRevision, 2);
    h.commands.at(-1).resolve(receipt(3, { status: "done", deleted: true }));
    await remove;
    assert.equal(view.notes.length, 0);
    h.snapshot([note(2, { status: "done" })], { fromCache: true });
    h.snapshot([note(1)]);
    assert.equal(
      view.notes.length,
      0,
      "Delayed snapshots cannot resurrect a deleted note",
    );
    assert.equal(
      h.reads.length,
      0,
      "Successful commands require no additional reads",
    );
  },
);

await check(
  "A fresh or newer snapshot arriving before acknowledgement wins",
  async () => {
    for (const snapshotRevision of [2, 3]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      const update = h.api.updateTeacherPatchNote(owner, "memo_1", 1, {
        ...input,
        body: "요청한 내용",
      });
      const server = note(snapshotRevision, {
        body: "서버에서 받은 내용",
        updatedAt: { seconds: 42 },
        status: "done",
      });
      h.snapshot([server]);
      h.commands.at(-1).resolve(receipt(2));
      await update;
      assert.equal(view.notes[0].body, server.body);
      assert.equal(view.notes[0].noteRevision, snapshotRevision);
      assert.equal(view.notes[0].updatedAt.seconds, 42);
      h.snapshot([note(1)]);
      assert.equal(view.notes[0].noteRevision, snapshotRevision);
    }
  },
);

await check(
  "Confirmed updates converge to server timestamps and accept later external deletion",
  async () => {
    const h = harness();
    const view = h.subscribe();
    h.snapshot([note(1)]);
    const update = h.api.updateTeacherPatchNote(owner, "memo_1", 1, {
      ...input,
      body: "수정 완료",
    });
    h.commands.at(-1).resolve(receipt(2));
    await update;
    assert.equal(view.notes[0].body, "수정 완료");
    h.snapshot([note(2, { body: "수정 완료", updatedAt: { seconds: 999 } })]);
    assert.equal(view.notes[0].updatedAt.seconds, 999);
    h.snapshot([], { fromCache: true });
    assert.equal(view.notes.length, 1);
    h.snapshot([]);
    assert.equal(view.notes.length, 0);
    await h.flushChecks();
    assert.equal(
      h.reads.length,
      0,
      "A healthy stream must cancel delayed verification reads",
    );
  },
);

await check(
  "A revision observed and then removed before a late acknowledgement cannot reappear",
  async () => {
    const h = harness();
    const view = h.subscribe();
    h.snapshot([note(1)]);
    const update = h.api.updateTeacherPatchNoteStatus(
      owner,
      view.notes[0],
      "done",
    );
    h.snapshot([note(2, { status: "done" })]);
    h.snapshot([]);
    h.commands[0].resolve(receipt(2, { status: "done" }));
    await update;
    assert.equal(view.notes.length, 0);
    await h.flushChecks();
    assert.equal(h.reads.length, 0);
  },
);

await check(
  "A changed then externally deleted note cannot remain in the list when the stream skips its revision",
  async () => {
    for (const lateAcknowledgement of [false, true]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      const update = h.api.updateTeacherPatchNoteStatus(
        owner,
        view.notes[0],
        "done",
      );
      if (lateAcknowledgement) h.snapshot([]);
      h.commands[0].resolve(receipt(2, { status: "done" }));
      await update;
      if (!lateAcknowledgement) h.snapshot([]);
      assert.equal(
        view.notes[0].noteRevision,
        2,
        "Retain the confirmed write until an authoritative read",
      );
      await h.flushChecks();
      assert.equal(h.reads.length, 1);
      assert.equal(view.notes.length, 0);
      h.snapshot([note(1)], { fromCache: true });
      assert.equal(view.notes.length, 0);
    }
  },
);

await check(
  "Delayed verification cannot undo a newer command or snapshot",
  async () => {
    const h = harness();
    const view = h.subscribe();
    h.snapshot([note(1)]);
    const update = h.api.updateTeacherPatchNoteStatus(
      owner,
      view.notes[0],
      "done",
    );
    h.commands[0].resolve(receipt(2, { status: "done" }));
    await update;
    h.latest.set(
      JSON.stringify([owner, "memo_1"]),
      note(3, { body: "최신 수정", status: "done" }),
    );
    await h.flushChecks();
    assert.equal(view.notes[0].noteRevision, 3);
    assert.equal(view.notes[0].body, "최신 수정");
    h.snapshot([note(2, { status: "done" })]);
    assert.equal(view.notes[0].noteRevision, 3);
  },
);

await check(
  "An in-flight verification read cannot overwrite a newer snapshot or acknowledgement",
  async () => {
    for (const newerSource of ["snapshot", "acknowledgement"]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      const update = h.api.updateTeacherPatchNoteStatus(
        owner,
        view.notes[0],
        "done",
      );
      h.commands[0].resolve(receipt(2, { status: "done" }));
      await update;
      const pendingRead = h.deferNextRead();
      const verification = h.flushChecks();
      if (newerSource === "snapshot")
        h.snapshot([note(3, { body: "최신 내용" })]);
      else {
        const next = h.api.updateTeacherPatchNote(owner, "memo_1", 2, {
          ...input,
          body: "최신 내용",
        });
        h.commands[1].resolve(receipt(3));
        await next;
      }
      pendingRead.resolve(null);
      await verification;
      assert.equal(view.notes[0].noteRevision, 3);
      assert.equal(view.notes[0].body, "최신 내용");
    }
  },
);

await check(
  "A coalesced successful create keeps waiting for its first snapshot",
  async () => {
    const h = harness();
    const view = h.subscribe();
    h.snapshot([]);
    const first = h.api.createTeacherPatchNote(owner, input);
    const duplicate = h.api.createTeacherPatchNote(owner, input);
    h.commands[0].resolve(receipt(1));
    await first;
    h.commands[1].resolve(receipt(1));
    await duplicate;
    h.snapshot([]);
    assert.equal(view.notes.length, 1);
    assert.equal(view.notes[0].noteRevision, 1);
  },
);

await check(
  "Failed create, update, status and delete never commit an optimistic result",
  async () => {
    for (const type of ["create", "update", "status", "delete"]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      const before = plain(view.notes);
      const operation =
        type === "create"
          ? h.api.createTeacherPatchNote(owner, input)
          : type === "update"
            ? h.api.updateTeacherPatchNote(owner, "memo_1", 1, {
                ...input,
                body: "실패한 수정",
              })
            : type === "status"
              ? h.api.updateTeacherPatchNoteStatus(owner, view.notes[0], "done")
              : h.api.deleteTeacherPatchNote(owner, view.notes[0]);
      const error = Object.assign(new Error("Offline"), {
        code: "functions/unavailable",
      });
      h.commands.at(-1).reject(error);
      await assert.rejects(operation, (actual) => actual === error);
      assert.deepEqual(view.notes, before);
      assert.equal(h.reads.length, 0);
    }
  },
);

await check(
  "Conflicts refresh only the owner's note, preserve the error and never retry the write",
  async () => {
    for (const server of [note(3, { body: "다른 탭에서 수정" }), null]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      h.latest.set(JSON.stringify([owner, "memo_1"]), server);
      const update = h.api.updateTeacherPatchNote(owner, "memo_1", 1, {
        ...input,
        body: "보존할 초안",
      });
      const error = Object.assign(new Error("Conflict"), {
        code: server ? "functions/aborted" : "functions/not-found",
      });
      h.commands.at(-1).reject(error);
      await assert.rejects(update, (actual) => actual === error);
      assert.equal(h.commands.length, 1);
      assert.deepEqual(plain(h.reads), [{ uid: owner, id: "memo_1" }]);
      if (server) {
        assert.equal(view.notes[0].noteRevision, 3);
        assert.equal(view.notes[0].body, server.body);
      } else assert.equal(view.notes.length, 0);
      h.snapshot([note(1)]);
      assert.equal(view.notes.length, server ? 1 : 0);
      if (server) assert.equal(view.notes[0].noteRevision, 3);
    }
  },
);

await check(
  "Same-note writes are blocked in flight while different owners remain isolated",
  async () => {
    const h = harness();
    const first = h.subscribe();
    const second = h.subscribe(otherOwner);
    h.snapshot([note(1)]);
    h.snapshot([note(5, { ownerUid: otherOwner })], { uid: otherOwner });
    const update = h.api.updateTeacherPatchNoteStatus(
      owner,
      first.notes[0],
      "done",
    );
    await assert.rejects(h.api.deleteTeacherPatchNote(owner, first.notes[0]));
    assert.equal(h.commands.length, 1);
    const otherUpdate = h.api.updateTeacherPatchNoteStatus(
      otherOwner,
      second.notes[0],
      "done",
    );
    assert.equal(h.commands.length, 2);
    h.commands[0].resolve(receipt(2, { status: "done" }));
    await update;
    assert.equal(second.notes[0].noteRevision, 5);
    h.commands[1].resolve(receipt(6, { status: "done" }));
    await otherUpdate;
    assert.equal(first.notes[0].noteRevision, 2);
    assert.equal(second.notes[0].noteRevision, 6);
    const remove = h.api.deleteTeacherPatchNote(owner, first.notes[0]);
    h.commands.at(-1).resolve(receipt(3, { deleted: true }));
    await remove;
    assert.equal(first.notes.length, 0);
    assert.equal(second.notes.length, 1);
  },
);

await check(
  "Subscribers share one stream and release owner state after the last unsubscribe",
  async () => {
    const h = harness();
    const first = h.subscribe();
    const second = h.subscribe();
    assert.equal(h.streams.length, 1);
    h.snapshot([note(1)]);
    assert.deepEqual(first.notes, second.notes);
    first.stop();
    assert.equal(h.streams[0].closed, false);
    const update = h.api.updateTeacherPatchNoteStatus(
      owner,
      second.notes[0],
      "done",
    );
    second.stop();
    assert.equal(h.streams[0].closed, true);
    const replacement = h.subscribe();
    h.commands[0].resolve(receipt(2, { status: "done" }));
    await update;
    assert.equal(
      replacement.notes.length,
      0,
      "An old lifecycle's acknowledgement must not leak",
    );
    h.streams[0].next({ docs: [docSnapshot(note(1))] });
    assert.equal(replacement.notes.length, 0);
    h.snapshot([note(2, { status: "done" })]);
    assert.equal(replacement.notes[0].noteRevision, 2);
  },
);

await check(
  "Legacy revision zero remains writable and stream errors retain confirmed data",
  async () => {
    const h = harness();
    const view = h.subscribe();
    const legacy = note();
    delete legacy.noteRevision;
    h.snapshot([legacy]);
    assert.equal(view.notes[0].noteRevision, 0);
    const update = h.api.updateTeacherPatchNoteStatus(
      owner,
      view.notes[0],
      "done",
    );
    assert.equal(h.commands[0].payload.expectedNoteRevision, 0);
    h.commands[0].resolve(receipt(1, { status: "done" }));
    await update;
    h.streams[0].error(new Error("Temporarily disconnected"));
    assert.equal(view.errors.length, 1);
    assert.equal(view.notes[0].noteRevision, 1);
    assert.equal(view.notes[0].status, "done");
    const recovered = h.subscribe();
    assert.equal(
      h.streams.length,
      2,
      "Terminal errors must allow a new subscription",
    );
    h.streams[1].next({
      docs: [docSnapshot(note(2))],
      metadata: { fromCache: false },
    });
    assert.equal(recovered.notes[0].noteRevision, 2);
  },
);

await check(
  "Authorization failures clear private notes and can recover with a new subscription",
  async () => {
    for (const code of ["permission-denied", "unauthenticated"]) {
      const h = harness();
      const view = h.subscribe();
      h.snapshot([note(1)]);
      h.streams[0].error(Object.assign(new Error("Denied"), { code }));
      assert.equal(view.notes.length, 0);
      assert.equal(view.errors.length, 1);
      const recovered = h.subscribe();
      h.streams[1].next({
        docs: [docSnapshot(note(2))],
        metadata: { fromCache: false },
      });
      assert.equal(recovered.notes[0].noteRevision, 2);
      view.stop();
      assert.equal(
        h.streams[1].closed,
        false,
        "Old cleanup cannot close the replacement stream",
      );
    }
  },
);

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
