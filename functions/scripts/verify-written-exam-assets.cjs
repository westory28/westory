const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const sharp = require("sharp");
const { Timestamp } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  createWrittenExamAssetHandler,
  manageWrittenExamAsset,
  CHUNK_BYTES,
} = require("../writtenExamAssets");
const {
  createStudentMaintenanceService,
  withStudentMaintenanceGuard,
} = require("../studentMaintenance");
const checks = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const proof = {
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const path =
  "years/2026/semesters/2/written_exam_analyses/synthetic-exam/revision-a/paper.pdf";
const revisionPath =
  "years/2026/semesters/2/written_exam_analyses/synthetic-exam/revisions/revision-a";
const manifestPath =
  "years/2026/semesters/2/written_exam_analyses/synthetic-exam";
const request = (data, uid = "teacher") => ({
  auth: {
    uid,
    token: {
      email:
        uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`,
      auth_time: 100,
    },
  },
  data: { ...data, _session: proof },
});
const pdf = (size) => {
  const bytes = Buffer.alloc(size, 32);
  bytes.write("%PDF-1.7\n");
  bytes.write("\n%%EOF", size - 6);
  return bytes;
};
const upload = (
  bytes,
  index = 0,
  storagePath = path,
  contentType = "application/pdf",
) => ({
  action: "upload",
  storagePath,
  contentType,
  totalSize: bytes.length,
  sha256: hash(bytes),
  chunkIndex: index,
  contentBase64: bytes
    .subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
    .toString("base64"),
});
const fixture = () => {
  const documents = new Map([
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 1 }],
    [
      "semester_manifests/2026-2",
      { semesterId: "2026-2", revision: 1, status: "ACTIVE", readOnly: false },
    ],
    [
      revisionPath,
      {
        year: "2026",
        semester: "2",
        examId: "synthetic-exam",
        revision: "revision-a",
        state: "staging",
        uploadedBy: "teacher",
      },
    ],
    ...["teacher", "student", "staff", "other"].map((uid) => [
      `users/${uid}`,
      {
        role: uid === "other" ? "teacher" : uid,
        registrationApprovalStatus: "APPROVED",
      },
    ]),
  ]);
  const objects = new Map(),
    reads = [],
    saves = [],
    deletions = [],
    ranges = [],
    sessions = [],
    transactions = [];
  let generation = 0,
    expired = false,
    locked = false,
    queuedPublish,
    beforeTransaction,
    afterSave,
    transactionRuns = 0,
    deleteFailure = false,
    commitFailure = false,
    afterDelete,
    activeMaxAttempts,
    markerUpdates = 0,
    markerQueue = Promise.resolve();
  const snapshot = (p) => ({
    exists: documents.has(p),
    data: () => documents.get(p),
  });
  const db = {
    doc: (p) => ({
      path: p,
      get: async () => {
        reads.push(p);
        return snapshot(p);
      },
    }),
    runTransaction: async (action, options) => {
      assert.ok([1, 5].includes(options.maxAttempts));
      let releaseMarker;
      if (options.maxAttempts === 5) {
        const previous = markerQueue;
        markerQueue = new Promise((resolve) => {
          releaseMarker = resolve;
        });
        await previous;
      }
      if (beforeTransaction) {
        const hook = beforeTransaction;
        beforeTransaction = null;
        hook();
      }
      transactionRuns++;
      assert.equal(locked, false);
      locked = true;
      activeMaxAttempts = options.maxAttempts;
      try {
        const pending = [];
        const result = await action({
          get: async (ref) => {
            transactions.push(ref.path);
            return snapshot(ref.path);
          },
          update: (ref, changes) => {
            assert.equal(
              options.maxAttempts,
              5,
              "Firestore-only cancellation can retry",
            );
            pending.push({ ref, changes });
          },
        });
        if (pending.length && commitFailure)
          throw new Error("synthetic commit unavailable");
        for (const { ref, changes } of pending) {
          documents.set(ref.path, { ...documents.get(ref.path), ...changes });
          markerUpdates++;
        }
        return result;
      } finally {
        locked = false;
        activeMaxAttempts = undefined;
        releaseMarker?.();
        if (queuedPublish) {
          const fn = queuedPublish;
          queuedPublish = null;
          fn();
        }
      }
    },
  };
  const bucket = {
    file: (p, fileOptions) => ({
      getMetadata: async () => {
        if (!objects.has(p))
          throw Object.assign(new Error("missing"), { code: 404 });
        return [structuredClone(objects.get(p).metadata)];
      },
      save: async (bytes, options) => {
        assert.equal(
          activeMaxAttempts,
          1,
          "Callbacks with GCS writes never retry",
        );
        assert.equal(
          locked,
          true,
          "All GCS writes hold the revision transaction lock",
        );
        assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
        if (objects.has(p))
          throw Object.assign(new Error("exists"), { code: 412 });
        const metadata = {
          ...structuredClone(options.metadata),
          size: String(bytes.length),
          generation: String(++generation),
        };
        objects.set(p, { bytes: Buffer.from(bytes), metadata });
        saves.push({ path: p, options });
        if (afterSave) await afterSave(p);
      },
      delete: async (options) => {
        assert.ok(
          locked || documents.get(revisionPath)?.state === "cleanup",
          "Deletion requires the revision lock or a committed cleanup tombstone",
        );
        assert.equal(options.ignoreNotFound, true);
        if (deleteFailure) throw new Error("synthetic cleanup unavailable");
        objects.delete(p);
        deletions.push(p);
        if (afterDelete) await afterDelete(p);
      },
      download: async (options) => {
        const object = objects.get(p);
        if (!object) throw Object.assign(new Error("missing"), { code: 404 });
        if (fileOptions?.generation)
          assert.equal(fileOptions.generation, object.metadata.generation);
        ranges.push({ path: p, ...options });
        return [
          Buffer.from(
            object.bytes.subarray(
              options?.start || 0,
              options?.end === undefined ? undefined : options.end + 1,
            ),
          ),
        ];
      },
    }),
  };
  const handler = createWrittenExamAssetHandler({
    db,
    bucket,
    assertSession: async (req) => {
      sessions.push(req.auth?.uid);
      if (
        !req.auth?.uid ||
        expired ||
        JSON.stringify(req.data?._session) !== JSON.stringify(proof)
      )
        throw new HttpsError("unauthenticated", "synthetic expired session");
      return { uid: req.auth.uid };
    },
  });
  const call = withStudentMaintenanceGuard(handler, {
    service: createStudentMaintenanceService({ db }),
  });
  const publish = (
    bytes,
    contentType = "application/pdf",
    storagePath = path,
  ) => {
    const action = () => {
      if (!["staging", "ready"].includes(documents.get(revisionPath)?.state))
        throw new HttpsError(
          "failed-precondition",
          "synthetic publication cancelled",
        );
      documents.set(revisionPath, {
        ...documents.get(revisionPath),
        state: "ready",
      });
      documents.set(manifestPath, {
        year: "2026",
        semester: "2",
        revision: "revision-a",
        files: [
          {
            fileName: storagePath.split("/").at(-1),
            size: bytes.length,
            contentType,
          },
        ],
      });
    };
    if (locked) queuedPublish = action;
    else action();
  };
  return {
    call,
    documents,
    objects,
    reads,
    saves,
    deletions,
    ranges,
    sessions,
    transactions,
    publish,
    expire: () => {
      expired = true;
    },
    failDelete: (value) => {
      deleteFailure = value;
    },
    failCommit: (value) => {
      commitFailure = value;
    },
    afterDelete: (hook) => {
      afterDelete = hook;
    },
    beforeTransaction: (hook) => {
      beforeTransaction = hook;
    },
    afterSave: (hook) => {
      afterSave = hook;
    },
    get transactionRuns() {
      return transactionRuns;
    },
    get markerUpdates() {
      return markerUpdates;
    },
  };
};
const check = async (name, run) => {
  await run();
  checks.push(name);
};
const rejected = async (name, change, setup = () => {}, code) =>
  check(name, async () => {
    const f = fixture(),
      req = request(upload(pdf(64)));
    setup(f);
    change(req);
    await assert.rejects(
      f.call(req),
      code ? (error) => error.code === code : undefined,
    );
    assert.equal(f.objects.has(path), false);
  });
async function main() {
  await check(
    "4MiB sequential upload, exact hash, private metadata, immutable replay and ready ranged read",
    async () => {
      const f = fixture(),
        bytes = pdf(CHUNK_BYTES + 37);
      assert.deepEqual(await f.call(request(upload(bytes))), {
        accepted: true,
        complete: false,
      });
      assert.deepEqual(await f.call(request(upload(bytes, 1))), {
        accepted: true,
        complete: true,
      });
      assert.deepEqual(f.objects.get(path).bytes, bytes);
      assert.equal(f.objects.size, 1);
      const meta = f.objects.get(path).metadata;
      assert.equal(meta.cacheControl, "private, no-store");
      assert.equal(meta.metadata.sha256, hash(bytes));
      assert.deepEqual(
        Object.keys(meta.metadata).sort(),
        ["ownerUid", "year", "semester", "examId", "revision", "sha256"].sort(),
      );
      assert.equal(f.saves.length, 3);
      assert.deepEqual(await f.call(request(upload(bytes, 1))), {
        accepted: true,
        complete: true,
      });
      assert.equal(f.saves.length, 3);
      const tampered = upload(bytes, 1);
      tampered.contentBase64 = Buffer.alloc(37).toString("base64");
      await assert.rejects(
        f.call(request(tampered)),
        (error) => error.code === "failed-precondition",
      );
      await assert.rejects(
        f.call(request({ action: "read", storagePath: path, chunkIndex: 0 })),
        (error) => error.code === "permission-denied",
      );
      f.publish(bytes);
      const pieces = [];
      for (let chunkIndex = 0; chunkIndex < 2; chunkIndex++) {
        const result = await f.call(
          request({ action: "read", storagePath: path, chunkIndex }),
        );
        assert.equal(result.totalSize, bytes.length);
        assert.equal(result.sha256, hash(bytes));
        pieces.push(Buffer.from(result.contentBase64, "base64"));
      }
      assert.deepEqual(Buffer.concat(pieces), bytes);
      assert.equal(f.ranges.at(-1).start, CHUNK_BYTES);
      assert.equal(f.ranges.at(-1).end, bytes.length - 1);
      const deletes = f.deletions.length;
      assert.equal(
        deletes,
        4,
        "Completed upload and its replay each delete only the two actual chunks",
      );
      await assert.rejects(
        f.call(request({ action: "remove", storagePath: path })),
        (error) => error.code === "permission-denied",
      );
      assert.equal(f.deletions.length, deletes);
      assert.ok(f.objects.has(path));
    },
  );
  for (const uid of ["student", "staff", "other"])
    await rejected(
      `reject ${uid} upload`,
      (req) => {
        req.auth = request({}, uid).auth;
      },
      () => {},
      "permission-denied",
    );
  await rejected(
    "reject anonymous",
    (req) => {
      req.auth = undefined;
    },
    () => {},
    "unauthenticated",
  );
  await rejected(
    "reject external email",
    (req) => {
      req.auth.token.email = "teacher@example.test";
    },
    () => {},
    "permission-denied",
  );
  await rejected(
    "reject pending registration",
    () => {},
    (f) =>
      f.documents.set("users/teacher", {
        role: "teacher",
        registrationApprovalStatus: "PENDING",
      }),
    "permission-denied",
  );
  await rejected(
    "reject retired session",
    () => {},
    (f) => f.expire(),
    "unauthenticated",
  );
  await rejected(
    "reject forged session proof",
    (req) => {
      req.data._session = {};
    },
    () => {},
    "unauthenticated",
  );
  await rejected(
    "reject missing revision",
    () => {},
    (f) => f.documents.delete(revisionPath),
    "permission-denied",
  );
  await rejected(
    "reject ready write",
    () => {},
    (f) =>
      f.documents.set(revisionPath, {
        ...f.documents.get(revisionPath),
        state: "ready",
      }),
    "permission-denied",
  );
  await rejected(
    "reject retired semester",
    () => {},
    (f) =>
      f.documents.set("site_settings/semester_active", {
        semesterId: "2027-1",
        revision: 1,
      }),
    "failed-precondition",
  );
  await rejected(
    "reject readOnly semester",
    () => {},
    (f) =>
      f.documents.set("semester_manifests/2026-2", {
        semesterId: "2026-2",
        revision: 1,
        status: "ACTIVE",
        readOnly: true,
      }),
    "failed-precondition",
  );
  for (const storagePath of [
    path + "/extra",
    path.replace("paper.pdf", "../paper.pdf"),
    path.replace("paper.pdf", "_chunks/test"),
    path.replace("paper.pdf", "paper.svg"),
    "gs://other/" + path,
    path.replace("synthetic-exam", "%2e%2e"),
  ])
    await rejected(
      "reject unsafe path " + storagePath.slice(-28),
      (req) => {
        req.data.storagePath = storagePath;
      },
      () => {},
      "invalid-argument",
    );
  for (const [field, value] of [
    ["chunkIndex", -1],
    ["chunkIndex", 8],
    ["chunkIndex", 0.5],
    ["totalSize", 0],
    ["totalSize", 30 * 1024 * 1024 + 1],
    ["sha256", "g".repeat(64)],
    ["contentType", "text/html"],
    ["contentBase64", "!!!!"],
    ["contentBase64", "Zg=="],
  ])
    await rejected(
      `reject invalid ${field}:${String(value).slice(0, 16)}`,
      (req) => {
        req.data[field] = value;
      },
      () => {},
      "invalid-argument",
    );
  await rejected(
    "reject extra payload field",
    (req) => {
      req.data.bucket = "other";
    },
    () => {},
    "invalid-argument",
  );
  await rejected(
    "reject hash mismatch",
    (req) => {
      req.data.sha256 = "a".repeat(64);
    },
    () => {},
    "invalid-argument",
  );
  await rejected(
    "reject PDF magic mismatch",
    (req) => {
      Object.assign(req.data, upload(Buffer.alloc(64)));
    },
    () => {},
    "invalid-argument",
  );
  await check(
    "valid PNG/WebP fully decode and oversized or truncated image rejects",
    async () => {
      const source = sharp({
        create: { width: 12, height: 18, channels: 3, background: "#255be3" },
      });
      for (const extension of ["png", "webp"]) {
        const f = fixture(),
          bytes = await source.clone()[extension]().toBuffer();
        const storagePath = path.replace("paper.pdf", `page-1.${extension}`);
        assert.equal(
          (
            await f.call(
              request(upload(bytes, 0, storagePath, `image/${extension}`)),
            )
          ).complete,
          true,
        );
        const bad = bytes.subarray(0, 20),
          f2 = fixture();
        await assert.rejects(
          f2.call(request(upload(bad, 0, storagePath, `image/${extension}`))),
          (error) => error.code === "invalid-argument",
        );
        const large = {
          ...upload(bytes, 0, storagePath, `image/${extension}`),
          totalSize: 12 * 1024 * 1024 + 1,
        };
        await assert.rejects(
          fixture().call(request(large)),
          (error) => error.code === "invalid-argument",
        );
      }
    },
  );
  await check("30MiB PDF uses exactly eight bounded calls", async () => {
    const f = fixture(),
      bytes = pdf(30 * 1024 * 1024);
    for (let index = 0; index < 8; index++)
      assert.equal(
        (await f.call(request(upload(bytes, index)))).complete,
        index === 7,
      );
    assert.equal(f.objects.get(path).bytes.length, bytes.length);
    assert.equal(f.objects.size, 1);
  });
  await check(
    "lost final save response recovers without overwrite",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      f.afterSave((p) => {
        if (p === path) throw new Error("synthetic response lost");
      });
      assert.equal((await f.call(request(upload(bytes)))).complete, true);
      assert.deepEqual(f.objects.get(path).bytes, bytes);
      assert.equal(f.saves.filter((entry) => entry.path === path).length, 1);
      assert.equal(
        f.saves.length,
        1,
        "A single chunk writes its final object directly",
      );
      assert.equal(f.ranges.length, 0);
      assert.equal(f.deletions.length, 0);
    },
  );
  await check(
    "missing earlier chunk fails and exact replay after missing part succeeds",
    async () => {
      const f = fixture(),
        bytes = pdf(CHUNK_BYTES + 64);
      await assert.rejects(
        f.call(request(upload(bytes, 1))),
        (error) => error.code === "failed-precondition",
      );
      await f.call(request(upload(bytes, 0)));
      assert.equal((await f.call(request(upload(bytes, 1)))).complete, true);
    },
  );
  await check(
    "cleanup failure never acknowledges completion and exact replay clears chunks before completion",
    async () => {
      const f = fixture(),
        bytes = pdf(CHUNK_BYTES + 64);
      await f.call(request(upload(bytes, 0)));
      f.failDelete(true);
      await assert.rejects(
        f.call(request(upload(bytes, 1))),
        /cleanup unavailable/,
      );
      assert.ok(f.objects.has(path));
      assert.equal(f.objects.size, 3);
      assert.equal(f.documents.get(revisionPath).state, "staging");
      assert.equal(f.documents.has(manifestPath), false);
      await assert.rejects(
        f.call(request(upload(bytes, 1))),
        /cleanup unavailable/,
      );
      f.failDelete(false);
      assert.equal((await f.call(request(upload(bytes, 1)))).complete, true);
      assert.equal(f.objects.size, 1);
      assert.deepEqual(f.objects.get(path).bytes, bytes);
    },
  );
  await check(
    "different chunk content is rejected and own staging cleanup is bounded and idempotent",
    async () => {
      const f = fixture(),
        bytes = pdf(CHUNK_BYTES + 64);
      await f.call(request(upload(bytes, 0)));
      const changed = Buffer.from(bytes);
      changed[30] = 1;
      await assert.rejects(
        f.call(request(upload(changed, 0))),
        (error) => error.code === "failed-precondition",
      );
      await f.call(request({ action: "remove", storagePath: path }));
      assert.equal(f.deletions.length, 9);
      assert.equal(f.objects.size, 0);
      await f.call(request({ action: "remove", storagePath: path }));
      assert.equal(f.objects.size, 0);
    },
  );
  await check(
    "revoked session on next chunk leaves final object absent",
    async () => {
      const f = fixture(),
        bytes = pdf(CHUNK_BYTES + 64);
      await f.call(request(upload(bytes, 0)));
      f.expire();
      await assert.rejects(
        f.call(request(upload(bytes, 1))),
        (error) => error.code === "unauthenticated",
      );
      assert.equal(f.objects.has(path), false);
    },
  );
  await check(
    "committed cleanup tombstone blocks a late publisher and new uploads",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      await f.call(request(upload(bytes)));
      f.afterDelete((p) => {
        if (p === path)
          assert.throws(
            () => f.publish(bytes),
            (error) => error.code === "failed-precondition",
          );
      });
      await f.call(request({ action: "remove", storagePath: path }));
      assert.equal(f.documents.get(revisionPath).state, "cleanup");
      assert.equal(f.documents.has(manifestPath), false);
      assert.equal(f.objects.has(path), false);
      await assert.rejects(
        f.call(request(upload(bytes))),
        (error) => error.code === "permission-denied",
      );
      await f.call(request({ action: "remove", storagePath: path }));
    },
  );
  await check(
    "concurrent file removals share one retryable cancellation marker and remove every asset",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      const imagePath = path.replace("paper.pdf", "page-1.png");
      const image = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      await f.call(request(upload(bytes)));
      await f.call(request(upload(image, 0, imagePath, "image/png")));
      const results = await Promise.all(
        [path, imagePath].map((storagePath) =>
          f.call(request({ action: "remove", storagePath })),
        ),
      );
      assert.deepEqual(results, [{ deleted: true }, { deleted: true }]);
      assert.equal(
        f.markerUpdates,
        1,
        "Only the first removal transitions staging to cleanup",
      );
      assert.equal(f.objects.size, 0);
      assert.equal(
        f.deletions.length,
        18,
        "Each exact file and its bounded chunks are removed",
      );
      assert.equal(f.documents.get(revisionPath).state, "cleanup");
      assert.equal(f.documents.has(manifestPath), false);
    },
  );
  await check(
    "cleanup marker commit failure deletes zero bytes and retry is safe",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      await f.call(request(upload(bytes)));
      f.failCommit(true);
      await assert.rejects(
        f.call(request({ action: "remove", storagePath: path })),
        /commit unavailable/,
      );
      assert.equal(f.documents.get(revisionPath).state, "staging");
      assert.equal(f.deletions.length, 0);
      assert.deepEqual(f.objects.get(path).bytes, bytes);
      f.failCommit(false);
      await f.call(request({ action: "remove", storagePath: path }));
      assert.equal(f.objects.size, 0);
      assert.equal(f.documents.get(revisionPath).state, "cleanup");
    },
  );
  await check(
    "GCS cleanup failure keeps cancellation committed and supports idempotent retry",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      await f.call(request(upload(bytes)));
      f.failDelete(true);
      await assert.rejects(
        f.call(request({ action: "remove", storagePath: path })),
        /cleanup unavailable/,
      );
      assert.equal(f.documents.get(revisionPath).state, "cleanup");
      assert.throws(
        () => f.publish(bytes),
        (error) => error.code === "failed-precondition",
      );
      assert.deepEqual(f.objects.get(path).bytes, bytes);
      f.failDelete(false);
      await f.call(request({ action: "remove", storagePath: path }));
      assert.equal(f.objects.size, 0);
    },
  );
  await check(
    "revision changed before transaction blocks all writes",
    async () => {
      const f = fixture();
      f.beforeTransaction(() =>
        f.documents.set(revisionPath, {
          ...f.documents.get(revisionPath),
          state: "ready",
        }),
      );
      await assert.rejects(
        f.call(request(upload(pdf(64)))),
        (error) => error.code === "permission-denied",
      );
      assert.equal(f.saves.length, 0);
    },
  );
  await check(
    "publication waits for final GCS operation; subsequent cleanup never deletes published object",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      f.afterSave((p) => {
        if (p === path) f.publish(bytes);
      });
      await f.call(request(upload(bytes)));
      assert.equal(f.documents.get(revisionPath).state, "ready");
      await assert.rejects(
        f.call(request({ action: "remove", storagePath: path })),
        (error) => error.code === "permission-denied",
      );
      assert.deepEqual(f.objects.get(path).bytes, bytes);
    },
  );
  await check(
    "ready reads require allowlist and deny students or unlisted files",
    async () => {
      const f = fixture(),
        bytes = pdf(64);
      await f.call(request(upload(bytes)));
      f.publish(bytes);
      await assert.rejects(
        f.call(
          request(
            { action: "read", storagePath: path, chunkIndex: 0 },
            "student",
          ),
        ),
        (error) => error.code === "permission-denied",
      );
      f.documents.set(manifestPath, {
        ...f.documents.get(manifestPath),
        files: [],
      });
      await assert.rejects(
        f.call(request({ action: "read", storagePath: path, chunkIndex: 0 })),
        (error) => error.code === "permission-denied",
      );
      f.publish(bytes);
      f.documents.set("site_settings/semester_active", {
        semesterId: "2027-1",
        revision: 1,
      });
      assert.equal(
        (
          await f.call(
            request({ action: "read", storagePath: path, chunkIndex: 0 }),
          )
        ).totalSize,
        bytes.length,
        "Historical ready materials remain readable to teachers",
      );
    },
  );
  await check(
    "admin own staging upload and active student maintenance preserve role fences",
    async () => {
      const f = fixture();
      f.documents.set("site_settings/student_maintenance", {
        enabled: true,
        blockedRoles: ["student"],
        bypassUids: [],
        title: "점검",
        message: "점검 중입니다.",
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        updatedBy: "admin",
        revision: 1,
      });
      f.documents.set(revisionPath, {
        ...f.documents.get(revisionPath),
        uploadedBy: "admin",
      });
      assert.equal(
        (await f.call(request(upload(pdf(64)), "admin"))).complete,
        true,
      );
    },
  );
  assert.deepEqual(manageWrittenExamAsset.__endpoint.region, [
    "asia-northeast3",
  ]);
  assert.equal(manageWrittenExamAsset.__endpoint.concurrency, 1);
  assert.equal(manageWrittenExamAsset.__endpoint.timeoutSeconds, 120);
  assert.equal(manageWrittenExamAsset.__endpoint.minInstances, 0);
  assert.equal(manageWrittenExamAsset.__endpoint.maxInstances, 5);
  assert.ok(
    readFileSync(resolve(__dirname, "../index.js"), "utf8").includes(
      "exports.manageWrittenExamAsset = require('./writtenExamAssets').manageWrittenExamAsset",
    ),
  );
  console.log(
    JSON.stringify(
      { passed: true, checks: checks.length, network: 0, cases: checks },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
