import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";

// Bundle the real client with explicit Firebase mocks. No Firebase service or
// production connection is initialized by this regression harness.
const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/lessonManagement.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  define: { "import.meta.env": "globalThis.__lessonEnv" },
  plugins: [
    {
      name: "isolated-lesson-firebase",
      setup(builder) {
        builder.onResolve(
          { filter: /^(\.\/firebase|firebase\/)/ },
          ({ path }) => ({
            path,
            namespace: "lesson-test",
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "lesson-test" },
          ({ path }) => {
            const exports = {
              "./firebase": ["app", "auth", "db", "getHttpsCallable"],
              "firebase/auth": ["onAuthStateChanged"],
              "firebase/firestore": ["doc", "getDocFromServer", "onSnapshot"],
              "firebase/app-check": [
                "initializeAppCheck",
                "ReCaptchaEnterpriseProvider",
                "getToken",
              ],
            }[path];
            assert.ok(exports, `Unmocked Firebase dependency: ${path}`);
            return {
              contents: exports
                .map(
                  (name) =>
                    `export const ${name} = globalThis.__lessonFirebase.${name};`,
                )
                .join("\n"),
              loader: "js",
            };
          },
        );
      },
    },
  ],
});

const generation = "w1r2-2026-08-09";
const authTime = 1770000000;
const config = { year: "2026", semester: "2" };
const commandScope = { semesterId: "2026-2", expectedSemesterRevision: 4 };
const frame = {
  id: "exam-highlight-1",
  page: 1,
  leftRatio: 0.1,
  topRatio: 0.2,
  widthRatio: 0.3,
  heightRatio: 0.15,
};
const documentInput = () => ({
  unitId: "lesson-unit",
  expectedRevision: 7,
  document: { worksheetExamHighlights: [frame] },
  assetUploadIds: [],
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (code, reason) =>
  Object.assign(new Error(reason || code), {
    code,
    ...(reason ? { details: { reason } } : {}),
  });
const snapshot = (data) => ({
  exists: () => data !== undefined,
  data: () => data,
  metadata: { fromCache: false, hasPendingWrites: false },
});

function harness(options = {}) {
  const calls = {
    resolved: [],
    open: [],
    execute: [],
    status: [],
    upload: [],
    reads: [],
    listeners: [],
    authWatches: 0,
    appCheck: [],
    appCheckTokens: 0,
  };
  const tickets = new Map();
  let currentTime = authTime * 1000 + 2 * 60 * 60 * 1000;
  let tokenCalls = 0;
  const auth = {
    currentUser: {
      uid: "lesson-teacher",
      email: "lesson.teacher@yongshin-ms.ms.kr",
      async getIdTokenResult() {
        tokenCalls += 1;
        options.onToken?.(auth, tokenCalls);
        return {
          claims: {
            auth_time: options.tokenAuthTime?.(tokenCalls) ?? authTime,
          },
        };
      },
    },
  };
  const pointer = { semesterId: "2026-2", revision: 4, ...options.pointer };
  const getDocFromServer = async (ref) => {
    calls.reads.push(ref.path);
    options.onRead?.(ref.path, auth);
    if (ref.path === "site_settings/semester_active")
      return snapshot(options.noPointer ? undefined : pointer);
    assert.match(
      ref.path,
      /^lesson_asset_uploads\//,
      "Only the pointer and upload tickets may be read",
    );
    const id = ref.path.split("/")[1];
    return snapshot(
      options.ticketRead
        ? options.ticketRead(id, tickets, calls)
        : tickets.get(id),
    );
  };
  const getHttpsCallable = async (name) => {
    calls.resolved.push(name);
    options.onResolve?.(name, auth);
    if (name === "openApplicationSession")
      return async (input) => {
        calls.open.push(clone(input));
        options.onOpen?.(auth);
        if (options.openError) throw options.openError;
        return {
          data: {
            status: "active",
            authTime,
            authorityGeneration: generation,
            protocolVersion: 2,
            revision: "a".repeat(64),
            ...options.session,
          },
        };
      };
    if (name === "executeCommand")
      return async (input) => {
        calls.execute.push(clone(input));
        if (options.execute)
          return options.execute(input, calls.execute.length, auth, tickets);
        if (input.commandType === "prepareLessonAssetUpload") {
          const ticket = {
            uploadId: input.commandId,
            storagePath: `lesson_uploads/${input.commandId}/source`,
            expiresAtMs: currentTime + 3600000,
          };
          tickets.set(ticket.uploadId, {
            ...ticket,
            status: options.ticketStatus || "PENDING",
            url: "https://example.test/verified.pdf",
          });
          return { data: { status: "SUCCEEDED", result: ticket } };
        }
        return {
          data: {
            status: "SUCCEEDED",
            result: {
              unitId: input.payload.unitId,
              contentRevision: input.payload.expectedRevision + 1,
              treeRevision: input.payload.tree
                ? input.payload.expectedTreeRevision + 1
                : null,
              pdfProcessing: null,
            },
          },
        };
      };
    if (name === "getCommandStatus")
      return async (input) => {
        calls.status.push(clone(input));
        options.onStatus?.(auth);
        return options.status
          ? options.status(input, calls.status.length, auth)
          : { data: { status: "NOT_FOUND", result: null } };
      };
    if (name === "uploadLessonAssetContent")
      return async (input) => {
        calls.upload.push(clone(input));
        const verified = {
          ...tickets.get(input.uploadId),
          status: "VERIFIED",
          url: "https://example.test/verified.pdf",
          pdfProcessing: { extractionStatus: "ready", pageCount: 1 },
        };
        if (options.upload)
          return options.upload(input, verified, auth, tickets);
        tickets.set(input.uploadId, verified);
        return { data: { verifiedAsset: verified } };
      };
    throw new Error(`Unexpected callable: ${name}`);
  };
  const onSnapshot = (ref, _metadataOptions, next) => {
    const record = { path: ref.path, stopped: false };
    calls.listeners.push(record);
    queueMicrotask(() => {
      if (record.stopped) return;
      const value = options.observedTicket || {
        status: "VERIFIED",
        url: "https://example.test/observed.pdf",
      };
      next(snapshot(value));
    });
    return () => {
      record.stopped = true;
    };
  };
  const onAuthStateChanged = (_auth, next) => {
    calls.authWatches += 1;
    let stopped = false;
    queueMicrotask(() => {
      if (!stopped) next(auth.currentUser);
    });
    return () => {
      stopped = true;
    };
  };
  class Clock extends Date {
    static now() {
      return currentTime;
    }
  }
  const context = vm.createContext({
    module: { exports: {} },
    crypto: { randomUUID, subtle: webcrypto.subtle },
    Date: Clock,
    Blob,
    Uint8Array,
    setTimeout,
    clearTimeout,
    console,
    btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
    __lessonEnv: {
      DEV: false,
      VITE_FIREBASE_APPCHECK_SITE_KEY: "test-public-site-key",
      ...options.env,
    },
    __lessonFirebase: {
      app: {},
      auth,
      db: {},
      getHttpsCallable,
      getDocFromServer,
      onSnapshot,
      onAuthStateChanged,
      doc: (_db, ...parts) => ({ path: parts.join("/") }),
      initializeAppCheck: (_app, settings) => {
        calls.appCheck.push(settings);
        return {};
      },
      ReCaptchaEnterpriseProvider: class {
        constructor(siteKey) {
          this.siteKey = siteKey;
        }
      },
      getToken: async () => {
        calls.appCheckTokens += 1;
        if (options.appCheckError) throw options.appCheckError;
        return { token: "mock-app-check-token" };
      },
    },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  return {
    ...context.module.exports,
    calls,
    auth,
    tickets,
    advance: (ms) => {
      currentTime += ms;
    },
  };
}

test("a frame-only save sends the deployed command, revisions, proof and no upload", async () => {
  const client = harness();
  const result = await client.saveLessonDocument(config, documentInput());
  assert.equal(result.contentRevision, 8);
  assert.deepEqual(client.calls.open, [
    { authorityGeneration: generation, protocolVersion: 2 },
  ]);
  assert.deepEqual(client.calls.resolved, [
    "openApplicationSession",
    "executeCommand",
  ]);
  const command = client.calls.execute[0];
  assert.match(command.commandId, /^[0-9a-f-]{36}$/);
  assert.equal(command.commandType, "saveLessonDocument");
  assert.deepEqual(command.payload, { ...documentInput(), ...commandScope });
  assert.deepEqual(command._session, {
    authorityGeneration: generation,
    protocolVersion: 2,
    revision: "a".repeat(64),
  });
  assert.equal("unitId" in command.payload.document, false);
  assert.equal("updatedAt" in command.payload.document, false);
  assert.equal(client.calls.upload.length, 0);
  assert.equal(client.calls.appCheck.length, 0);
});

test("old authentication with a valid general session saves without reauthentication", async () => {
  const client = harness();
  await client.saveLessonDocument(config, documentInput());
  assert.equal(client.calls.execute.length, 1);
  assert.ok(
    client.calls.resolved.every((name) =>
      ["openApplicationSession", "executeCommand"].includes(name),
    ),
  );
});

test("tree changes and document/title changes carry explicit conflict revisions", async () => {
  const client = harness();
  const tree = [{ id: "lesson-unit", title: "새 제목", children: [] }];
  await client.saveLessonTree(config, { expectedRevision: 3, tree });
  assert.deepEqual(client.calls.execute[0].payload, {
    expectedRevision: 3,
    tree,
    ...commandScope,
  });
  await client.saveLessonDocument(config, {
    ...documentInput(),
    tree,
    expectedTreeRevision: 4,
  });
  assert.equal(client.calls.execute[1].payload.expectedTreeRevision, 4);
  assert.deepEqual(client.calls.execute[1].payload.tree, tree);
});

test("an operation keeps its explicitly captured semester scope across preparation", async () => {
  const client = harness({ pointer: { semesterId: "2027-1", revision: 99 } });
  await client.saveLessonDocument(config, documentInput(), {
    expectedUid: "lesson-teacher",
    commandScope,
  });
  assert.equal(client.calls.reads.length, 0);
  assert.equal(client.calls.execute[0].payload.expectedSemesterRevision, 4);
});

test("missing, stale or malformed semester pointers stop before mutation", async () => {
  for (const options of [
    { noPointer: true },
    { pointer: { semesterId: "2026-1" } },
    { pointer: { revision: -1 } },
    { pointer: { revision: 1.5 } },
    { pointer: { revision: "4" } },
  ]) {
    const client = harness(options);
    await assert.rejects(client.saveLessonDocument(config, documentInput()));
    assert.equal(client.calls.execute.length, 0);
  }
  const client = harness();
  await assert.rejects(
    client.saveLessonDocument({ year: "2026", semester: "3" }, documentInput()),
  );
  assert.equal(client.calls.reads.length, 0);
});

test("invalid session proof, authentication time or closed session stops mutation", async () => {
  for (const session of [
    { status: "closed" },
    { authTime: authTime + 1 },
    { authorityGeneration: "obsolete" },
    { protocolVersion: 1 },
    { protocolVersion: 2.5 },
    { revision: "invalid" },
  ]) {
    const client = harness({ session });
    await assert.rejects(client.saveLessonDocument(config, documentInput()));
    assert.equal(client.calls.execute.length, 0);
  }
  const client = harness({
    openError: failure("functions/unauthenticated", "SESSION_REAUTH_REQUIRED"),
  });
  await assert.rejects(client.saveLessonDocument(config, documentInput()), {
    code: "functions/unauthenticated",
  });
  assert.equal(client.calls.execute.length, 0);
});

test("a user change during pointer, token, handshake or callable loading stops mutation", async () => {
  const switchUser = (auth) => {
    auth.currentUser = { ...auth.currentUser, uid: "different-user" };
  };
  for (const options of [
    { onRead: (_path, auth) => switchUser(auth) },
    { onToken: (auth) => switchUser(auth) },
    { onOpen: switchUser },
    {
      onResolve: (name, auth) => {
        if (name === "executeCommand") switchUser(auth);
      },
    },
  ]) {
    const client = harness(options);
    await assert.rejects(client.saveLessonDocument(config, documentInput()));
    assert.equal(client.calls.execute.length, 0);
  }
  const client = harness({
    tokenAuthTime: (count) => authTime + (count > 1 ? 1 : 0),
  });
  await assert.rejects(client.saveLessonDocument(config, documentInput()));
  assert.equal(client.calls.execute.length, 0);
});

test("a lost acknowledgement resolves the original receipt without duplicate mutation", async () => {
  const client = harness({
    execute: () => {
      throw failure("functions/unavailable");
    },
    status: () => ({
      data: { status: "SUCCEEDED", result: { contentRevision: 8 } },
    }),
  });
  assert.equal(
    (await client.saveLessonDocument(config, documentInput())).contentRevision,
    8,
  );
  assert.equal(client.calls.execute.length, 1);
  assert.equal(
    client.calls.status[0].commandId,
    client.calls.execute[0].commandId,
  );
  assert.equal(client.calls.status[0].commandType, "saveLessonDocument");
});

test("explicit retry after an uncertain failure reuses the identical command ID and payload", async () => {
  for (const code of [
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/internal",
    "auth/network-request-failed",
  ]) {
    const client = harness({
      execute: (_input, count) => {
        if (count === 1) throw failure(code);
        return {
          data: { status: "SUCCEEDED", result: { contentRevision: 8 } },
        };
      },
    });
    await assert.rejects(client.saveLessonDocument(config, documentInput()), {
      code,
    });
    await client.saveLessonDocument(config, documentInput());
    assert.deepEqual(client.calls.execute[0], client.calls.execute[1]);
  }
});

test("a failed receipt read preserves the original uncertain error and retry ID", async () => {
  const originalError = failure("functions/deadline-exceeded");
  const client = harness({
    execute: (_input, count) => {
      if (count === 1) throw originalError;
      return { data: { status: "SUCCEEDED", result: { contentRevision: 8 } } };
    },
    status: () => {
      throw failure("functions/permission-denied");
    },
  });
  await assert.rejects(
    client.saveLessonDocument(config, documentInput()),
    (error) => error === originalError,
  );
  await client.saveLessonDocument(config, documentInput());
  assert.equal(
    client.calls.execute[0].commandId,
    client.calls.execute[1].commandId,
  );
});

test("stale application sessions and content revisions never fall back to direct writes", async () => {
  for (const [code, reason] of [
    ["functions/unauthenticated", "SESSION_EXPIRED"],
    ["functions/aborted", "LESSON_CONTENT_CONFLICT"],
    ["functions/failed-precondition", "LESSON_SEMESTER_NOT_ACTIVE"],
  ]) {
    const client = harness({
      execute: () => {
        throw failure(code, reason);
      },
    });
    await assert.rejects(
      client.saveLessonDocument(config, documentInput()),
      (error) => error.details?.reason === reason,
    );
    assert.equal(client.calls.execute.length, 1);
    assert.equal(client.calls.status.length, 0);
    assert.equal(client.calls.upload.length, 0);
  }
});

test("a definite conflict or permission failure never retries and a later save gets a fresh ID", async () => {
  for (const code of [
    "functions/aborted",
    "functions/permission-denied",
    "functions/invalid-argument",
    "functions/unauthenticated",
  ]) {
    const client = harness({
      execute: (_input, count) => {
        if (count === 1) throw failure(code);
        return {
          data: { status: "SUCCEEDED", result: { contentRevision: 8 } },
        };
      },
    });
    await assert.rejects(client.saveLessonDocument(config, documentInput()), {
      code,
    });
    assert.equal(client.calls.status.length, 0);
    await client.saveLessonDocument(config, documentInput());
    assert.notEqual(
      client.calls.execute[0].commandId,
      client.calls.execute[1].commandId,
    );
  }
});

test("simultaneous identical saves share a command while completed saves do not reuse receipts", async () => {
  const client = harness();
  await Promise.all([
    client.saveLessonDocument(config, documentInput()),
    client.saveLessonDocument(config, documentInput()),
  ]);
  assert.equal(client.calls.execute.length, 1);
  await client.saveLessonDocument(config, documentInput());
  assert.equal(client.calls.execute.length, 2);
  assert.notEqual(
    client.calls.execute[0].commandId,
    client.calls.execute[1].commandId,
  );
});

const uploadInput = (overrides = {}) => ({
  unitId: "lesson-unit",
  expectedRevision: 7,
  kind: "PDF",
  file: new Blob(["%PDF-test"], { type: "application/pdf" }),
  originalName: "lesson.pdf",
  ...overrides,
});

test("asset upload prepares verified bytes and uses the callable transport", async () => {
  const client = harness();
  const asset = await client.uploadLessonAsset(config, uploadInput());
  const prepare = client.calls.execute[0];
  assert.equal(prepare.commandType, "prepareLessonAssetUpload");
  assert.deepEqual(prepare.payload, {
    ...commandScope,
    unitId: "lesson-unit",
    expectedRevision: 7,
    kind: "PDF",
    contentType: "application/pdf",
    byteSize: 9,
    sha256: createHash("sha256").update("%PDF-test").digest("hex"),
    originalName: "lesson.pdf",
  });
  assert.equal(
    Buffer.from(client.calls.upload[0].contentBase64, "base64").toString(),
    "%PDF-test",
  );
  assert.equal(client.calls.upload[0].uploadId, asset.uploadId);
  assert.equal(asset.url, "https://example.test/verified.pdf");
  assert.equal(asset.pdfProcessing.extractionStatus, "ready");
  assert.equal(client.calls.listeners.length, 0);
  assert.equal(client.calls.appCheck.length, 1);
  assert.equal(
    client.calls.appCheck[0].provider.siteKey,
    "test-public-site-key",
  );
  assert.equal(client.calls.appCheck[0].isTokenAutoRefreshEnabled, true);
  assert.equal(client.calls.appCheckTokens, 1);
});

test("missing App Check configuration or rejected attestation blocks asset preparation", async () => {
  for (const options of [
    { env: { VITE_FIREBASE_APPCHECK_SITE_KEY: "" } },
    { appCheckError: failure("appCheck/recaptcha-error") },
  ]) {
    const client = harness(options);
    await assert.rejects(client.uploadLessonAsset(config, uploadInput()));
    assert.equal(client.calls.execute.length, 0);
    assert.equal(client.calls.upload.length, 0);
  }
});

test("verified asset reuse is scoped to content revision and expires with the ticket", async () => {
  const client = harness();
  const first = await client.uploadLessonAsset(config, uploadInput());
  const second = await client.uploadLessonAsset(config, uploadInput());
  assert.equal(first.uploadId, second.uploadId);
  assert.equal(client.calls.upload.length, 1);
  await client.uploadLessonAsset(config, uploadInput({ expectedRevision: 8 }));
  assert.equal(client.calls.upload.length, 2);
  client.advance(3600001);
  await client.uploadLessonAsset(config, uploadInput());
  assert.equal(client.calls.upload.length, 3);
});

test("already verified tickets skip binary transport and parallel uploads share work", async () => {
  const client = harness({ ticketStatus: "VERIFIED" });
  const [first, second] = await Promise.all([
    client.uploadLessonAsset(config, uploadInput()),
    client.uploadLessonAsset(config, uploadInput()),
  ]);
  assert.equal(first.uploadId, second.uploadId);
  assert.equal(client.calls.execute.length, 1);
  assert.equal(client.calls.upload.length, 0);
});

test("a lost upload acknowledgement recovers verified server data", async () => {
  const client = harness({
    upload: (input, verified, _auth, tickets) => {
      tickets.set(input.uploadId, verified);
      throw failure("functions/unavailable");
    },
  });
  const asset = await client.uploadLessonAsset(config, uploadInput());
  assert.equal(asset.url, "https://example.test/verified.pdf");
  assert.equal(client.calls.upload.length, 1);
  assert.equal(client.calls.listeners.length, 0);
});

test("unverified uploads cannot be attached and pending verification cleans up listeners", async () => {
  const rejected = harness({
    upload: () => {
      throw failure("functions/unauthenticated");
    },
  });
  await assert.rejects(rejected.uploadLessonAsset(config, uploadInput()), {
    code: "functions/unauthenticated",
  });
  const delayed = harness({ upload: () => ({ data: {} }) });
  const asset = await delayed.uploadLessonAsset(config, uploadInput());
  assert.equal(asset.url, "https://example.test/observed.pdf");
  assert.equal(delayed.calls.listeners.length, 1);
  assert.equal(delayed.calls.listeners[0].stopped, true);
});

test("identity changes during upload are rejected before returning an attachable asset", async () => {
  const client = harness({
    upload: (_input, verified, auth) => {
      auth.currentUser = { ...auth.currentUser, uid: "different-user" };
      return { data: { verifiedAsset: verified } };
    },
  });
  await assert.rejects(client.uploadLessonAsset(config, uploadInput()));
});
