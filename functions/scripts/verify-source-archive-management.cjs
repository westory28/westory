const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const archive = require("../sourceArchiveManagement");
const gateway = require("../commandGateway");
const { Store: BaseStore } = require("./verify-lesson-answers.cjs");

class Store extends BaseStore {
  runTransaction(callback) {
    return super.runTransaction((transaction) =>
      callback({
        ...transaction,
        queryGroup: async (group, filter) => {
          const paths = [...this.docs.keys()]
            .filter((path) => path.split("/").at(-2) === group)
            .slice(0, filter.limit);
          return Promise.all(paths.map((path) => transaction.get(path)));
        },
      }),
    );
  }
}
const stamp = { seconds: 1, nanoseconds: 0 };
const path = "source_archive/existing";
const metadata = {
  title: "검증 사료",
  description: "설명",
  era: "조선",
  subject: "",
  unit: "",
  type: "photo",
  tags: ["검증"],
  source: "출처",
};
const oldAsset = () => ({
  ...metadata,
  updatedAt: stamp,
  mediaKind: "image",
  processingStatus: "ready",
  status: "ready",
  currentRevision: "old",
  image: {
    originalPath: "source-archive/existing/old/original.jpg",
    displayPath: "source-archive/existing/old/display.webp",
  },
  file: { storagePath: "source-archive/existing/old/original.jpg" },
});
const base = { assetId: "existing", expectedUpdatedAt: "1:0" };
const bytes = Buffer.from("fixture-image");
const upload = {
  mediaKind: "image",
  contentType: "image/jpeg",
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  originalName: "fixture.jpg",
  originalMimeType: "image/jpeg",
  originalByteSize: bytes.length,
  originalWidth: 10,
  originalHeight: 10,
};
const request = (data) => ({
  auth: { uid: "teacher", token: { email: "teacher@yongshin-ms.ms.kr" } },
  data,
});
const assertSession = async (req) => ({
  uid: req.auth.uid,
  email: req.auth.token.email,
});
const setup = (seed = {}) => {
  const store = new Store({
    [path]: oldAsset(),
    "users/teacher": { role: "teacher" },
    ...seed,
  });
  const core = gateway.createCommandGatewayCore({
    store,
    projectId: "demo-source-archive",
    serverTimestamp: () => ({ seconds: 2, nanoseconds: 0 }),
    concreteTimestamp: () => 2000,
    assertSession,
    authorizeCommand: async ({ request: req }) => ({
      actorUid: req.auth.uid,
      actorEmail: req.auth.token.email,
      actorRole: req.auth.uid === "teacher" ? "teacher" : "student",
    }),
    commandAdapters: Object.fromEntries(
      Object.values(archive.SOURCE_ARCHIVE_COMMAND_TYPES).map((type) => [
        type,
        archive.createSourceArchiveCommandAdapter({ now: () => 1000 }),
      ]),
    ),
  });
  const execute = (
    type,
    payload,
    commandId = randomUUID(),
    uid = "teacher",
  ) => {
    const req = request({ commandId, commandType: type, payload });
    req.auth.uid = uid;
    return core.execute(req);
  };
  return { store, execute };
};
const nativeDb = (store) => {
  const snap = (path, data) => ({
    exists: !!data,
    data: () => structuredClone(data),
    ref: doc(path),
  });
  const doc = (path) => ({
    path,
    get: async () => snap(path, store.docs.get(path)),
    set: async (data, options) => {
      const next = options?.merge
        ? { ...store.docs.get(path), ...data }
        : { ...data };
      for (const [name, value] of Object.entries(next))
        if (
          value?.isEqual?.(
            require("firebase-admin/firestore").FieldValue.delete(),
          )
        )
          delete next[name];
      store.docs.set(path, next);
    },
  });
  return {
    doc,
    collection: (path) => ({
      where: (field, _operator, value) => ({
        limit: (limit) => ({
          get: async () => ({
            docs: [...store.docs]
              .filter(
                ([key, data]) =>
                  key.startsWith(`${path}/`) && data[field] <= value,
              )
              .slice(0, limit)
              .map(([key, data]) => snap(key, data)),
          }),
        }),
      }),
    }),
    runTransaction: (fn) =>
      store.runTransaction((tx) =>
        fn({
          get: async (ref) => {
            const value = await tx.get(ref.path);
            return snap(ref.path, value.data);
          },
          getAll: async (...refs) =>
            Promise.all(
              refs.map(async (ref) => {
                const value = await tx.get(ref.path);
                return snap(ref.path, value.data);
              }),
            ),
          set: (ref, data, options) => tx.set(ref.path, data, options),
        }),
      ),
  };
};
const fakeBucket = () => {
  const objects = new Map();
  let failDelete = "";
  const bucket = {
    name: "fixture-bucket",
    objects,
    failDelete: (path) => {
      failDelete = path;
    },
    file: (name) => ({
      name,
      save: async (data, options) => {
        if (
          options?.preconditionOpts?.ifGenerationMatch === 0 &&
          objects.has(name)
        )
          throw { code: 412 };
        objects.set(name, {
          data,
          metadata: { ...options?.metadata, size: data.length },
        });
      },
      getMetadata: async () => [objects.get(name)?.metadata],
      download: async () => {
        if (!objects.has(name)) throw new Error("missing fixture object");
        return [objects.get(name).data];
      },
      delete: async () => {
        if (failDelete === name) {
          failDelete = "";
          throw new Error("fixture storage outage");
        }
        objects.delete(name);
      },
    }),
    getFiles: async ({ prefix, maxResults }) => [
      [...objects.keys()]
        .filter((name) => name.startsWith(prefix))
        .slice(0, maxResults || Infinity)
        .map((name) => bucket.file(name)),
    ],
  };
  return bucket;
};
let checks = 0;
const rejected = async (reason, type, payload, seed, uid) => {
  const { store, execute } = setup(seed),
    before = structuredClone([...store.docs]);
  await assert.rejects(
    execute(type, payload, randomUUID(), uid),
    (error) => error.details?.reason === reason,
  );
  assert.deepEqual([...store.docs], before);
  checks++;
};

const loadProcessor = (db, bucket, onRender = () => {}, failPdf = false) => {
  const exports = {};
  const processor = {
    SOURCE_ARCHIVE_MEDIA_KIND: "image",
    SOURCE_ARCHIVE_PDF_MEDIA_KIND: "pdf",
    SOURCE_ARCHIVE_SCHEMA_VERSION: 3,
    normalizeText: (value) => String(value || "").trim(),
    normalizePreviewText: (value) => String(value || ""),
    mergeSearchText: (a, b) => `${a || ""} ${b || ""}`,
    buildRevisionPaths: ({ assetId, revision }) => ({
      revision,
      basePath: `source-archive/${assetId}/${revision}`,
      originalPath: `source-archive/${assetId}/${revision}/original.jpg`,
      displayPath: `source-archive/${assetId}/${revision}/display.webp`,
      thumbPath: `source-archive/${assetId}/${revision}/thumb.webp`,
    }),
    saveOriginalSourceArchiveFile: async ({ originalPath, inputBuffer }) => {
      await bucket.file(originalPath).save(inputBuffer);
      return { mimeType: "image/jpeg", byteSize: inputBuffer.length };
    },
    renderSourceArchiveVariants: async () => {
      await onRender();
      const variant = {
        data: bytes,
        info: { width: 10, height: 10, size: bytes.length },
      };
      return {
        originalWidth: 10,
        originalHeight: 10,
        displayResult: variant,
        thumbResult: variant,
      };
    },
    buildSourceArchiveSearchState: async () => ({
      status: "metadata-only",
      previewText: "",
    }),
  };
  const mocks = {
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: {
        serverTimestamp: () => ({ seconds: 3, nanoseconds: 0 }),
        delete: () => require("firebase-admin/firestore").FieldValue.delete(),
      },
    },
    "firebase-admin/storage": { getStorage: () => ({ bucket: () => bucket }) },
    "firebase-functions/params": { storageBucket: "fixture-bucket" },
    "firebase-functions/v2/storage": {
      onObjectFinalized: (_options, handler) => handler,
    },
    "./studentMaintenance": {
      onCallWithStudentMaintenance: (_options, handler) => handler,
    },
    "./sourceArchiveProcessor": processor,
    "./sourceArchivePdfAdapter": {
      saveSourceArchivePdfArtifacts: async ({ revisionPaths }) => {
        await bucket
          .file(`${revisionPaths.basePath}/extracted/partial.json`)
          .save(bytes);
        if (failPdf) throw new Error("fixture partial PDF artifact failure");
        throw new Error("PDF fixture must explicitly request failure");
      },
    },
    "./lessonPdfBeta": {},
    "./sessionAuthority": { assertActiveApplicationSession: assertSession },
  };
  processor.buildPdfRevisionPaths = ({ assetId, revision }) => ({
    revision,
    basePath: `source-archive/${assetId}/${revision}`,
    originalPath: `source-archive/${assetId}/${revision}/original.pdf`,
  });
  vm.runInNewContext(
    readFileSync(require.resolve("../sourceArchiveBeta"), "utf8"),
    {
      exports,
      require: (name) => mocks[name] || require(name),
      Buffer,
      console: { error: () => {} },
      Date,
      Set,
      Promise,
    },
  );
  return exports;
};

(async () => {
  const { store, execute } = setup();
  const createId = randomUUID();
  const prepared = await execute(
    "prepareSourceArchiveUpload",
    { assetId: "", expectedUpdatedAt: "", metadata, upload },
    createId,
  );
  assert.equal(prepared.result.assetId, `asset-${createId}`);
  assert.equal(
    (
      await execute(
        "prepareSourceArchiveUpload",
        { assetId: "", expectedUpdatedAt: "", metadata, upload },
        createId,
      )
    ).replayed,
    true,
  );
  assert.equal(
    [...store.docs.keys()].filter((key) => key.startsWith("source_archive/"))
      .length,
    2,
  );
  checks += 3;
  await rejected(
    "SOURCE_ARCHIVE_MANAGER_REQUIRED",
    "saveSourceArchiveMetadata",
    { ...base, metadata },
    undefined,
    "student",
  );
  await rejected(
    "SOURCE_ARCHIVE_CONTENT_CONFLICT",
    "saveSourceArchiveMetadata",
    { ...base, expectedUpdatedAt: "0:0", metadata },
  );
  await rejected(
    "SOURCE_ARCHIVE_PAYLOAD_INVALID",
    "saveSourceArchiveMetadata",
    { ...base, metadata: { ...metadata, file: { storagePath: "victim" } } },
  );
  for (const lessonPath of [
    "lessons/old",
    "years/2026/semesters/2/lessons/current",
    "years/2025/semesters/1/lessons/archived",
  ]) {
    await rejected("SOURCE_ARCHIVE_IN_USE", "deleteSourceArchiveAsset", base, {
      [lessonPath]: { footnotes: [{ sourceArchiveAssetId: "existing" }] },
    });
  }
  await rejected(
    "SOURCE_ARCHIVE_REFERENCE_SCAN_LIMIT",
    "deleteSourceArchiveAsset",
    base,
    Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`lessons/${index}`, {}]),
    ),
  );
  await rejected(
    "SOURCE_ARCHIVE_PROCESSING_ACTIVE",
    "deleteSourceArchiveAsset",
    base,
    { [path]: { ...oldAsset(), processingStatus: "processing" } },
  );
  await rejected(
    "SOURCE_ARCHIVE_UPLOAD_ACTIVE",
    "deleteSourceArchiveAsset",
    base,
    { [path]: { ...oldAsset(), uploadWriteLeaseExpiresAtMs: 2000 } },
  );
  await rejected("SOURCE_ARCHIVE_IN_USE", "deleteSourceArchiveAsset", base, {
    "lessons/legacy-path-only": {
      footnotes: [{ sourceArchiveImagePath: oldAsset().image.displayPath }],
    },
  });
  const metadataTest = setup();
  await metadataTest.execute("saveSourceArchiveMetadata", {
    ...base,
    metadata: { ...metadata, title: "수정" },
  });
  assert.deepEqual(metadataTest.store.docs.get(path).image, oldAsset().image);
  checks++;

  const db = nativeDb(store),
    bucket = fakeBucket();
  const handler = archive.createSourceArchiveUploadHandler({
    db,
    bucket,
    assertSession,
    now: () => 1000,
    imageMetadata: async () => ({ format: "jpeg", width: 10, height: 10 }),
  });
  const uploadRequest = request({
    uploadId: prepared.result.uploadId,
    contentBase64: bytes.toString("base64"),
  });
  await handler(uploadRequest);
  await handler(uploadRequest);
  assert.equal(bucket.objects.size, 1);
  checks++;
  await assert.rejects(
    handler({
      ...uploadRequest,
      auth: { uid: "other", token: { email: "other@yongshin-ms.ms.kr" } },
    }),
  );
  checks++;
  await assert.rejects(
    handler(
      request({
        ...uploadRequest.data,
        contentBase64: Buffer.from("wrong").toString("base64"),
      }),
    ),
  );
  checks++;
  const ticketPath = `${archive.UPLOAD_COLLECTION}/${prepared.result.uploadId}`;
  for (const status of ["PROCESSING", "COMPLETED"]) {
    store.docs.set(ticketPath, { ...store.docs.get(ticketPath), status });
    bucket.objects.clear();
    assert.equal((await handler(uploadRequest)).uploaded, true);
    assert.equal(bucket.objects.size, 0);
    checks++;
  }
  store.docs.set(ticketPath, {
    ...store.docs.get(ticketPath),
    status: "FAILED",
  });
  await assert.rejects(
    handler(uploadRequest),
    (error) => error.details?.reason === "SOURCE_ARCHIVE_PROCESSING_FAILED",
  );
  assert.equal(bucket.objects.size, 0);
  checks++;

  const replacement = setup();
  const replacementResult = await replacement.execute(
    "prepareSourceArchiveUpload",
    { ...base, metadata, upload },
  );
  const incoming = replacementResult.result.storagePath;
  const replacementBucket = fakeBucket();
  await replacementBucket.file(incoming).save(bytes);
  await replacementBucket.file(oldAsset().image.originalPath).save(bytes);
  const processor = loadProcessor(
    nativeDb(replacement.store),
    replacementBucket,
    () => {
      const latest = replacement.store.docs.get(path);
      replacement.store.docs.set(path, {
        ...latest,
        title: "처리 중 수정한 제목",
        searchText: "처리 중 수정",
      });
    },
  );
  await processor.processSourceArchiveIncomingUpload({
    data: { name: incoming, bucket: "fixture", contentType: "image/jpeg" },
  });
  assert.equal(replacement.store.docs.get(path).processingStatus, "ready");
  assert.equal(replacement.store.docs.get(path).title, "처리 중 수정한 제목");
  assert.equal(
    replacementBucket.objects.has(oldAsset().image.originalPath),
    true,
  );
  checks += 3;

  const stale = setup();
  const staleResult = await stale.execute("prepareSourceArchiveUpload", {
    ...base,
    metadata,
    upload,
  });
  const staleBucket = fakeBucket();
  await staleBucket.file(staleResult.result.storagePath).save(bytes);
  const staleProcessor = loadProcessor(
    nativeDb(stale.store),
    staleBucket,
    () => {
      stale.store.docs.set(path, {
        ...stale.store.docs.get(path),
        deletedAt: stamp,
        processingStatus: "archived",
        deletionStatus: "COMPLETED",
      });
    },
  );
  await staleProcessor.processSourceArchiveIncomingUpload({
    data: {
      name: staleResult.result.storagePath,
      bucket: "fixture",
      contentType: "image/jpeg",
    },
  });
  assert.equal(stale.store.docs.get(path).processingStatus, "archived");
  assert.equal(
    [...staleBucket.objects.keys()].filter(
      (name) => !name.includes("/incoming/"),
    ).length,
    0,
  );
  checks += 2;
  assert.equal(staleBucket.objects.size, 0);
  checks++;
  const pdf = setup(),
    pdfBucket = fakeBucket();
  const pdfResult = await pdf.execute("prepareSourceArchiveUpload", {
    ...base,
    metadata,
    upload: { ...upload, mediaKind: "pdf", contentType: "application/pdf" },
  });
  await pdfBucket.file(pdfResult.result.storagePath).save(bytes);
  await pdfBucket.file(oldAsset().image.originalPath).save(bytes);
  const pdfProcessor = loadProcessor(
    nativeDb(pdf.store),
    pdfBucket,
    undefined,
    true,
  );
  await pdfProcessor.processSourceArchiveIncomingUpload({
    data: {
      name: pdfResult.result.storagePath,
      bucket: "fixture",
      contentType: "application/pdf",
    },
  });
  assert.equal(pdf.store.docs.get(path).processingStatus, "failed");
  assert.equal(
    [...pdfBucket.objects.keys()].some((name) => name.endsWith("partial.json")),
    false,
  );
  assert.equal(pdfBucket.objects.has(oldAsset().image.originalPath), true);
  assert.equal(
    pdfBucket.objects.has(pdf.store.docs.get(path).file.storagePath),
    true,
  );
  checks += 4;

  const deletion = setup(),
    deletionBucket = fakeBucket();
  await deletionBucket.file(oldAsset().image.originalPath).save(bytes);
  const deleted = await deletion.execute("deleteSourceArchiveAsset", base);
  assert.equal(deletion.store.docs.get(path).deletionStatus, "PENDING");
  const cleanup = archive.createSourceArchiveCleanupHandler({
    db: nativeDb(deletion.store),
    bucket: deletionBucket,
    assertSession,
    now: () => 2000,
  });
  const cleanupRequest = request({
    assetId: "existing",
    deleteCommandId: deleted.commandId,
  });
  deletionBucket.failDelete(oldAsset().image.originalPath);
  await assert.rejects(
    cleanup(cleanupRequest),
    (error) => error.details?.reason === "SOURCE_ARCHIVE_CLEANUP_PENDING",
  );
  assert.equal(deletion.store.docs.get(path).deletionStatus, "FAILED");
  await cleanup(cleanupRequest);
  assert.equal(deletionBucket.objects.size, 0);
  assert.equal(deletion.store.docs.get(path).deletionStatus, "COMPLETED");
  await deletionBucket
    .file("source-archive/existing/late/original.jpg")
    .save(bytes);
  await cleanup(cleanupRequest);
  assert.equal(deletionBucket.objects.size, 0);
  checks += 6;
  await assert.rejects(
    processor.deleteSourceArchiveAsset(request({ assetId: "existing" })),
    (error) => error.details?.reason === "SOURCE_ARCHIVE_COMMAND_REQUIRED",
  );
  checks++;
  const expired = setup(),
    expiredBucket = fakeBucket(),
    expiredId = "expired-upload";
  const expiredPath = `source-archive/existing/incoming/${expiredId}.jpg`;
  expired.store.docs.set(`${archive.UPLOAD_COLLECTION}/${expiredId}`, {
    ...upload,
    assetId: "existing",
    uploadId: expiredId,
    storagePath: expiredPath,
    status: "PENDING",
    expiresAtMs: 500,
  });
  expired.store.docs.set(path, {
    ...oldAsset(),
    processingStatus: "uploading",
    image: {
      ...oldAsset().image,
      pendingUploadToken: expiredId,
      pendingUploadPath: expiredPath,
    },
  });
  await expiredBucket.file(expiredPath).save(bytes);
  await expiredBucket.file(oldAsset().image.originalPath).save(bytes);
  expiredBucket.failDelete(expiredPath);
  assert.equal(
    (
      await archive.cleanupExpiredSourceArchiveUploads({
        db: nativeDb(expired.store),
        bucket: expiredBucket,
        now: () => 1000,
      })
    ).failed,
    1,
  );
  assert.equal(
    expired.store.docs.get(`${archive.UPLOAD_COLLECTION}/${expiredId}`).status,
    "EXPIRING",
  );
  assert.equal(
    (
      await archive.cleanupExpiredSourceArchiveUploads({
        db: nativeDb(expired.store),
        bucket: expiredBucket,
        now: () => 1000,
      })
    ).cleaned,
    1,
  );
  assert.equal(
    expired.store.docs.get(`${archive.UPLOAD_COLLECTION}/${expiredId}`).status,
    "EXPIRED",
  );
  assert.equal(expired.store.docs.get(path).processingStatus, "failed");
  assert.equal(expiredBucket.objects.has(oldAsset().image.originalPath), true);
  checks += 6;
  const completedPath = `${archive.UPLOAD_COLLECTION}/old-completed`;
  const blockedPath = `${archive.UPLOAD_COLLECTION}/bad-path`;
  const waitingPath = `${archive.UPLOAD_COLLECTION}/waiting-upload`;
  expired.store.docs.set(completedPath, {
    status: "COMPLETED",
    expiresAtMs: 500,
  });
  expired.store.docs.set(blockedPath, {
    ...upload,
    assetId: "existing",
    uploadId: "bad-path",
    status: "PENDING",
    expiresAtMs: 500,
    storagePath: "source-archive/other/original.jpg",
  });
  expired.store.docs.set(waitingPath, {
    ...upload,
    assetId: "existing",
    uploadId: "waiting-upload",
    status: "PENDING",
    expiresAtMs: 500,
    storagePath: "source-archive/existing/incoming/waiting-upload.jpg",
  });
  const maintain = () =>
    archive.cleanupExpiredSourceArchiveUploads({
      db: nativeDb(expired.store),
      bucket: expiredBucket,
      now: () => 1000,
      limit: 1,
    });
  assert.equal((await maintain()).cleaned, 0);
  assert.equal(expired.store.docs.get(completedPath).expiresAtMs, undefined);
  assert.equal((await maintain()).cleaned, 0);
  assert.equal(expired.store.docs.get(blockedPath).status, "CLEANUP_BLOCKED");
  assert.equal((await maintain()).cleaned, 1);
  checks += 5;
  const adapterSource = readFileSync(
    require.resolve("../sourceArchivePdfAdapter"),
    "utf8",
  );
  const saveFunction = adapterSource.slice(
    adapterSource.indexOf("const saveSourceArchivePdfArtifacts ="),
    adapterSource.indexOf("module.exports ="),
  );
  let finishSlowPage,
    pageSettled = false;
  const pdfContext = {
    extractSourceArchivePdf: async () => ({
      markdown: "",
      manifest: {},
      pageArtifacts: [{ storagePath: "page-one" }, { storagePath: "page-two" }],
    }),
    saveTextStorageFile: async () => {},
    saveJsonStorageFile: async ({ storagePath }) => {
      if (storagePath === "page-one")
        throw new Error("fixture page write failed");
      if (storagePath === "page-two")
        await new Promise((resolve) => {
          finishSlowPage = resolve;
        });
    },
    console,
    Promise,
  };
  vm.runInNewContext(
    `${saveFunction}\nthis.save = saveSourceArchivePdfArtifacts;`,
    pdfContext,
  );
  const pageTask = pdfContext.save({
    bucket: {},
    inputBuffer: bytes,
    originalName: "fixture.pdf",
    revisionPaths: {},
  });
  void pageTask.catch(() => {
    pageSettled = true;
  });
  await new Promise(setImmediate);
  assert.equal(pageSettled, false);
  finishSlowPage();
  await assert.rejects(pageTask, /fixture page write failed/);
  checks += 2;
  console.log(
    JSON.stringify({
      suite: "source-archive-management",
      status: "PASS",
      checks,
      productionAccess: 0,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
