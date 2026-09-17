import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const compile = (path) =>
  transformSync(readFileSync(path, "utf8"), {
    loader: "ts",
    format: "cjs",
  }).code;
const serviceSource = compile("src/lib/lessonManagement.ts");
const batchModule = { exports: {} };
runInNewContext(compile("src/lib/lessonAssetBatch.ts"), {
  module: batchModule,
  exports: batchModule.exports,
});
const { runLessonAssetBatch } = batchModule.exports;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const until = async (predicate) => {
  for (let count = 0; count < 100 && !predicate(); count++) await flush();
  assert.ok(predicate(), "expected asynchronous state was reached");
};

// Unequal completion order must not rearrange document pages, and concurrency
// stays bounded for long PDFs. Errors drain current uploads before a retry.
const gates = Array.from({ length: 7 }, deferred);
let active = 0,
  maxActive = 0;
const started = [];
const batch = runLessonAssetBatch(
  gates.map((gate, index) => async () => {
    started.push(index);
    maxActive = Math.max(maxActive, ++active);
    await gate.promise;
    active--;
    return index;
  }),
);
assert.deepEqual(started, [0, 1, 2]);
for (const index of [2, 1, 0, 5, 4, 3, 6]) {
  gates[index].resolve();
  await flush();
}
assert.deepEqual(Array.from(await batch), [0, 1, 2, 3, 4, 5, 6]);
assert.equal(maxActive, 3);
assert.equal((await runLessonAssetBatch([])).length, 0);
const failedGates = Array.from({ length: 5 }, deferred);
const failedStarted = [];
let failedSettled = false;
const expectedFailure = new Error("upload denied");
const failed = runLessonAssetBatch(
  failedGates.map((gate, index) => async () => {
    failedStarted.push(index);
    return gate.promise;
  }),
);
const rejected = assert
  .rejects(failed, (error) => error === expectedFailure)
  .then(() => {
    failedSettled = true;
  });
failedGates[0].reject(expectedFailure);
await flush();
assert.deepEqual(failedStarted, [0, 1, 2]);
assert.equal(failedSettled, false);
failedGates[1].resolve(1);
failedGates[2].resolve(2);
await rejected;
assert.deepEqual(failedStarted, [0, 1, 2]);

const setup = ({
  inline = false,
  initialStatus = "PENDING",
  loseAck = false,
} = {}) => {
  const auth = { currentUser: { uid: "teacher-a" } };
  const tickets = new Map(),
    watchers = new Set(),
    authWatchers = new Set(),
    timers = new Set();
  const calls = { scope: 0, prepare: 0, ticketRead: 0, upload: 0, save: 0 };
  let sequence = 0,
    fileReads = 0;
  const snap = (data, metadata = {}) => ({
    exists: () => !!data,
    data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
  });
  const module = { exports: {} };
  runInNewContext(serviceSource, {
    module,
    exports: module.exports,
    crypto: webcrypto,
    Uint8Array,
    Blob,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    structuredClone,
    setTimeout: (callback) => {
      timers.add(callback);
      return callback;
    },
    clearTimeout: (callback) => timers.delete(callback),
    require: (name) => {
      if (name === "firebase/firestore")
        return {
          doc: (_db, ...parts) => ({ path: parts.join("/") }),
          getDoc: async () => {
            calls.scope++;
            return snap({ semesterId: "2026-2", revision: 8 });
          },
          getDocFromServer: async (ref) => {
            calls.ticketRead++;
            return snap(tickets.get(ref.path));
          },
          onSnapshot: (ref, _options, next, error) => {
            const watcher = { ref, next, error };
            watchers.add(watcher);
            queueMicrotask(() => {
              if (watchers.has(watcher)) next(snap(tickets.get(ref.path)));
            });
            return () => watchers.delete(watcher);
          },
        };
      if (name === "firebase/auth")
        return {
          onAuthStateChanged: (_auth, callback) => {
            authWatchers.add(callback);
            return () => authWatchers.delete(callback);
          },
        };
      if (name === "./firebase")
        return {
          auth,
          db: {},
          getHttpsCallable:
            async (_name, options) =>
            async ({ uploadId, contentBase64 }) => {
              calls.upload++;
              assert.equal(options.expectedUid, "teacher-a");
              assert.equal(
                Buffer.from(contentBase64, "base64").toString(),
                "pdf bytes",
              );
              const key = "lesson_asset_uploads/" + uploadId;
              const ticket = tickets.get(key);
              const verifiedAsset = { ...ticket, status: "VERIFIED" };
              if (loseAck) {
                tickets.set(key, verifiedAsset);
                throw new Error("lost acknowledgement");
              }
              if (inline) tickets.set(key, verifiedAsset);
              return {
                data: { accepted: true, ...(inline ? { verifiedAsset } : {}) },
              };
            },
        };
      if (name === "./semesterScope")
        return {
          getSemesterCollectionPath: () => "years/2026/semesters/2/lessons",
        };
      if (name === "./lessonWriteRecovery")
        return {
          lessonWriteRecovery: {
            run: (_key, record, execute) => execute(record),
          },
        };
      if (name === "./commandGateway")
        return {
          executeWestoryCommand: async (type, input, options) => {
            assert.equal(options.expectedUid, "teacher-a");
            assert.equal(input.expectedSemesterRevision, 8);
            if (type === "saveLessonDocument") {
              calls.save++;
              return { result: { contentRevision: 2 } };
            }
            calls.prepare++;
            const uploadId = "asset-" + ++sequence;
            const storagePath = `lesson_uploads/${uploadId}/source`;
            tickets.set("lesson_asset_uploads/" + uploadId, {
              kind: input.kind,
              status: initialStatus,
              storagePath,
              url: "https://fixture/" + uploadId,
            });
            return { result: { uploadId, storagePath } };
          },
        };
      return {};
    },
  });
  const file = new Blob(["pdf bytes"], { type: "application/pdf" });
  const read = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => {
    fileReads++;
    return read();
  };
  const upload = () =>
    module.exports.uploadLessonAsset(
      { year: "2026", semester: "2" },
      {
        unitId: "unit",
        expectedRevision: 1,
        kind: "PDF",
        file,
      },
    );
  return {
    service: module.exports,
    auth,
    upload,
    calls,
    watchers,
    authWatchers,
    timers,
    file,
    fileReads: () => fileReads,
    emit: (status, metadata = {}) => {
      for (const watcher of [...watchers])
        watcher.next(
          snap(
            {
              ...tickets.get(watcher.ref.path),
              status,
            },
            metadata,
          ),
        );
    },
  };
};

const direct = setup({ inline: true });
assert.equal((await direct.upload()).url, "https://fixture/asset-1");
assert.equal(direct.fileReads(), 1, "hash and upload share one Blob read");
assert.equal(
  direct.calls.ticketRead,
  1,
  "inline verification needs no follow-up read",
);
assert.equal(direct.watchers.size, 0);

const fallback = setup();
let completed = false;
const pending = fallback.upload().then((result) => {
  completed = true;
  return result;
});
await until(() => fallback.watchers.size === 1);
fallback.emit("VERIFIED", { fromCache: true });
fallback.emit("VERIFIED", { hasPendingWrites: true });
await flush();
assert.equal(
  completed,
  false,
  "cache and pending local writes never verify an asset",
);
fallback.emit("VERIFIED");
assert.equal((await pending).url, "https://fixture/asset-1");
assert.equal(
  fallback.calls.ticketRead,
  1,
  "legacy transport watches instead of polling",
);
assert.equal(
  fallback.watchers.size + fallback.authWatchers.size + fallback.timers.size,
  0,
);

for (const mode of [
  "FAILED",
  "ATTACHED",
  "owner-change",
  "timeout",
  "permission-error",
]) {
  const fixture = setup();
  const promise = fixture.upload();
  const failure = assert.rejects(promise);
  await until(() => fixture.watchers.size === 1);
  if (mode === "owner-change") {
    fixture.auth.currentUser = { uid: "teacher-b" };
    for (const callback of [...fixture.authWatchers])
      callback(fixture.auth.currentUser);
  } else if (mode === "timeout") {
    for (const callback of [...fixture.timers]) callback();
  } else if (mode === "permission-error") {
    for (const watcher of [...fixture.watchers])
      watcher.error(new Error("permission denied"));
  } else fixture.emit(mode);
  await failure;
  assert.equal(
    fixture.watchers.size + fixture.authWatchers.size + fixture.timers.size,
    0,
    mode,
  );
}
const replay = setup({ initialStatus: "VERIFIED" });
await replay.upload();
assert.equal(
  replay.calls.upload,
  0,
  "verified replay does not retransmit bytes",
);
const lost = setup({ loseAck: true });
await lost.upload();
assert.equal(lost.calls.ticketRead, 2);
assert.equal(
  lost.watchers.size,
  0,
  "verified lost acknowledgement recovers immediately",
);

const save = setup({ inline: true });
const config = { year: "2026", semester: "2" };
const result = await save.service.saveLessonDocument(
  config,
  {
    unitId: "unit",
    expectedRevision: 1,
    document: {},
    assetUploadIds: [],
  },
  {
    localDraft: {},
    prepare: async (ownerUid, commandScope) => {
      const assets = await runLessonAssetBatch(
        Array.from(
          { length: 4 },
          () => () =>
            save.service.uploadLessonAsset(config, {
              unitId: "unit",
              expectedRevision: 1,
              expectedUid: ownerUid,
              commandScope,
              kind: "PAGE",
              file: save.file,
            }),
        ),
      );
      return {
        document: {
          worksheetPageImages: assets.map((asset, index) => ({
            page: index + 1,
            imageUrl: asset.url,
          })),
        },
        assetUploadIds: assets.map((asset) => asset.uploadId),
      };
    },
  },
);
assert.equal(result.contentRevision, 2);
assert.equal(
  save.calls.scope,
  1,
  "all uploads and the final commit share the save scope",
);
assert.equal(save.calls.prepare, 4);
assert.equal(
  save.calls.ticketRead,
  8,
  "owner tickets and final retained assets are still checked",
);
assert.equal(save.calls.upload, 4);
assert.equal(save.calls.save, 1);
const syntheticUploads = Array.from(
  { length: 6 },
  () => () => new Promise((resolve) => setTimeout(resolve, 50)),
);
const sequentialStarted = performance.now();
for (const upload of syntheticUploads) await upload();
const sequentialMs = Math.round(performance.now() - sequentialStarted);
const concurrentStarted = performance.now();
await runLessonAssetBatch(syntheticUploads);
const concurrentMs = Math.round(performance.now() - concurrentStarted);
console.log(
  JSON.stringify({
    suite: "lesson-upload-performance",
    passed: true,
    checks: [
      "bounded concurrency",
      "ordered pages",
      "failure drains started uploads",
      "single Blob read",
      "inline verification",
      "server snapshot fallback",
      "cached verification ignored",
      "failure/auth/timeout cleanup",
      "verified replay",
      "lost acknowledgement",
      "one scope per save",
    ],
    fourAssetSaveRequests: Object.values(save.calls).reduce(
      (total, count) => total + count,
      0,
    ),
    syntheticSixUploads: { delayPerUploadMs: 50, sequentialMs, concurrentMs },
    productionNetworkAccess: 0,
  }),
);
