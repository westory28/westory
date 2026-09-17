const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createUploadHandler } = require("../lessonAssetTransport");
const { Store } = require("./verify-lesson-answers.cjs");
const bytes = Buffer.from("%PDF-1.7\nfixture");
const ticketPath = "lesson_asset_uploads/upload-one";
let checks = 0;
const setup = (change = () => {}, options = {}) => {
  const content = options.bytes || bytes;
  const state = {
    [ticketPath]: {
      uploadId: "upload-one",
      ownerUid: "teacher",
      originalName: "fixture.pdf",
      downloadToken: "fixture-token",
      storagePath: "lesson_uploads/upload-one/source",
      expiresAtMs: 2000,
      status: "PENDING",
      semesterId: "2026-2",
      expectedSemesterRevision: 1,
      byteSize: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      kind: "PDF",
      contentType: "application/pdf",
    },
    "users/teacher": { role: "teacher" },
    "site_settings/semester_active": { semesterId: "2026-2", revision: 1 },
    "semester_manifests/2026-2": { status: "ACTIVE", revision: 1 },
  };
  change(state);
  const store = new Store(state);
  let writes = 0;
  let downloads = 0;
  let metadataReads = 0;
  let metadataWrites = 0;
  const snap = (value) => ({ exists: value.exists, data: () => value.data });
  const db = {
    doc: (path) => ({ path, get: async () => snap(await store.get(path)) }),
    getAll: async (...refs) =>
      Promise.all(refs.map(async (ref) => snap(await store.get(ref.path)))),
    runTransaction: (callback) =>
      store.runTransaction((tx) =>
        callback({
          get: async (ref) => snap(await tx.get(ref.path)),
          set: (ref, value, config) => tx.set(ref.path, value, config),
        }),
      ),
  };
  const handler = createUploadHandler({
    db,
    now: () => 1000,
    assertSession: async (_, sessionOptions) => {
      assert.equal(sessionOptions.highRisk, false);
      assert.equal(sessionOptions.recentAuth, false);
      if (options.sessionError)
        throw Object.assign(Error("session"), { code: "unauthenticated" });
      return { uid: "teacher" };
    },
    bucket: {
      name: "fixture-bucket",
      file: (path, config) => {
        assert.equal(path, "lesson_uploads/upload-one/source");
        if (config) assert.equal(config.generation, "10");
        const object = {
          generation: "10",
          size: content.length,
          contentType: state[ticketPath]?.contentType,
          metadata: { ownerUid: "teacher", uploadId: "upload-one" },
          ...options.storedMetadata,
        };
        const file = {
          save: async (data, saveOptions) => {
            assert.deepEqual(data, content);
            assert.equal(saveOptions.preconditionOpts.ifGenerationMatch, 0);
            assert.equal(saveOptions.metadata.metadata.ownerUid, "teacher");
            assert.equal(
              saveOptions.metadata.metadata.firebaseStorageDownloadTokens,
              "fixture-token",
            );
            writes++;
            if (options.afterSave)
              options.afterSave(store.docs.get(ticketPath));
            if (options.storageError)
              throw Object.assign(Error("storage"), {
                code: options.storageError,
              });
            object.metadata = saveOptions.metadata.metadata;
            if (!options.omitSaveMetadata) file.metadata = object;
          },
          getMetadata: async () => {
            metadataReads++;
            return [object];
          },
          download: async () => {
            downloads++;
            return [options.storedBytes || content];
          },
          setMetadata: async () => {
            metadataWrites++;
          },
        };
        return file;
      },
    },
  });
  return {
    handler,
    store,
    writes: () => writes,
    downloads: () => downloads,
    metadataReads: () => metadataReads,
    metadataWrites: () => metadataWrites,
    request: {
      auth: { token: { email: "teacher@example.test" } },
      data: {
        uploadId: "upload-one",
        contentBase64: content.toString("base64"),
      },
    },
  };
};
(async () => {
  for (const [label, change, code] of [
    [
      "missing",
      (s) => delete s["lesson_asset_uploads/upload-one"],
      "permission-denied",
    ],
    [
      "owner",
      (s) => (s["lesson_asset_uploads/upload-one"].ownerUid = "other"),
      "permission-denied",
    ],
    [
      "student",
      (s) => (s["users/teacher"].role = "student"),
      "permission-denied",
    ],
    [
      "expiry",
      (s) => (s["lesson_asset_uploads/upload-one"].expiresAtMs = 999),
      "permission-denied",
    ],
    [
      "missing expiry",
      (s) => delete s["lesson_asset_uploads/upload-one"].expiresAtMs,
      "permission-denied",
    ],
    [
      "path",
      (s) => (s["lesson_asset_uploads/upload-one"].storagePath = "other"),
      "permission-denied",
    ],
    [
      "failed",
      (s) => (s["lesson_asset_uploads/upload-one"].status = "FAILED"),
      "permission-denied",
    ],
    [
      "semester",
      (s) => (s["site_settings/semester_active"].semesterId = "2026-1"),
      "failed-precondition",
    ],
    [
      "revision",
      (s) => (s["semester_manifests/2026-2"].revision = 2),
      "failed-precondition",
    ],
    [
      "archive",
      (s) => (s["semester_manifests/2026-2"].status = "ARCHIVED"),
      "failed-precondition",
    ],
    [
      "hash",
      (s) => (s["lesson_asset_uploads/upload-one"].sha256 = "wrong"),
      "invalid-argument",
    ],
    [
      "size",
      (s) => (s["lesson_asset_uploads/upload-one"].byteSize = 10),
      "invalid-argument",
    ],
  ]) {
    const test = setup(change);
    await assert.rejects(test.handler(test.request), { code }, label);
    assert.equal(test.writes(), 0);
    checks++;
  }
  const session = setup(() => {}, { sessionError: true });
  await assert.rejects(session.handler(session.request), {
    code: "unauthenticated",
  });
  assert.equal(session.writes(), 0);
  checks++;
  for (const contentBase64 of ["", "====", "bad", "?AAA"]) {
    const test = setup();
    test.request.data.contentBase64 = contentBase64;
    await assert.rejects(test.handler(test.request), {
      code: "invalid-argument",
    });
    assert.equal(test.writes(), 0);
    checks++;
  }
  for (const status of ["PENDING", "VERIFIED", "ATTACHED"]) {
    const test = setup((s) => {
      s[ticketPath].status = status;
      if (status !== "PENDING")
        s[ticketPath].url = "https://fixture.test/existing";
    });
    const result = await test.handler(test.request);
    assert.equal(result.accepted, true);
    assert.equal(result.replayed, status !== "PENDING");
    assert.equal(test.writes(), status === "PENDING" ? 1 : 0);
    assert.equal(
      result.verifiedAsset.status,
      status === "PENDING" ? "VERIFIED" : status,
    );
    assert.equal(
      result.verifiedAsset.storagePath,
      "lesson_uploads/upload-one/source",
    );
    if (status === "PENDING") {
      assert.equal(test.store.docs.get(ticketPath).generation, "10");
      assert.equal(
        result.verifiedAsset.pdfProcessing.extractionStatus,
        "processing",
      );
    }
    assert.equal(
      test.downloads(),
      0,
      "new upload does not wait for a Storage download/worker",
    );
    assert.equal(
      test.metadataReads(),
      0,
      "new upload reuses Storage save metadata",
    );
    checks++;
  }
  const replay = setup(() => {}, { storageError: 412 });
  const replayed = await replay.handler(replay.request);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.verifiedAsset.status, "VERIFIED");
  assert.equal(replay.downloads(), 1);
  assert.equal(
    replay.metadataWrites(),
    1,
    "legacy retries receive the verified download token",
  );
  checks++;
  const failed = setup(() => {}, { storageError: 503 });
  await assert.rejects(failed.handler(failed.request), { code: 503 });
  checks++;
  const malformed = setup(() => {}, { bytes: Buffer.from("fake PDF payload") });
  await assert.rejects(malformed.handler(malformed.request), {
    code: "invalid-argument",
  });
  assert.equal(
    malformed.writes(),
    0,
    "invalid PDF is rejected before publication",
  );
  checks++;
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2cYkAAAAASUVORK5CYII=",
    "base64",
  );
  for (const contentType of ["image/png", "image/jpeg"]) {
    const test = setup(
      (s) => Object.assign(s[ticketPath], { kind: "PAGE", contentType }),
      { bytes: imageBytes },
    );
    if (contentType === "image/png") {
      const result = await test.handler(test.request);
      assert.equal(result.verifiedAsset.status, "VERIFIED");
      assert.equal(result.verifiedAsset.pdfProcessing, undefined);
    } else {
      await assert.rejects(test.handler(test.request), {
        code: "invalid-argument",
      });
      assert.equal(test.writes(), 0, "image MIME must match its decoded bytes");
    }
    checks++;
  }
  const badReplay = setup(() => {}, {
    storageError: 412,
    storedBytes: Buffer.from("corrupt"),
  });
  await assert.rejects(badReplay.handler(badReplay.request), /일치하지/);
  assert.equal(badReplay.store.docs.get(ticketPath).status, "PENDING");
  assert.equal(badReplay.metadataWrites(), 0);
  checks++;
  for (const storedMetadata of [
    { metadata: { ownerUid: "other" } },
    { size: 1 },
    { generation: "" },
  ]) {
    const test = setup(() => {}, { storageError: 412, storedMetadata });
    await assert.rejects(test.handler(test.request), {
      code: "failed-precondition",
    });
    assert.equal(test.store.docs.get(ticketPath).status, "PENDING");
    checks++;
  }
  const fallback = setup(() => {}, { omitSaveMetadata: true });
  assert.equal(
    (await fallback.handler(fallback.request)).verifiedAsset.status,
    "VERIFIED",
  );
  assert.equal(fallback.metadataReads(), 1);
  assert.equal(
    fallback.downloads(),
    1,
    "metadata fallback verifies the actual stored generation",
  );
  checks++;
  for (const change of [
    (t) => {
      t.status = "FAILED";
    },
    (t) => {
      t.generation = "9";
    },
    (t) => {
      t.ownerUid = "other";
    },
    (t) => {
      t.expiresAtMs = 999;
    },
    (t) => {
      t.downloadToken = "changed-token";
    },
    (t) => {
      t.expectedSemesterRevision = 2;
    },
  ]) {
    const test = setup(() => {}, { afterSave: change });
    await assert.rejects(test.handler(test.request), {
      code: "failed-precondition",
    });
    assert.notEqual(test.store.docs.get(ticketPath).status, "VERIFIED");
    checks++;
  }
  for (const status of ["VERIFIED", "ATTACHED"]) {
    const test = setup(() => {}, {
      afterSave: (t) =>
        Object.assign(t, {
          status,
          generation: "10",
          extractionLeaseUntil: 9000,
          extractionAttempt: "worker-one",
          pdfProcessing: { extractionStatus: "ready", pageCount: 3 },
        }),
    });
    const result = await test.handler(test.request);
    assert.equal(result.verifiedAsset.status, status);
    assert.equal(result.verifiedAsset.pdfProcessing.extractionStatus, "ready");
    assert.equal(
      test.store.docs.get(ticketPath).extractionAttempt,
      "worker-one",
    );
    assert.equal(test.store.docs.get(ticketPath).extractionLeaseUntil, 9000);
    checks++;
  }
  console.log(
    JSON.stringify({
      suite: "lesson-transport",
      passed: true,
      checks,
      isolated: true,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
