const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const { runInNewContext } = require("node:vm");
const { Store } = require("./verify-lesson-answers.cjs");

// Execute the registered Storage callback with an isolated transaction store.
// No Admin SDK connection, Storage request, or PDF parser process is started.
const path = "lesson_asset_uploads/upload-one";
const lessonPath = "years/2026/semesters/2/lessons/unit-one";
const source = "lesson_uploads/upload-one/source";
const buffer = Buffer.from("%PDF-1.7\nfixture");
const setup = (change = () => {}, options = {}) => {
  const ticket = {
    uploadId: "upload-one",
    ownerUid: "teacher",
    semesterId: "2026-2",
    unitId: "unit-one",
    lessonPath,
    storagePath: source,
    status: "PENDING",
    kind: "PDF",
    contentType: "application/pdf",
    byteSize: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    expiresAtMs: Date.now() + 60000,
    downloadToken: "fixture-token",
  };
  change(ticket);
  const store = new Store({
    [path]: ticket,
    [lessonPath]: {
      pdfStoragePath: source,
      contentRevision: 8,
      worksheetBlanks: [{ id: "keep" }],
    },
  });
  const metrics = { downloads: 0, metadata: 0, parses: 0 };
  const snap = (value) => ({ exists: value.exists, data: () => value.data });
  const db = {
    doc: (key) => ({ path: key, get: async () => snap(await store.get(key)) }),
    runTransaction: (callback) =>
      store.runTransaction((tx) =>
        callback({
          get: async (ref) => snap(await tx.get(ref.path)),
          set: (ref, value, config) => tx.set(ref.path, value, config),
        }),
      ),
  };
  const bucket = {
    name: "demo-fixture-bucket",
    file: (key, config) => {
      assert.equal(key, source);
      assert.equal(config.generation, "10");
      return {
        download: async () => {
          metrics.downloads++;
          return [buffer];
        },
        setMetadata: async () => {
          metrics.metadata++;
        },
      };
    },
  };
  let handler;
  const dependencies = {
    "node:crypto": require("node:crypto"),
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => 123 },
    },
    "firebase-admin/storage": { getStorage: () => ({ bucket: () => bucket }) },
    "firebase-functions/params": { storageBucket: "demo-fixture-bucket" },
    "firebase-functions/v2/storage": {
      onObjectFinalized: (_, callback) => {
        handler = callback;
        return callback;
      },
    },
    sharp: () => ({
      metadata: async () => ({
        format: options.imageFormat || "png",
        width: 2,
        height: 2,
      }),
    }),
    "./lessonManagement": { ASSET_COLLECTION: "lesson_asset_uploads" },
    "./sourceArchiveProcessor": {
      buildPdfRevisionPathsForBasePath: () => ({
        extractedContentPath: "isolated/content",
        extractedManifestPath: "isolated/manifest",
      }),
    },
    "./sourceArchivePdfAdapter": {
      savePdfStructureArtifacts: async () => {
        metrics.parses++;
        if (options.parseError) throw Error("parser failure");
        return { previewText: "parsed", pageCount: 2 };
      },
    },
  };
  runInNewContext(
    readFileSync(resolve(__dirname, "../lessonAssetUploads.js"), "utf8"),
    {
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
      exports: {},
      Buffer,
      Date,
    },
  );
  const event = {
    data: {
      name: source,
      bucket: bucket.name,
      generation: "10",
      size: buffer.length,
      contentType: ticket.contentType,
    },
  };
  return { store, metrics, run: (value = event) => handler(value), event };
};

(async () => {
  let checks = 0;
  const ok = setup();
  await ok.run();
  assert.equal(ok.store.docs.get(path).status, "VERIFIED");
  assert.equal(ok.store.docs.get(path).pdfProcessing.extractionStatus, "ready");
  await ok.run();
  assert.equal(ok.metrics.parses, 1);
  checks += 3;
  const attached = setup((t) => {
    t.status = "ATTACHED";
    t.generation = "10";
  });
  await attached.run();
  assert.equal(
    attached.store.docs.get(lessonPath).pdfProcessing.extractionStatus,
    "ready",
  );
  assert.equal(attached.store.docs.get(lessonPath).contentRevision, 8);
  assert.equal(
    attached.store.docs.get(lessonPath).worksheetBlanks[0].id,
    "keep",
  );
  checks += 3;
  const newer = setup((t) => {
    t.status = "ATTACHED";
    t.generation = "10";
  });
  newer.store.docs.get(lessonPath).pdfStoragePath = "newer/asset";
  await newer.run();
  assert.equal(newer.store.docs.get(lessonPath).pdfProcessing, undefined);
  checks++;
  for (const mutate of [
    (t) => {
      t.sha256 = "0".repeat(64);
    },
    (t) => {
      t.byteSize++;
    },
  ]) {
    const bad = setup(mutate);
    await bad.run();
    assert.equal(bad.store.docs.get(path).status, "FAILED");
    assert.equal(bad.metrics.metadata, 0);
    checks++;
  }
  for (const mutate of [
    (t) => {
      t.expiresAtMs = 1;
    },
    (t) => {
      t.generation = "9";
    },
    (t) => {
      t.status = "FAILED";
    },
  ]) {
    const ignored = setup(mutate);
    await ignored.run();
    assert.equal(ignored.metrics.downloads, 0);
    checks++;
  }
  const image = setup((t) => {
    t.kind = "FOOTNOTE";
    t.contentType = "image/png";
  });
  await image.run();
  assert.equal(image.store.docs.get(path).status, "VERIFIED");
  assert.equal(image.metrics.parses, 0);
  checks++;
  const badImage = setup(
    (t) => {
      t.kind = "PAGE";
      t.contentType = "image/png";
    },
    { imageFormat: "jpeg" },
  );
  await badImage.run();
  assert.equal(badImage.store.docs.get(path).status, "FAILED");
  checks++;
  const parseFailure = setup(() => {}, { parseError: true });
  await parseFailure.run();
  assert.equal(
    parseFailure.store.docs.get(path).pdfProcessing.extractionStatus,
    "failed",
  );
  await parseFailure.run();
  assert.equal(parseFailure.metrics.parses, 1);
  checks++;
  const busy = setup((t) => {
    t.status = "VERIFIED";
    t.generation = "10";
    t.extractionLeaseUntil = Date.now() + 60000;
  });
  await assert.rejects(busy.run(), /lease-busy/);
  assert.equal(busy.metrics.parses, 0);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      networkAccess: 0,
      coverage:
        "registered finalize callback, integrity, duplicate event, generation, lease, stale attach, parser failure; Storage and parser mocked",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
