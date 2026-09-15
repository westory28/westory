import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const compiled = await build({
  stdin: {
    contents:
      "export * from './src/lib/thinkCloudRefresh';export * from './src/lib/sessionQueryCache';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  createThinkCloudReadGate,
  startThinkCloudRefresh,
  createSessionQueryCache,
  THINK_CLOUD_REFRESH_MS,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].contents).toString("base64")
);
const checks = [];
const drain = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
const environment = () => {
  let now = 0,
    visible = true,
    online = true,
    sequence = 0;
  const timers = new Map(),
    listeners = new Set();
  return {
    now: () => now,
    host: {
      visible: () => visible,
      online: () => online,
      schedule(callback, delay) {
        const id = ++sequence;
        timers.set(id, { callback, at: now + delay });
        return () => timers.delete(id);
      },
      subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
    event(next = {}) {
      visible = next.visible ?? visible;
      online = next.online ?? online;
      listeners.forEach((callback) => callback());
    },
    async advance(duration) {
      const target = now + duration;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await drain();
      }
      now = target;
      await drain();
    },
    get timerCount() {
      return timers.size;
    },
    get listenerCount() {
      return listeners.size;
    },
  };
};
const verify = async (name, test) => {
  await test();
  checks.push(name);
};
const loop = (env, overrides = {}) =>
  startThinkCloudRefresh({
    gate: createThinkCloudReadGate(),
    host: env.host,
    read: async () => ({}),
    isCurrent: () => true,
    onData: () => {},
    onError: () => true,
    ...overrides,
  });

await verify(
  "16-second loop uses actual cache expiry without global invalidation",
  async () => {
    assert.equal(THINK_CLOUD_REFRESH_MS, 16_000);
    const env = environment(),
      cache = createSessionQueryCache(env.now);
    const payload = {
      semesterId: "2026-2",
      domain: "LEARNING",
      sessionId: "topic-a",
      _session: { revision: "session-a" },
    };
    let calls = 0,
      remote = 1;
    const values = [];
    const read = () =>
      cache.run(
        "getW8DomainState",
        payload,
        "student-a",
        () => "student-a",
        async () => {
          calls++;
          return { count: remote };
        },
      );
    const stop = loop(env, {
      read,
      onData: (value) => values.push(value.count),
    });
    await drain();
    assert.equal(calls, 1);
    remote = 2;
    await env.advance(15_000);
    assert.equal(calls, 1);
    await env.advance(1_000);
    assert.equal(calls, 2);
    assert.deepEqual(values, [1, 2]);
    stop();
    assert.equal(env.timerCount, 0);
    assert.equal(env.listenerCount, 0);
  },
);

await verify(
  "slow reads and repeated foreground events cannot overlap",
  async () => {
    const env = environment(),
      pending = deferred();
    let calls = 0;
    const stop = loop(env, {
      read: () => {
        calls++;
        return pending.promise;
      },
    });
    await drain();
    for (let i = 0; i < 10; i++) env.event();
    await env.advance(120_000);
    assert.equal(calls, 1);
    assert.equal(env.timerCount, 0);
    pending.resolve({});
    await drain();
    assert.equal(env.timerCount, 1);
    stop();
  },
);

await verify(
  "hidden and offline views pause reads and resume on return",
  async () => {
    const env = environment();
    let calls = 0;
    env.event({ visible: false });
    const stop = loop(env, {
      read: async () => {
        calls++;
        return {};
      },
    });
    await env.advance(60_000);
    assert.equal(calls, 0);
    env.event({ visible: true });
    await drain();
    assert.equal(calls, 1);
    env.event({ online: false });
    await env.advance(60_000);
    assert.equal(calls, 1);
    env.event({ online: true });
    await drain();
    assert.equal(calls, 2);
    env.event({ visible: false });
    await env.advance(60_000);
    assert.equal(calls, 2);
    stop();
    assert.equal(env.listenerCount, 0);
  },
);

await verify(
  "completion while hidden does not schedule another request",
  async () => {
    const env = environment(),
      pending = deferred();
    let calls = 0;
    const stop = loop(env, {
      read: () => {
        calls++;
        return pending.promise;
      },
    });
    await drain();
    env.event({ visible: false });
    pending.resolve({});
    await drain();
    await env.advance(60_000);
    assert.equal(calls, 1);
    assert.equal(env.timerCount, 0);
    stop();
  },
);

await verify(
  "temporary failures back off 16, 32, 60 seconds and reset after success",
  async () => {
    const env = environment();
    const times = [];
    let fail = true;
    const stop = loop(env, {
      read: async () => {
        times.push(env.now());
        if (fail) throw Error("offline");
        return {};
      },
    });
    await drain();
    await env.advance(16_000);
    await env.advance(32_000);
    fail = false;
    await env.advance(60_000);
    await env.advance(16_000);
    assert.deepEqual(times, [0, 16_000, 48_000, 108_000, 124_000]);
    stop();
  },
);

await verify(
  "permission/session failures stop periodic and visibility retries",
  async () => {
    const env = environment();
    let calls = 0;
    const stop = loop(env, {
      read: async () => {
        calls++;
        throw Error("session expired");
      },
      onError: () => false,
    });
    await drain();
    await env.advance(180_000);
    env.event();
    await drain();
    assert.equal(calls, 1);
    stop();
  },
);

await verify(
  "selection changes share a serial gate and ignore the previous response",
  async () => {
    const env = environment(),
      gate = createThinkCloudReadGate(),
      pending = deferred();
    const calls = [],
      applied = [];
    let selected = "old";
    const stopOld = loop(env, {
      gate,
      isCurrent: () => selected === "old",
      read: () => {
        calls.push("old");
        return pending.promise;
      },
      onData: () => applied.push("old"),
    });
    await drain();
    selected = "new";
    stopOld();
    const stopNew = loop(env, {
      gate,
      isCurrent: () => selected === "new",
      read: async () => {
        calls.push("new");
        return {};
      },
      onData: () => applied.push("new"),
    });
    await drain();
    assert.deepEqual(calls, ["old"]);
    pending.resolve({});
    await drain();
    assert.deepEqual(calls, ["old", "new"]);
    assert.deepEqual(applied, ["new"]);
    stopNew();
  },
);

await verify("superseded queued scopes never reach the transport", async () => {
  const env = environment(),
    gate = createThinkCloudReadGate(),
    pending = deferred();
  let key = "a";
  const calls = [],
    applied = [],
    stops = [];
  for (const next of ["a", "b", "c"]) {
    key = next;
    stops.push(
      loop(env, {
        gate,
        isCurrent: () => key === next,
        read: () => {
          calls.push(next);
          return next === "a" ? pending.promise : Promise.resolve({});
        },
        onData: () => applied.push(next),
      }),
    );
    await drain();
  }
  assert.deepEqual(calls, ["a"]);
  pending.resolve({});
  await drain();
  assert.deepEqual(calls, ["a", "c"]);
  assert.deepEqual(applied, ["c"]);
  stops.forEach((stop) => stop());
});

await verify(
  "logout/semester changes fence late results without another query",
  async () => {
    for (const reason of ["logout", "semester-change", "write-start"]) {
      const env = environment(),
        pending = deferred();
      let current = true,
        calls = 0,
        applied = 0;
      const stop = loop(env, {
        isCurrent: () => current,
        read: () => {
          calls++;
          return pending.promise;
        },
        onData: () => applied++,
      });
      await drain();
      current = false;
      pending.resolve({});
      await drain();
      await env.advance(60_000);
      assert.equal(applied, 0, reason);
      assert.equal(calls, 1, reason);
      stop();
    }
  },
);

await verify(
  "unmount removes listeners and suppresses late success",
  async () => {
    const env = environment(),
      pending = deferred();
    let applied = 0;
    const stop = loop(env, {
      read: () => pending.promise,
      onData: () => applied++,
    });
    await drain();
    stop();
    pending.resolve({});
    await drain();
    env.event();
    assert.equal(applied, 0);
    assert.equal(env.timerCount, 0);
    assert.equal(env.listenerCount, 0);
  },
);

// Structural companion checks only; real React input/selection preservation is
// covered by the browser fixture. Do not report these as DOM interaction tests.
await verify(
  "page wiring preserves existing commands and separates refresh from input",
  async () => {
    const student = readFileSync(
      "src/pages/student/lesson/ThinkCloud.tsx",
      "utf8",
    );
    const teacher = readFileSync(
      "src/pages/teacher/ManageThinkCloud.tsx",
      "utf8",
    );
    for (const source of [student, teacher]) {
      assert.match(source, /startThinkCloudRefresh\(/u);
      assert.match(source, /authenticationStatus !== "AUTHENTICATED"/u);
      assert.match(source, /stoppedRetry\.current === retryKey/u);
      assert.match(source, /if \(terminal\) stoppedRetry\.current = retryKey/u);
      assert.match(source, /key=\{`\$\{currentUser\?\.uid/u);
      assert.doesNotMatch(source, /sessionQueryCache\.clear|setInterval\(/u);
    }
    assert.match(student, /drafts\[selectedSessionId\]/u);
    assert.match(student, /submitLegacyThinkCloudResponse\(/u);
    assert.match(teacher, /if \(!isCreateMode\)/u);
    assert.match(
      teacher,
      /loadedSelection\.current !== selectionKey\) return/u,
    );
    for (const name of [
      "createLegacyThinkCloudSession",
      "transitionLegacyThinkCloudSession",
      "deleteLegacyThinkCloudSession",
    ])
      assert.ok(teacher.includes(name));
  },
);

console.log(
  JSON.stringify(
    {
      suite: "thinkcloud-refresh",
      status: "PASS",
      checks,
      runtimeCases: 10,
      structuralCases: 1,
      intervalMs: THINK_CLOUD_REFRESH_MS,
      productionAccess: 0,
      limitations:
        "Virtual clock and actual helper/cache. React DOM and live Firebase are separate checks.",
    },
    null,
    2,
  ),
);
