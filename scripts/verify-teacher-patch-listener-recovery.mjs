// Actual helper with controlled server reads; no network or real user data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const code = transformSync(
  readFileSync("src/lib/teacherPatchNotes.ts", "utf8"),
  { loader: "ts", format: "cjs" },
).code;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const denied = () =>
  Object.assign(Error("Denied"), { code: "permission-denied" });
const snapshot = (id) => ({
  docs: [
    {
      id,
      data: () => ({
        ownerUid: "teacher-a",
        body: id,
        status: "open",
        noteRevision: 1,
        updatedAt: { seconds: 10 },
      }),
    },
  ],
});
const fixture = () => {
  const module = { exports: {} },
    reads = [],
    listeners = [],
    timers = new Map(),
    changes = [],
    errors = [],
    auth = { currentUser: { uid: "teacher-a" } };
  let timerId = 0;
  runInNewContext(code, {
    module,
    exports: module.exports,
    console: { error() {} },
    setTimeout: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    require: (name) =>
      name === "firebase/firestore"
        ? {
            collection: (_db, ...parts) => ({ path: parts.join("/") }),
            query: (...parts) => ({ parts }),
            orderBy: (...args) => ({ orderBy: args }),
            limit: (value) => ({ limit: value }),
            startAfter: (after) => ({ after }),
            getDocsFromServer: (query) =>
              new Promise((resolve, reject) =>
                reads.push({ query, resolve, reject }),
              ),
            onSnapshot: (query, next, error) => {
              const item = { query, next, error, stopped: false };
              listeners.push(item);
              return () => {
                item.stopped = true;
              };
            },
          }
        : name === "./firebase"
          ? { db: {}, auth }
          : {},
  });
  return {
    auth,
    reads,
    listeners,
    timers,
    changes,
    errors,
    subscribe: (after, uid = "teacher-a") =>
      module.exports.subscribeTeacherPatchNotes(
        uid,
        (notes, page) => changes.push({ notes, page }),
        (error) => errors.push(error),
        after,
      ),
    tick: async () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((item) => item.fn());
      await flush();
    },
  };
};
let checks = 0;
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log("PASS " + name);
};
await check(
  "server read precedes listener and retains exact query/cursor",
  async () => {
    const f = fixture(),
      cursor = {
        ownerUid: "teacher-a",
        snapshot: {
          id: "boundary",
          ref: { parent: { path: "teacherPatchNotes/teacher-a/notes" } },
        },
      };
    const stop = f.subscribe(cursor);
    assert.equal(f.listeners.length, 0);
    f.reads[0].resolve({});
    await flush();
    const listener = f.listeners[0];
    assert.equal(listener.query, f.reads[0].query);
    assert.equal(listener.query.parts.at(-1).limit, 100);
    assert.equal(listener.query.parts[2].after, cursor.snapshot);
    listener.next(snapshot("ready"));
    assert.equal(f.changes[0].notes[0].id, "ready");
    stop();
    assert.equal(listener.stopped, true);
  },
);
await check(
  "temporary denials recover without a user-facing error",
  async () => {
    const f = fixture();
    f.subscribe();
    const query = f.reads[0].query;
    for (let index = 0; index < 2; index++) {
      f.reads[index].reject(denied());
      await flush();
      assert.equal(f.listeners.length, 0);
      await f.tick();
      assert.equal(f.reads[index + 1].query, query);
    }
    f.reads[2].resolve({});
    await flush();
    f.listeners[0].next(snapshot("recovered"));
    assert.equal(f.errors.length, 0);
    assert.equal(f.changes[0].notes[0].id, "recovered");
  },
);
await check(
  "permanent denial ends after four reads and bounded delays",
  async () => {
    const f = fixture();
    f.subscribe();
    const delays = [];
    for (let index = 0; index < 4; index++) {
      f.reads[index].reject(denied());
      await flush();
      delays.push(...[...f.timers.values()].map((item) => item.delay));
      await f.tick();
    }
    assert.deepEqual(delays, [250, 1000, 2000]);
    assert.equal(f.errors.length, 1);
    assert.equal(f.reads.length, 4);
    assert.equal(f.listeners.length, 0);
  },
);
await check("other read failures are reported immediately", async () => {
  const f = fixture();
  f.subscribe();
  const error = Object.assign(Error("Index"), { code: "failed-precondition" });
  f.reads[0].reject(error);
  await flush();
  assert.equal(f.errors[0], error);
  assert.equal(f.timers.size, 0);
});
await check(
  "offline availability keeps the cached listener and reconnect path",
  async () => {
    const f = fixture();
    f.subscribe();
    f.reads[0].reject(Object.assign(Error("Offline"), { code: "unavailable" }));
    await flush();
    assert.equal(f.listeners.length, 1);
    assert.equal(f.errors.length, 0);
    assert.equal(f.timers.size, 0);
    f.listeners[0].next(snapshot("cached"));
    f.listeners[0].next(snapshot("online"));
    assert.equal(f.changes.at(-1).notes[0].id, "online");
  },
);
await check("unmount during read cannot attach a listener", async () => {
  const f = fixture(),
    stop = f.subscribe();
  stop();
  f.reads[0].resolve({});
  await flush();
  assert.equal(f.listeners.length, 0);
  assert.equal(f.changes.length, 0);
});
await check("unmount cancels pending retry", async () => {
  const f = fixture(),
    stop = f.subscribe();
  f.reads[0].reject(denied());
  await flush();
  stop();
  await f.tick();
  assert.equal(f.reads.length, 1);
});
await check("account change suppresses a completed old read", async () => {
  const f = fixture();
  f.subscribe();
  f.auth.currentUser = { uid: "teacher-b" };
  f.reads[0].resolve({});
  await flush();
  assert.equal(f.listeners.length, 0);
});
await check("sign-out prevents the next retry request", async () => {
  const f = fixture();
  f.subscribe();
  f.reads[0].reject(denied());
  await flush();
  f.auth.currentUser = null;
  await f.tick();
  assert.equal(f.reads.length, 1);
});
await check("late callbacks cannot replace another page", async () => {
  const f = fixture(),
    stop = f.subscribe();
  f.reads[0].resolve({});
  await flush();
  const old = f.listeners[0];
  stop();
  f.subscribe();
  f.reads[1].resolve({});
  await flush();
  f.listeners[1].next(snapshot("new"));
  old.next(snapshot("old"));
  old.error(denied());
  assert.equal(f.changes.length, 1);
  assert.equal(f.changes[0].notes[0].id, "new");
  assert.equal(f.errors.length, 0);
});
await check("later listener errors are not retried forever", async () => {
  const f = fixture();
  f.subscribe();
  f.reads[0].resolve({});
  await flush();
  f.listeners[0].error(denied());
  assert.equal(f.errors.length, 1);
  assert.equal(f.timers.size, 0);
});
await check("wrong owner and cursor never query", async () => {
  const f = fixture();
  f.subscribe(undefined, "teacher-b");
  f.subscribe({ ownerUid: "teacher-b", snapshot: {} });
  assert.equal(f.reads.length, 0);
  assert.equal(f.errors.length, 2);
});
console.log(JSON.stringify({ passed: true, checks, networkRequests: 0 }));
