import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

// Compile the real adapter, replacing its sole runtime dependency before it
// loads. These checks cannot initialize Firebase or contact production.
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
          { filter: /^(\.\/firebase|firebase\/auth)$/ },
          ({ path }) => ({
            path,
            namespace: "calendar-test",
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "calendar-test" },
          ({ path }) => ({
            contents:
              path === "firebase/auth"
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
const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (code) => Object.assign(new Error(code), { code });

function harness(options = {}) {
  const calls = { resolved: [], open: [], manage: [], reauth: [] };
  let tokenAuthTime = options.authTime ?? authTime;
  const auth = {
    currentUser: {
      uid: "calendar-admin",
      email: "admin@example.test",
      async getIdTokenResult() {
        options.onToken?.(auth);
        return { claims: { auth_time: String(tokenAuthTime) } };
      },
    },
  };
  const getHttpsCallable = async (name) => {
    calls.resolved.push(name);
    options.onResolve?.(name, auth);
    if (name === "openApplicationSession")
      return async (payload) => {
        calls.open.push(clone(payload));
        options.onOpen?.(auth);
        const openError =
          typeof options.openError === "function"
            ? options.openError(calls.open.length)
            : options.openError;
        if (openError) throw openError;
        return {
          data: { ...session, authTime: tokenAuthTime, ...options.session },
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
        ? options.manage(payload, calls.manage.length, auth)
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
    if (options.popupError) throw options.popupError;
    options.onReauth?.(auth);
    tokenAuthTime = authTime;
    return { user: options.reauthUser || user };
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
    "Fresh authentication must not open a popup",
  );
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

test("a changed user before mutation is rejected at every awaited boundary", async () => {
  const replaceUser = (auth) => {
    auth.currentUser = { uid: "different-user" };
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
    await assert.rejects(
      client.mutateAcademicCalendar(operation()),
      /로그인 사용자가 바뀌었습니다/,
    );
    assert.equal(client.calls.manage.length, 0);
  }
});

test("stale or mismatched session data never reaches calendar mutation", async () => {
  for (const stale of [
    { status: "expired" },
    { authTime: authTime - 1 },
    { authorityGeneration: "old-generation" },
    { protocolVersion: 1 },
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

test("older explicit mutations reauthenticate the same account and use fresh token proof", async () => {
  for (const input of [
    operation(),
    {
      action: "DELETE_EVENT",
      year: 2026,
      semester: 2,
      eventId: "event-1",
      expectedRevision: 1,
    },
    { action: "SAVE_CATEGORIES", year: 2026, semester: 2, items: [] },
  ]) {
    const client = harness({ authTime: authTime - 600 });
    await client.mutateAcademicCalendar(input);
    assert.deepEqual(clone(client.calls.reauth), [
      {
        uid: "calendar-admin",
        parameters: { login_hint: "admin@example.test" },
      },
    ]);
    assert.equal(client.calls.manage.length, 1);
    assert.equal(client.calls.open.length, 1);
  }
  for (const invalidTime of [authTime + 3600, "invalid"]) {
    const client = harness({ authTime: invalidTime });
    await client.mutateAcademicCalendar(operation());
    assert.equal(client.calls.reauth.length, 1);
  }
});

test("automatic holiday synchronization never opens a popup", async () => {
  const input = {
    action: "SYNC_HOLIDAYS",
    year: 2026,
    semester: 2,
    holidays: [],
  };
  const client = harness({ authTime: authTime - 600 });
  await client.mutateAcademicCalendar(input);
  assert.equal(client.calls.reauth.length, 0);
  const expired = harness({
    openError: Object.assign(failure("functions/unauthenticated"), {
      details: { reason: "SESSION_REAUTH_REQUIRED" },
    }),
  });
  await assert.rejects(expired.mutateAcademicCalendar(input));
  assert.equal(expired.calls.reauth.length, 0);
  assert.equal(expired.calls.manage.length, 0);
});

test("popup cancellation or blocking retains the operation without a write", async () => {
  for (const code of [
    "auth/popup-blocked",
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
  ]) {
    const client = harness({
      authTime: authTime - 600,
      popupError: failure(code),
    });
    const input = operation();
    const before = clone(input);
    await assert.rejects(client.mutateAcademicCalendar(input), { code });
    assert.deepEqual(clone(input), before);
    assert.equal(client.calls.open.length, 0);
    assert.equal(client.calls.manage.length, 0);
    assert.match(
      client.academicCalendarErrorMessage(failure(code)),
      /입력 내용은 유지됩니다/,
    );
  }
});

test("session expiry allows one explicit reauthentication and never loops", async () => {
  const expired = Object.assign(failure("functions/unauthenticated"), {
    details: { reason: "SESSION_REAUTH_REQUIRED" },
  });
  const recovered = harness({
    openError: (count) => (count === 1 ? expired : null),
  });
  await recovered.mutateAcademicCalendar(operation());
  assert.equal(recovered.calls.reauth.length, 1);
  assert.equal(recovered.calls.open.length, 2);
  assert.equal(recovered.calls.manage.length, 1);
  const neverRecovered = harness({ openError: expired });
  await assert.rejects(neverRecovered.mutateAcademicCalendar(operation()));
  assert.equal(neverRecovered.calls.reauth.length, 1);
  assert.equal(neverRecovered.calls.open.length, 2);
  assert.equal(neverRecovered.calls.manage.length, 0);
  const alreadyReauthenticated = harness({
    authTime: authTime - 600,
    openError: expired,
  });
  await assert.rejects(
    alreadyReauthenticated.mutateAcademicCalendar(operation()),
  );
  assert.equal(alreadyReauthenticated.calls.reauth.length, 1);
  assert.equal(alreadyReauthenticated.calls.open.length, 1);
});

test("identity changes during popup authentication never write calendar data", async () => {
  for (const options of [
    {
      onReauth: (auth) => {
        auth.currentUser = { uid: "different-user" };
      },
    },
    { reauthUser: { uid: "different-user" } },
  ]) {
    const client = harness({ authTime: authTime - 600, ...options });
    await assert.rejects(
      client.mutateAcademicCalendar(operation()),
      /계정|사용자/,
    );
    assert.equal(client.calls.open.length, 0);
    assert.equal(client.calls.manage.length, 0);
  }
});
