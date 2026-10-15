/**
 * Exercise the real History Classroom client, archive aliases, Firebase Auth,
 * and Firebase Functions SDK. Only the HTTP server is synthetic: no Firebase
 * wrapper, command, session helper, serializer, or auth User is mocked.
 * All fetch requests are restricted to this process's loopback server.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const epoch = Math.floor(Date.now() / 1000);
const uid = "synthetic-history-teacher";
const projectId = "history-quiz-yongsin";
const generation = "w1r2-2026-08-09";
const revision = "a".repeat(64);
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = [
  encode({ alg: "none", typ: "JWT" }),
  encode({
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: uid,
    user_id: uid,
    auth_time: epoch,
    iat: epoch,
    exp: epoch + 3600,
    firebase: { sign_in_provider: "custom", identities: {} },
  }),
  "synthetic-signature",
].join(".");
const session = {
  status: "active",
  authTime: epoch,
  authorityGeneration: generation,
  protocolVersion: 2,
  revision,
};
const requests = [];
const serverErrors = [];
const receipts = new Map();
let ticketWrites = 0;
let dropGrantResponse = false;
let failStatus = false;
let rejectSession = false;
const reply = (response, status, payload) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};
const server = http.createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.endsWith("/accounts:signInWithCustomToken")) {
      assert.equal(body.token, "synthetic-custom-token");
      return reply(response, 200, {
        idToken,
        refreshToken: "synthetic-refresh-token",
        expiresIn: "3600",
        isNewUser: false,
        localId: uid,
      });
    }
    if (pathname.endsWith("/accounts:lookup")) {
      assert.equal(body.idToken, idToken);
      return reply(response, 200, {
        users: [
          {
            localId: uid,
            displayName: "합성 검증 교사",
            createdAt: String(epoch * 1000),
          },
        ],
      });
    }
    const name = pathname.split("/").at(-1);
    assert(
      pathname.startsWith(`/${projectId}/asia-northeast3/`),
      `Unexpected path: ${pathname}`,
    );
    assert.equal(request.headers.authorization, `Bearer ${idToken}`);
    assert.deepEqual(
      Object.keys(body),
      ["data"],
      "Use the actual callable HTTP envelope",
    );
    const data = body.data;
    requests.push({ name, data: structuredClone(data) });
    if (name === "openApplicationSession") {
      assert.deepEqual(data, {
        authorityGeneration: generation,
        protocolVersion: 2,
      });
      if (rejectSession) {
        return reply(response, 401, {
          error: {
            status: "UNAUTHENTICATED",
            message: "합성 세션 만료",
            details: { reason: "SESSION_REAUTH_REQUIRED" },
          },
        });
      }
      return reply(response, 200, { result: session });
    }
    assert.deepEqual(
      data._session,
      {
        authorityGeneration: generation,
        protocolVersion: 2,
        revision,
      },
      "The real session helper injects the validated proof",
    );
    assert.equal(data.commandType, "grantHistoryClassroomExemptions");
    if (name === "getCommandStatus") {
      if (failStatus)
        return reply(response, 503, {
          error: { status: "UNAVAILABLE", message: "합성 연결 끊김" },
        });
      return reply(response, 200, {
        result: receipts.get(data.commandId) || {
          commandId: data.commandId,
          commandType: data.commandType,
          status: "NOT_FOUND",
          result: null,
        },
      });
    }
    assert.equal(name, "executeCommand");
    assert.match(data.commandId, /^[a-f0-9-]{36}$/);
    const previous = receipts.get(data.commandId);
    if (!previous) {
      const { payload } = data;
      assert.equal(payload.semesterId, "2026-2");
      assert.equal(payload.classId, "3-2");
      assert.equal(payload.targetGrade, "3");
      assert.equal(payload.targetClass, "2");
      assert.equal(payload.recipientUids.length, 32);
      assert.equal(new Set(payload.recipientUids).size, 32);
      assert(payload.recipientUids.every((value) => typeof value === "string"));
      assert.match(payload.reason, /현장체험학습/);
      assert.deepEqual(Object.keys(payload).sort(), [
        "classId",
        "reason",
        "recipientUids",
        "semesterId",
        "targetClass",
        "targetGrade",
      ]);
      ticketWrites += payload.recipientUids.length;
      receipts.set(data.commandId, {
        commandId: data.commandId,
        commandType: data.commandType,
        status: "SUCCEEDED",
        replayed: false,
        result: {
          createdCount: payload.recipientUids.length,
          exemptionIds: payload.recipientUids.map(
            (studentUid) => `${data.commandId}-${studentUid}`,
          ),
        },
      });
    }
    if (dropGrantResponse) {
      dropGrantResponse = false;
      response.destroy();
      return;
    }
    return reply(response, 200, {
      result: { ...receipts.get(data.commandId), replayed: Boolean(previous) },
    });
  } catch (error) {
    serverErrors.push(error.message);
    reply(response, 500, {
      error: { status: "INTERNAL", message: error.message },
    });
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const nativeFetch = globalThis.fetch;
const forbiddenRequests = [];
globalThis.fetch = (input, options) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.origin !== origin) {
    forbiddenRequests.push(url.origin);
    return Promise.reject(
      new Error(
        `External requests forbidden in SDK contract test: ${url.origin}`,
      ),
    );
  }
  return nativeFetch(input, options);
};

let api;
try {
  const aliases = [
    ["firebase/auth", "src/lib/archiveAuth.ts"],
    ["firebase/firestore", "src/lib/archiveFirestore.ts"],
    ["firebase/storage", "src/lib/archiveStorage.ts"],
  ];
  const bundle = await build({
    stdin: {
      contents: `
        export { grantHistoryClassroomExemptions } from "./src/lib/historyClassroom";
        export { app, auth } from "./src/lib/firebase";
        export { connectAuthEmulator, signInWithCustomToken, signOut } from "firebase/auth";
        export { deleteApp } from "firebase/app";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    define: {
      "import.meta.env": JSON.stringify({
        DEV: true,
        VITE_USE_FIREBASE_EMULATORS: "true",
        VITE_FUNCTIONS_EMULATOR_HOST: "127.0.0.1",
        VITE_FUNCTIONS_EMULATOR_PORT: String(server.address().port),
        VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1",
        VITE_FIRESTORE_EMULATOR_PORT: String(server.address().port),
      }),
    },
    plugins: [
      {
        name: "production-firebase-aliases",
        setup(builder) {
          for (const [name, filename] of aliases) {
            builder.onResolve(
              { filter: new RegExp(`^${name.replaceAll("/", "\\/")}$`) },
              () => ({ path: path.join(root, filename) }),
            );
          }
        },
      },
    ],
    logLevel: "silent",
  });
  for (const filename of [
    "src/lib/historyClassroom.ts",
    "src/lib/assessmentLifecycle.ts",
    "src/lib/historyDictionarySession.ts",
    "src/lib/firebase.ts",
    "src/lib/archiveAuth.ts",
    "src/lib/archiveFirestore.ts",
  ]) {
    assert(
      Object.keys(bundle.metafile.inputs).some((input) =>
        input.replaceAll("\\", "/").endsWith(filename),
      ),
      `Real module included: ${filename}`,
    );
  }
  assert(
    Object.keys(bundle.metafile.inputs).some((input) =>
      input.replaceAll("\\", "/").includes("@firebase/functions/"),
    ),
    "Actual Functions SDK is bundled",
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  api = module.exports;
  api.connectAuthEmulator(api.auth, origin, { disableWarnings: true });
  await api.signInWithCustomToken(api.auth, "synthetic-custom-token");
  assert.equal(api.auth.currentUser.uid, uid);

  const selected = Array.from(
    { length: 34 },
    (_, index) => `syntheticStudent${String(index + 1).padStart(2, "0")}`,
  ).filter((_, index) => ![5, 33].includes(index));
  const config = { year: "2026", semester: "2" };
  const input = {
    recipientUids: selected.toReversed(),
    classId: "3-2",
    targetGrade: "3",
    targetClass: "2",
    reason: "무탈한 현장체험학습에 기여함.",
  };
  const granted = await api.grantHistoryClassroomExemptions(config, input);
  assert.equal(granted.createdCount, 32);
  assert.equal(granted.exemptionIds.length, 32);
  assert.deepEqual(
    requests.map(({ name }) => name),
    ["openApplicationSession", "executeCommand"],
  );
  assert.deepEqual(
    requests.at(-1).data.payload.recipientUids,
    [...selected].sort(),
  );
  assert.equal(requests.at(-1).data.payload.reason, input.reason);
  assert.equal(ticketWrites, 32);

  dropGrantResponse = true;
  const recovered = await api.grantHistoryClassroomExemptions(config, {
    ...input,
    reason: `${input.reason} 응답 복구 검증`,
  });
  assert.equal(recovered.createdCount, 32);
  assert.equal(ticketWrites, 64);
  assert.deepEqual(
    requests.slice(-4).map(({ name }) => name),
    [
      "openApplicationSession",
      "executeCommand",
      "openApplicationSession",
      "getCommandStatus",
    ],
  );

  dropGrantResponse = true;
  failStatus = true;
  const retryInput = { ...input, reason: `${input.reason} 명시적 재시도 검증` };
  await assert.rejects(
    api.grantHistoryClassroomExemptions(config, retryInput),
    (error) =>
      ["functions/internal", "functions/unavailable"].includes(error.code),
  );
  const uncertain = requests.findLast(
    ({ name }) => name === "executeCommand",
  ).data;
  assert.equal(ticketWrites, 96);
  failStatus = false;
  const retried = await api.grantHistoryClassroomExemptions(config, {
    ...retryInput,
    recipientUids: selected,
  });
  assert.equal(retried.createdCount, 32);
  assert.equal(
    ticketWrites,
    96,
    "A retry must not issue another set of 32 tickets",
  );
  const retry = requests.findLast(({ name }) => name === "executeCommand").data;
  assert.equal(retry.commandId, uncertain.commandId);
  assert.deepEqual(retry.payload, uncertain.payload);

  rejectSession = true;
  const previousGrants = requests.filter(
    ({ name }) => name === "executeCommand",
  ).length;
  await assert.rejects(api.grantHistoryClassroomExemptions(config, input), {
    code: "functions/unauthenticated",
  });
  assert.equal(
    requests.filter(({ name }) => name === "executeCommand").length,
    previousGrants,
  );
  assert.deepEqual(
    forbiddenRequests,
    [],
    "No production or other external requests",
  );
  assert.deepEqual(
    serverErrors,
    [],
    "Synthetic HTTP boundary accepted every real SDK request",
  );
  console.log(
    "PASS History Classroom SDK contract: real client/session/archive aliases/Auth/Functions SDK, 32 Korean class grants, lost-response receipt recovery, exact retry and expired-session rejection; loopback HTTP only",
  );
} finally {
  if (api?.app) await api.deleteApp(api.app);
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
