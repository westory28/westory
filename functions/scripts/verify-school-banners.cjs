const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createRegisterSchoolBannerHandler } = require("../schoolBanners");

const fixture = () => {
  const data = new Map([
    ["users/teacher", { role: "teacher" }],
    ["users/student", { role: "student" }],
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 3 }],
    [
      "semester_manifests/2026-2",
      { semesterId: "2026-2", revision: 3, status: "ACTIVE" },
    ],
    ["site_settings/config", { activeSemesterId: "2026-2" }],
  ]);
  const objects = new Map();
  let queue = Promise.resolve(),
    nextId = 0,
    clock = 1_800_000_000_000;
  const hooks = {
    beforeSave: null,
    saveError: false,
    deleteError: false,
    commitError: false,
    lostAck: false,
    reconciliationError: false,
  };
  const db = {
    doc: (path) => ({ path }),
    runTransaction: (callback) => {
      const operation = queue.then(async () => {
        const pending = new Map(data),
          writes = [];
        const snapshot = (ref) => ({
          exists: pending.has(ref.path),
          data: () => pending.get(ref.path),
        });
        const transaction = {
          get: async (ref) => snapshot(ref),
          getAll: async (...refs) => refs.map(snapshot),
          set: (ref, value) => {
            pending.set(ref.path, value);
            writes.push(["set", ref.path, value]);
          },
          create: (ref, value) => {
            assert(!pending.has(ref.path));
            pending.set(ref.path, value);
            writes.push(["create", ref.path, value]);
          },
          update: (ref, value) => {
            assert(pending.has(ref.path));
            pending.set(ref.path, { ...pending.get(ref.path), ...value });
            writes.push(["update", ref.path, value]);
          },
        };
        const result = await callback(transaction);
        const publishing = writes.some(([type]) => type === "create");
        if (publishing && hooks.commitError) {
          hooks.commitError = false;
          throw Error("Firestore unavailable");
        }
        if (
          hooks.reconciliationError &&
          writes.some(([, , value]) => value.status === "FAILED")
        )
          throw Error("Reconciliation unavailable");
        for (const [, path] of writes) data.set(path, pending.get(path));
        if (publishing && hooks.lostAck) {
          hooks.lostAck = false;
          throw Error("Lost commit acknowledgement");
        }
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
  const bucket = {
    name: "fixture.appspot.com",
    file: (path) => ({
      save: async (bytes, options) => {
        if (hooks.beforeSave) await hooks.beforeSave(path);
        if (hooks.saveError) throw Error("Storage unavailable");
        assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
        assert(!objects.has(path));
        objects.set(path, { bytes, options });
      },
      delete: async () => {
        if (hooks.deleteError) throw Error("Storage delete unavailable");
        objects.delete(path);
      },
    }),
  };
  let sessionChecks = 0;
  const handler = createRegisterSchoolBannerHandler({
    db,
    bucket,
    now: () => clock,
    uuid: () => `attempt-${++nextId}`,
    assertSession: async (request, options) => {
      sessionChecks++;
      assert.deepEqual(options, { recentAuth: true, highRisk: true });
      if (!request.auth) {
        const error = Error("No session");
        error.code = "unauthenticated";
        throw error;
      }
      return {
        uid: request.auth.uid,
        email: request.auth.email || "teacher@school.kr",
      };
    },
  });
  return {
    data,
    objects,
    hooks,
    handler,
    advance: (ms) => {
      clock += ms;
    },
    sessionChecks: () => sessionChecks,
  };
};
const notices = (f) => [...f.data].filter(([path]) => /\/notices\//.test(path));
const code = (expected) => (error) => error.code === expected;

(async () => {
  const bytes = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  const input = {
    semesterId: "2026-2",
    requestId: "request-0001",
    title: "학교 행사 안내",
    contentBase64: bytes.toString("base64"),
  };
  const request = (data = {}, uid = "teacher") => ({
    auth: { uid },
    data: { ...input, ...data },
  });
  let f = fixture();
  await assert.rejects(f.handler({ data: input }), code("unauthenticated"));
  await assert.rejects(
    f.handler(request({}, "student")),
    code("permission-denied"),
  );
  assert.equal(f.objects.size, 0);
  for (const invalid of [
    { semesterId: "2026-3" },
    { requestId: "../bad" },
    { title: " " },
    { title: "가".repeat(121) },
    { contentBase64: "!!!!" },
    { contentBase64: Buffer.alloc(681 * 1024).toString("base64") },
    { imageStoragePath: "arbitrary/path" },
    { contentBase64: Buffer.from("not an image").toString("base64") },
    {
      contentBase64: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
      ).toString("base64"),
    },
  ]) {
    f = fixture();
    await assert.rejects(f.handler(request(invalid)), code("invalid-argument"));
    assert.equal(notices(f).length, 0);
    assert.equal(f.objects.size, 0);
  }
  for (const override of [
    { status: "CLOSING" },
    { readOnly: true },
    { revision: 2 },
  ]) {
    f = fixture();
    f.data.set("semester_manifests/2026-2", {
      ...f.data.get("semester_manifests/2026-2"),
      ...override,
    });
    await assert.rejects(f.handler(request()), code("failed-precondition"));
    assert.equal(f.objects.size, 0);
  }
  f = fixture();
  const saved = await f.handler(request());
  assert.equal(saved.imageWidth, 1200);
  assert.equal(saved.imageHeight, 675);
  assert.equal(saved.imageMimeType, "image/webp");
  assert(saved.imageByteSize <= 680 * 1024);
  assert.equal(f.sessionChecks(), 2);
  assert.equal(notices(f).length, 1);
  assert.equal(f.objects.size, 1);
  const notice = notices(f)[0][1];
  assert.equal(notice.content, input.title);
  assert.equal(notice.targetType, "common");
  assert.equal(notice.publishAt.toMillis(), notice.createdAt.toMillis());
  assert.equal(notice.imageUrl, saved.imageUrl);
  assert.equal(
    (await sharp(f.objects.get(saved.imageStoragePath).bytes).metadata())
      .format,
    "webp",
  );
  assert.deepEqual(await f.handler(request()), { ...saved, replayed: true });
  await assert.rejects(
    f.handler(request({ title: "다른 내용" })),
    code("already-exists"),
  );
  assert.equal(notices(f).length, 1);
  assert.equal(f.objects.size, 1);

  // Simultaneous submissions reserve one request; retries resolve the same result.
  f = fixture();
  let release, started;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  f.hooks.beforeSave = async () => {
    started();
    await barrier;
  };
  const first = f.handler(request());
  await entered;
  await assert.rejects(f.handler(request()), code("aborted"));
  release();
  const firstResult = await first;
  assert.equal((await f.handler(request())).noticeId, firstResult.noticeId);
  assert.equal(f.objects.size, 1);

  // A timed-out attempt must not overwrite or delete its replacement's published image.
  f = fixture();
  let unblock, oldStarted;
  const oldBarrier = new Promise((resolve) => {
    unblock = resolve;
  });
  const oldEntered = new Promise((resolve) => {
    oldStarted = resolve;
  });
  f.hooks.beforeSave = async () => {
    oldStarted();
    await oldBarrier;
  };
  const old = f.handler(request());
  await oldEntered;
  f.advance(151_000);
  f.hooks.beforeSave = null;
  const replacement = await f.handler(request());
  unblock();
  assert.equal((await old).imageStoragePath, replacement.imageStoragePath);
  assert.equal(f.objects.size, 1);
  assert(f.objects.has(replacement.imageStoragePath));

  for (const failure of ["saveError", "commitError"]) {
    f = fixture();
    f.hooks[failure] = true;
    await assert.rejects(f.handler(request()), code("unavailable"));
    assert.equal(f.objects.size, 0);
    assert.equal(notices(f).length, 0);
    f.hooks[failure] = false;
    await f.handler(request());
    assert.equal(f.objects.size, 1);
    assert.equal(notices(f).length, 1);
  }
  f = fixture();
  f.hooks.commitError = true;
  f.hooks.deleteError = true;
  await assert.rejects(f.handler(request()), code("unavailable"));
  const orphanPath = [...f.objects.keys()][0];
  const receiptPath = [...f.data.keys()].find((path) =>
    path.startsWith("school_banner_registrations/"),
  );
  assert(f.data.get(receiptPath).cleanupPaths.includes(orphanPath));
  await f.handler(request());
  assert(
    f.data.get(receiptPath).cleanupPaths.includes(orphanPath),
    "Successful replacement preserves failed cleanup work",
  );
  assert.equal(f.objects.size, 2);
  f.hooks.deleteError = false;
  await f.handler(request());
  assert.equal(f.objects.size, 1);
  assert(!f.objects.has(orphanPath));
  assert.deepEqual(f.data.get(receiptPath).cleanupPaths, []);
  f = fixture();
  f.hooks.lostAck = true;
  const acknowledged = await f.handler(request());
  assert.equal(acknowledged.replayed, true);
  assert(f.objects.has(acknowledged.imageStoragePath));
  assert.equal(notices(f).length, 1);

  f = fixture();
  f.hooks.commitError = true;
  f.hooks.reconciliationError = true;
  await assert.rejects(f.handler(request()), code("unavailable"));
  assert.equal(
    f.objects.size,
    1,
    "Unknown commit outcome retains uploaded bytes",
  );
  f.hooks.reconciliationError = false;
  f.advance(151_000);
  await f.handler(request());
  assert.equal(f.objects.size, 1);
  assert.equal(notices(f).length, 1);

  for (const mutate of [
    (state) =>
      state.data.set("site_settings/semester_active", {
        semesterId: "2027-1",
        revision: 4,
      }),
    (state) => state.data.set("users/teacher", { role: "student" }),
  ]) {
    f = fixture();
    f.hooks.beforeSave = async () => mutate(f);
    await assert.rejects(f.handler(request()), (error) =>
      ["failed-precondition", "permission-denied"].includes(error.code),
    );
    assert.equal(f.objects.size, 0);
    assert.equal(notices(f).length, 0);
  }
  console.log(
    "School banner registration: validation, authority, semester, storage, replay, concurrent takeover and compensation passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
