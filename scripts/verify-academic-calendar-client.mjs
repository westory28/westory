import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

// Compile the real adapter with isolated Firebase and step-up boundaries.
// These checks cannot initialize Firebase or contact production. The common
// step-up implementation has its own verify-sensitive-operation.mjs suite.
const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/academicCalendar.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  plugins: [
    {
      name: "isolated-calendar-firebase",
      setup(builder) {
        builder.onResolve(
          { filter: /^(\.\/firebase|\.\/sensitiveOperation|firebase\/auth)$/ },
          ({ path }) => ({
            path,
            namespace: "calendar-test",
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "calendar-test" },
          ({ path }) => ({
            contents:
              path === "./sensitiveOperation"
                ? "export const ensureSensitiveOperation = globalThis.__calendarFirebase.ensureSensitiveOperation;"
                : path === "firebase/auth"
                  ? "export const GoogleAuthProvider = globalThis.__calendarFirebase.GoogleAuthProvider; export const reauthenticateWithPopup = globalThis.__calendarFirebase.reauthenticateWithPopup;"
                  : "export const auth = globalThis.__calendarFirebase.auth; export const getHttpsCallable = globalThis.__calendarFirebase.getHttpsCallable;",
            loader: "js",
          }),
        );
      },
    },
  ],
});

const generation = "w1r2-2026-08-09";
const authTime = 1770000000;
const session = {
  status: "active",
  authTime,
  authorityGeneration: generation,
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const operation = () => ({
  action: "SAVE_EVENT",
  year: 2026,
  semester: 2,
  eventId: undefined,
  expectedRevision: 0,
  event: {
    title: "연속 일정",
    start: "2026-09-24",
    end: "2026-09-26",
    eventType: "event",
    targetType: "common",
    targetClass: null,
    allDay: true,
    labelColor: "#3b82f6",
    startPeriod: "allDay",
    endPeriod: "allDay",
    period: "allDay",
    description: undefined,
  },
});
const deleteOperation = () => ({
  action: "DELETE_EVENT",
  year: 2026,
  semester: 2,
  eventId: "event-1",
  expectedRevision: 1,
});
const ordinaryOperations = () => [
  operation(),
  { action: "SAVE_CATEGORIES", year: 2026, semester: 2, items: [] },
  { action: "SYNC_HOLIDAYS", year: 2026, semester: 2, holidays: [] },
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (code) => Object.assign(new Error(code), { code });

function harness(options = {}) {
  const calls = {
    resolved: [],
    open: [],
    manage: [],
    sensitive: [],
    reauth: [],
    tokens: 0,
  };
  let tokenAuthTime = "authTime" in options ? options.authTime : authTime;
  const controls = {
    setAuthTime(value) {
      tokenAuthTime = value;
    },
  };
  const auth = {
    currentUser: {
      uid: "calendar-admin",
      email: "admin@example.test",
      async getIdTokenResult() {
        calls.tokens += 1;
        await options.onToken?.(auth, controls, calls.tokens);
        return { claims: { auth_time: String(tokenAuthTime) } };
      },
    },
  };
  const getHttpsCallable = async (name) => {
    calls.resolved.push(name);
    await options.onResolve?.(name, auth, controls);
    if (name === "openApplicationSession")
      return async (payload) => {
        calls.open.push(clone(payload));
        const openedAuthTime = tokenAuthTime;
        await options.onOpen?.(auth, controls);
        const openError =
          typeof options.openError === "function"
            ? options.openError(calls.open.length)
            : options.openError;
        if (openError) throw openError;
        return {
          data: { ...session, authTime: openedAuthTime, ...options.session },
        };
      };
    assert.equal(
      name,
      "manageAcademicCalendar",
      "Only the calendar callable may mutate data",
    );
    return async (payload) => {
      calls.manage.push(clone(payload));
      return options.manage
        ? options.manage(payload, calls.manage.length, auth, controls)
        : { data: { eventId: "saved-event", revision: 1 } };
    };
  };
  class GoogleAuthProvider {
    setCustomParameters(parameters) {
      this.parameters = parameters;
    }
  }
  const reauthenticateWithPopup = async (user, provider) => {
    calls.reauth.push({ uid: user.uid, parameters: provider.parameters });
    throw new Error(
      "Calendar adapter must use the shared sensitive-operation flow",
    );
  };
  const ensureSensitiveOperation = async () => {
    calls.sensitive.push(auth.currentUser?.uid);
    if (options.sensitiveError) throw options.sensitiveError;
    await options.onSensitive?.(auth, controls);
  };
  class Clock extends Date {
    static now() {
      return authTime * 1000 + 60000;
    }
  }
  const context = vm.createContext({
    module: { exports: {} },
    crypto: { randomUUID },
    Date: Clock,
    __calendarFirebase: {
      auth,
      getHttpsCallable,
      GoogleAuthProvider,
      reauthenticateWithPopup,
      ensureSensitiveOperation,
    },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  return { ...context.module.exports, calls, auth };
}

test("session handshake, scope strings, proof and event fields reach the callable", async () => {
  const client = harness();
  assert.deepEqual(clone(await client.mutateAcademicCalendar(operation())), {
    eventId: "saved-event",
    revision: 1,
  });
  assert.deepEqual(client.calls.open, [
    { authorityGeneration: generation, protocolVersion: 2 },
  ]);
  assert.deepEqual(client.calls.resolved, [
    "openApplicationSession",
    "manageAcademicCalendar",
  ]);
  assert.equal(
    client.calls.reauth.length,
    0,
    "Ordinary saves must not open a popup",
  );
  assert.equal(client.calls.sensitive.length, 0);
  const payload = client.calls.manage[0];
  assert.equal(payload.year, "2026");
  assert.equal(payload.semester, "2");
  assert.match(payload.requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(payload._session, {
    authorityGeneration: generation,
    protocolVersion: 2,
    revision: session.revision,
  });
  assert.deepEqual(payload.event, clone(operation().event));
  assert.equal("eventId" in payload, false);
  assert.equal("description" in payload.event, false);
  await client.mutateAcademicCalendar(operation());
  assert.notEqual(
    client.calls.manage[1].requestId,
    payload.requestId,
    "A completed operation must not reuse an old receipt",
  );
});

test("uncertain failures retry the identical request and proof", async () => {
  for (const code of [
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/internal",
    "auth/network-request-failed",
  ]) {
    const client = harness({
      manage: (_payload, count) => {
        if (count === 1) throw failure(code);
        return { data: { revision: 1 } };
      },
    });
    await client.mutateAcademicCalendar(operation());
    assert.equal(client.calls.manage.length, 2);
    assert.deepEqual(client.calls.manage[0], client.calls.manage[1]);
  }
});

test("a user retry after two uncertain failures keeps the request ID", async () => {
  const client = harness({
    manage: (_payload, count) => {
      if (count <= 2) throw failure("functions/unavailable");
      return { data: { revision: 1 } };
    },
  });
  await assert.rejects(client.mutateAcademicCalendar(operation()), {
    code: "functions/unavailable",
  });
  assert.equal(client.calls.manage.length, 2);
  await client.mutateAcademicCalendar(operation());
  assert.equal(
    client.calls.open.length,
    2,
    "User retry must validate the session again",
  );
  assert.deepEqual(
    client.calls.manage.map((call) => call.requestId),
    Array(3).fill(client.calls.manage[0].requestId),
  );
});

test("definite failure is not retried and the next save uses a fresh ID", async () => {
  for (const code of [
    "functions/permission-denied",
    "functions/invalid-argument",
    "functions/aborted",
    "functions/unauthenticated",
  ]) {
    const client = harness({
      manage: (_payload, count) => {
        if (count === 1) throw failure(code);
        return { data: { revision: 1 } };
      },
    });
    await assert.rejects(client.mutateAcademicCalendar(operation()), { code });
    assert.equal(client.calls.manage.length, 1);
    await client.mutateAcademicCalendar(operation());
    assert.notEqual(
      client.calls.manage[0].requestId,
      client.calls.manage[1].requestId,
    );
  }
});

test("different users and replacement User objects with the same UID cannot mutate", async () => {
  for (const uid of ["different-user", "calendar-admin"]) {
    const replaceUser = (auth) => {
      auth.currentUser = { ...auth.currentUser, uid };
    };
    for (const options of [
      { onToken: replaceUser },
      {
        onResolve: (name, auth) => {
          if (name === "openApplicationSession") replaceUser(auth);
        },
      },
      { onOpen: replaceUser },
      {
        onResolve: (name, auth) => {
          if (name === "manageAcademicCalendar") replaceUser(auth);
        },
      },
    ]) {
      const client = harness(options);
      await assert.rejects(client.mutateAcademicCalendar(operation()));
      assert.equal(client.calls.manage.length, 0);
    }
  }
});

test("stale or mismatched session data never reaches calendar mutation", async () => {
  for (const stale of [
    { status: "expired" },
    { authTime: authTime - 1 },
    { authorityGeneration: "old-generation" },
    { protocolVersion: 1 },
    { protocolVersion: undefined },
    { protocolVersion: null },
    { protocolVersion: "2" },
    { protocolVersion: NaN },
    { protocolVersion: Infinity },
    { protocolVersion: 2.5 },
    { revision: "stale-revision" },
  ]) {
    const client = harness({ session: stale });
    await assert.rejects(
      client.mutateAcademicCalendar(operation()),
      /로그인 세션을 확인하지 못했습니다/,
    );
    assert.equal(client.calls.manage.length, 0);
  }
  const client = harness({ openError: failure("functions/unauthenticated") });
  await assert.rejects(client.mutateAcademicCalendar(operation()), {
    code: "functions/unauthenticated",
  });
  assert.equal(
    client.calls.open.length,
    1,
    "Expired sessions must not be reopened in a retry loop",
  );
  assert.equal(client.calls.manage.length, 0);
});

test("signed-out requests cannot resolve or call any Firebase endpoint", async () => {
  const client = harness();
  client.auth.currentUser = null;
  await assert.rejects(
    client.mutateAcademicCalendar(operation()),
    /로그인 후 다시 저장/,
  );
  assert.deepEqual(client.calls.resolved, []);
});

test("15-, 30- and 50-minute-old authentication permits repeated ordinary mutations without step-up", async () => {
  for (const minutes of [15, 30, 50]) {
    const client = harness({ authTime: authTime + 60 - minutes * 60 });
    for (let repeat = 0; repeat < 3; repeat += 1) {
      for (const input of ordinaryOperations()) {
        await client.mutateAcademicCalendar(input);
      }
    }
    assert.equal(client.calls.manage.length, 9);
    assert.equal(
      client.calls.open.length,
      9,
      "Every mutation must validate its session",
    );
    assert.equal(client.calls.sensitive.length, 0);
    assert.equal(client.calls.reauth.length, 0);
    assert.equal(
      new Set(client.calls.manage.map((call) => call.requestId)).size,
      9,
    );
  }
});

test("invalid authentication epochs are rejected without endpoint calls or a popup", async () => {
  for (const value of [
    undefined,
    null,
    "invalid",
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const client = harness({ authTime: value });
    await assert.rejects(client.mutateAcademicCalendar(operation()));
    assert.deepEqual(client.calls.resolved, []);
    assert.equal(client.calls.manage.length, 0);
    assert.equal(client.calls.sensitive.length, 0);
    assert.equal(client.calls.reauth.length, 0);
  }
});

test("delete uses the shared step-up before a fresh handshake and retains revision proof", async () => {
  const client = harness({
    authTime: authTime - 1800,
    onSensitive: (_auth, controls) => controls.setAuthTime(authTime),
    session: { authTime },
  });
  await client.mutateAcademicCalendar(deleteOperation());
  assert.deepEqual(client.calls.sensitive, ["calendar-admin"]);
  assert.equal(client.calls.reauth.length, 0);
  assert.equal(client.calls.open.length, 1);
  assert.equal(client.calls.manage.length, 1);
  assert.equal(client.calls.manage[0].action, "DELETE_EVENT");
  assert.equal(client.calls.manage[0].eventId, "event-1");
  assert.equal(client.calls.manage[0].expectedRevision, 1);
  assert.equal(client.calls.manage[0]._session.revision, session.revision);
});

test("delete cancellation, popup errors and step-up failures preserve input without any write", async () => {
  for (const code of [
    "auth/reauthentication-cancelled",
    "auth/popup-blocked",
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
    "functions/unauthenticated",
    "functions/permission-denied",
    "auth/network-request-failed",
  ]) {
    const client = harness({
      authTime: authTime - 600,
      sensitiveError: failure(code),
    });
    const input = deleteOperation();
    const before = clone(input);
    await assert.rejects(client.mutateAcademicCalendar(input), { code });
    assert.deepEqual(clone(input), before);
    assert.equal(client.calls.sensitive.length, 1);
    assert.equal(client.calls.reauth.length, 0);
    assert.deepEqual(client.calls.resolved, []);
    assert.equal(client.calls.open.length, 0);
    assert.equal(client.calls.manage.length, 0);
  }
});

test("expired ordinary sessions never start reauthentication or automatic reopen loops", async () => {
  for (const reason of [
    "SESSION_REAUTH_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_IDLE_EXPIRED",
  ]) {
    const expired = Object.assign(failure("functions/unauthenticated"), {
      details: { reason },
    });
    for (const input of ordinaryOperations()) {
      const client = harness({ authTime: authTime - 1800, openError: expired });
      await assert.rejects(client.mutateAcademicCalendar(input), {
        code: expired.code,
      });
      assert.equal(client.calls.open.length, 1);
      assert.equal(client.calls.manage.length, 0);
      assert.equal(client.calls.sensitive.length, 0);
      assert.equal(client.calls.reauth.length, 0);
      const rejectedWrite = harness({
        manage: () => {
          throw expired;
        },
      });
      await assert.rejects(rejectedWrite.mutateAcademicCalendar(input), {
        code: expired.code,
      });
      assert.equal(rejectedWrite.calls.open.length, 1);
      assert.equal(
        rejectedWrite.calls.manage.length,
        1,
        "A definite expiry must not replay a mutation",
      );
      assert.equal(rejectedWrite.calls.sensitive.length, 0);
      assert.equal(rejectedWrite.calls.reauth.length, 0);
    }
  }
});

test("delete never repeats step-up when its subsequent session handshake expires", async () => {
  const client = harness({
    openError: Object.assign(failure("functions/unauthenticated"), {
      details: { reason: "SESSION_REAUTH_REQUIRED" },
    }),
  });
  await assert.rejects(client.mutateAcademicCalendar(deleteOperation()));
  assert.equal(client.calls.sensitive.length, 1);
  assert.equal(client.calls.reauth.length, 0);
  assert.equal(client.calls.open.length, 1);
  assert.equal(client.calls.manage.length, 0);
});

test("User replacement during shared delete step-up stops before the handshake", async () => {
  for (const uid of ["different-user", "calendar-admin"]) {
    const client = harness({
      onSensitive: (auth) => {
        auth.currentUser = { ...auth.currentUser, uid };
      },
    });
    await assert.rejects(client.mutateAcademicCalendar(deleteOperation()));
    assert.equal(client.calls.open.length, 0);
    assert.equal(client.calls.manage.length, 0);
  }
});

test("authentication epoch changes at awaited boundaries cannot send a stale mutation", async () => {
  for (const options of [
    {
      onToken: (_auth, controls, count) => {
        if (count === 2) controls.setAuthTime(authTime + 1);
      },
    },
    {
      onResolve: (name, _auth, controls) => {
        if (name === "openApplicationSession")
          controls.setAuthTime(authTime + 1);
      },
    },
    { onOpen: (_auth, controls) => controls.setAuthTime(authTime + 1) },
    {
      onResolve: (name, _auth, controls) => {
        if (name === "manageAcademicCalendar")
          controls.setAuthTime(authTime + 1);
      },
    },
  ]) {
    const client = harness(options);
    await assert.rejects(client.mutateAcademicCalendar(operation()));
    assert.equal(client.calls.manage.length, 0);
    assert.equal(client.calls.sensitive.length, 0);
  }
});

test("identity or epoch changes while a mutation completes reject its result and prevent retry", async () => {
  for (const change of [
    (auth) => {
      auth.currentUser = { ...auth.currentUser };
    },
    (_auth, controls) => controls.setAuthTime(authTime + 1),
  ]) {
    for (const uncertainFailure of [false, true]) {
      const client = harness({
        manage: (_payload, _count, auth, controls) => {
          change(auth, controls);
          if (uncertainFailure) throw failure("functions/unavailable");
          return { data: { revision: 1 } };
        },
      });
      await assert.rejects(client.mutateAcademicCalendar(operation()));
      assert.equal(
        client.calls.manage.length,
        1,
        "A changed authority must never replay the pending mutation",
      );
      assert.equal(client.calls.sensitive.length, 0);
      assert.equal(client.calls.reauth.length, 0);
    }
  }
});

test("a successful write rejected after authority changes retains its receipt for the next explicit retry", async () => {
  for (const change of [
    (auth) => {
      auth.currentUser = { ...auth.currentUser };
    },
    (_auth, controls) => controls.setAuthTime(authTime + 1),
  ]) {
    const client = harness({
      manage: (_payload, count, auth, controls) => {
        if (count === 1) change(auth, controls);
        return { data: { eventId: "saved-event", revision: 1 } };
      },
    });
    await assert.rejects(client.mutateAcademicCalendar(operation()));
    assert.equal(client.calls.manage.length, 1);
    const requestId = client.calls.manage[0].requestId;
    assert.deepEqual(clone(await client.mutateAcademicCalendar(operation())), {
      eventId: "saved-event",
      revision: 1,
    });
    assert.equal(
      client.calls.open.length,
      2,
      "Explicit retry must validate the new session",
    );
    assert.equal(client.calls.manage.length, 2);
    assert.equal(
      client.calls.manage[1].requestId,
      requestId,
      "The committed write must not become a new creation after reauthentication",
    );
    assert.equal(client.calls.sensitive.length, 0);
    assert.equal(client.calls.reauth.length, 0);
    await client.mutateAcademicCalendar(operation());
    assert.notEqual(
      client.calls.manage[2].requestId,
      requestId,
      "An acknowledged operation must release the old receipt",
    );
  }
});
