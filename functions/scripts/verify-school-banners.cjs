const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  createRegisterSchoolBannerHandler,
  createManageSchoolBannersHandler,
} = require("../schoolBanners");

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
    collection: (path) => ({
      path,
      collection: true,
      where: (field, operator, value) => ({
        path,
        collection: true,
        filter: { field, value },
        limit: (count) => ({
          path,
          collection: true,
          filter: { field, value },
          count,
        }),
      }),
    }),
    runTransaction: (callback) => {
      const operation = queue.then(async () => {
        const pending = new Map(data),
          writes = [];
        const snapshot = (ref) => {
          if (ref.collection) {
            const docs = [...pending]
              .filter(
                ([path, value]) =>
                  path.startsWith(ref.path + "/") &&
                  path.split("/").length === ref.path.split("/").length + 1 &&
                  (!ref.filter || value[ref.filter.field] === ref.filter.value),
              )
              .slice(0, ref.count || Infinity)
              .map(([path, value]) => ({
                id: path.split("/").at(-1),
                exists: true,
                data: () => value,
              }));
            return { docs, empty: !docs.length };
          }
          return {
            exists: pending.has(ref.path),
            data: () => pending.get(ref.path),
          };
        };
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
          delete: (ref) => {
            pending.delete(ref.path);
            writes.push(["delete", ref.path, {}]);
          },
        };
        const result = await callback(transaction);
        const publishing = writes.some(([, path]) => /\/notices\//.test(path));
        if (publishing && hooks.commitError) {
          hooks.commitError = false;
          throw Error("Firestore unavailable");
        }
        if (
          hooks.reconciliationError &&
          writes.some(([, , value]) => value.status === "FAILED")
        )
          throw Error("Reconciliation unavailable");
        for (const [type, path] of writes) {
          if (type === "delete") data.delete(path);
          else data.set(path, pending.get(path));
        }
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
  const dependencies = {
    db,
    bucket,
    now: () => clock,
    uuid: () => `attempt-${++nextId}`,
    assertSession: async (request, options) => {
      sessionChecks++;
      assert.deepEqual(options, { recentAuth: false, highRisk: false });
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
  };
  const handler = createRegisterSchoolBannerHandler(dependencies);
  const manage = createManageSchoolBannersHandler({
    ...dependencies,
    assertSession: (request, options) => {
      assert.deepEqual(options, { recentAuth: true, highRisk: true });
      return dependencies.assertSession(request, { recentAuth: false, highRisk: false });
    },
  });
  return {
    data,
    objects,
    hooks,
    handler,
    manage,
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
  // Publication metadata is validated on the server and survives image-only/title edits.
  const noticePath = (id) => `years/2026/semesters/2/notices/${id}`;
  for (const invalid of [
    { publishAt: "not-a-date" },
    { publishAt: "2028-02-30T00:00:00Z" },
    { publishAt: "2028-01-01T24:00:00Z" },
    { publishAt: "2028-01-01T09:00:00" },
    { publishAt: "2028-01-02T00:00:00Z", expiresAt: "2028-01-01T00:00:00Z" },
    { publishAt: "2028-01-01T00:00:00Z", expiresAt: "2028-01-01T00:00:00Z" },
    { category: "dday", targetDate: null },
    { category: "dday", targetDate: "2028-02-30" },
    { targetType: "class", targetClass: null },
    { targetClass: "../users" },
    { developerLogPostId: "../../secret" },
    { noticeId: "a", expectedRevision: -1 },
  ]) {
    f = fixture();
    await assert.rejects(f.handler(request(invalid)), code("invalid-argument"));
    assert.equal(f.objects.size, 0);
    assert.equal(notices(f).length, 0);
  }
  f = fixture();
  await assert.rejects(
    f.handler(request({ developerLogPostId: "missing" })),
    code("not-found"),
  );
  f.data.set("site_settings/developer_logs/items/release-note", {
    title: "개발 일지",
  });
  const scheduled = await f.handler(
    request({
      publishAt: "2028-01-01T09:00:00+09:00",
      expiresAt: "2028-02-01T00:00:00Z",
      category: "dday",
      targetDate: "2028-01-15",
      targetType: "class",
      targetClass: "1-1",
      developerLogPostId: "release-note",
    }),
  );
  let current = f.data.get(noticePath(scheduled.noticeId));
  assert.equal(
    current.publishAt.toDate().toISOString(),
    "2028-01-01T00:00:00.000Z",
  );
  const createdAt = current.createdAt,
    originalOrder = current.noticeOrder;
  const editRequest = request({
    requestId: "request-edit-1",
    noticeId: scheduled.noticeId,
    expectedRevision: 1,
    contentBase64: undefined,
    title: "안내 수정",
  });
  const edited = await f.handler(editRequest);
  assert.equal(edited.revision, 2);
  assert.equal(edited.imageStoragePath, scheduled.imageStoragePath);
  assert.equal(f.objects.size, 1);
  current = f.data.get(noticePath(edited.noticeId));
  assert.equal(current.targetType, "class");
  assert.equal(current.targetClass, "1-1");
  assert.equal(current.category, "dday");
  assert.equal(current.targetDate, "2028-01-15");
  assert.equal(current.developerLogPostId, "release-note");
  assert.equal(current.createdAt, createdAt);
  assert.equal(current.noticeOrder, originalOrder);
  assert.equal((await f.handler(editRequest)).revision, 2);
  await assert.rejects(
    f.handler(
      request({ ...editRequest.data, requestId: "request-edit-stale" }),
    ),
    code("aborted"),
  );
  const replaceRequest = request({
    requestId: "request-replace-1",
    noticeId: edited.noticeId,
    expectedRevision: 2,
    category: "normal",
    publishAt: null,
    expiresAt: null,
    targetType: "common",
    developerLogPostId: null,
  });
  f.hooks.deleteError = true;
  const replacementImage = await f.handler(replaceRequest);
  assert.equal(replacementImage.revision, 3);
  assert.equal(f.objects.size, 2);
  current = f.data.get(noticePath(edited.noticeId));
  assert.equal(current.category, "normal");
  assert.equal(current.targetDate, null);
  assert.equal(current.targetClass, null);
  assert.equal(current.expiresAt, null);
  assert.equal(current.developerLogPostId, null);
  f.hooks.deleteError = false;
  await f.handler(replaceRequest);
  assert.equal(f.objects.size, 1);
  assert(!f.objects.has(scheduled.imageStoragePath));
  f.hooks.commitError = true;
  await assert.rejects(
    f.handler(
      request({
        requestId: "request-edit-failure",
        noticeId: edited.noticeId,
        expectedRevision: 3,
      }),
    ),
    code("unavailable"),
  );
  assert.equal(f.data.get(noticePath(edited.noticeId)).revision, 3);
  assert(f.objects.has(replacementImage.imageStoragePath));
  assert.equal(f.objects.size, 1);

  // Legacy documents without a revision keep existing optional data and creation/order fields.
  const legacy = {
    imageUrl: "https://example.test/legacy.webp",
    imageStoragePath: "unrelated/shared.webp",
    category: "normal",
    content: "기존 배너",
    targetType: "common",
    targetDate: null,
    noticeOrder: 17,
    createdAt: "legacy-created",
  };
  f.data.set(noticePath("legacy"), legacy);
  const legacyEdit = await f.handler(
    request({
      requestId: "request-legacy-edit",
      noticeId: "legacy",
      expectedRevision: 0,
      contentBase64: undefined,
    }),
  );
  assert.equal(legacyEdit.revision, 1);
  assert.equal(legacyEdit.imageUrl, legacy.imageUrl);
  assert.equal(f.data.get(noticePath("legacy")).createdAt, "legacy-created");
  assert.equal(f.data.get(noticePath("legacy")).noticeOrder, 17);

  // Legacy all-target and start-less expired banners remain editable without republishing.
  f = fixture();
  const legacyExpiry = "2026-01-01T00:00:00.000Z";
  for (const start of [undefined, null]) {
    const id = start === undefined ? "legacy-no-start" : "legacy-null-start";
    f.data.set(noticePath(id), {
      ...legacy,
      targetType: "all",
      targetClass: "1-1",
      expiresAt: legacyExpiry,
      ...(start === null ? { publishAt: null } : {}),
    });
    const edit = request({
      requestId: `request-${id}`,
      noticeId: id,
      expectedRevision: 0,
      contentBase64: undefined,
      targetType: "all",
      publishAt: null,
      expiresAt: legacyExpiry,
    });
    await f.handler(edit);
    const preserved = f.data.get(noticePath(id));
    assert.equal(preserved.targetType, "all");
    assert.equal(preserved.targetClass, null);
    assert.equal(preserved.publishAt, null);
    assert.equal(preserved.expiresAt.toDate().toISOString(), legacyExpiry);
    await f.handler(
      request({
        requestId: `request-${id}-title`,
        noticeId: id,
        expectedRevision: 1,
        contentBase64: undefined,
        title: "문구만 수정",
      }),
    );
    assert.equal(f.data.get(noticePath(id)).publishAt, null);
    await assert.rejects(
      f.handler(
        request({
          requestId: `request-${id}-republish`,
          noticeId: id,
          expectedRevision: 2,
          contentBase64: undefined,
          publishAt: "2027-01-01T00:00:00Z",
          expiresAt: legacyExpiry,
        }),
      ),
      code("invalid-argument"),
    );
    await assert.rejects(
      f.handler(
        request({
          requestId: `request-${id}-new-expiry`,
          noticeId: id,
          expectedRevision: 2,
          contentBase64: undefined,
          publishAt: null,
          expiresAt: "2026-01-02T00:00:00Z",
        }),
      ),
      code("invalid-argument"),
    );
  }
  await assert.rejects(
    f.handler(
      request({
        requestId: "request-new-expired",
        publishAt: null,
        expiresAt: legacyExpiry,
      }),
    ),
    code("invalid-argument"),
  );
  f.data.set(noticePath("explicit-start"), {
    ...legacy,
    publishAt: "2025-01-01T00:00:00Z",
    expiresAt: legacyExpiry,
  });
  await assert.rejects(
    f.handler(
      request({
        requestId: "request-explicit-now",
        noticeId: "explicit-start",
        expectedRevision: 0,
        contentBase64: undefined,
        publishAt: null,
        expiresAt: legacyExpiry,
      }),
    ),
    code("invalid-argument"),
  );

  // Full-set reorder covers scheduled, expired and class banners without touching text notices.
  const manageRequest = (payload, uid = "teacher") => ({
    auth: { uid },
    data: { semesterId: "2026-2", requestId: "manage-00001", ...payload },
  });
  f = fixture();
  const firstBanner = await f.handler(request());
  const secondBanner = await f.handler(
    request({
      requestId: "request-second",
      publishAt: "2028-01-01T00:00:00Z",
      expiresAt: "2028-02-01T00:00:00Z",
      targetType: "class",
      targetClass: "2-3",
    }),
  );
  f.data.set(noticePath("text-only"), { content: "문구 공지", noticeOrder: 8 });
  const reorderPayload = {
    action: "REORDER",
    items: [
      { id: secondBanner.noticeId, revision: 1 },
      { id: firstBanner.noticeId, revision: 1 },
    ],
  };
  await assert.rejects(
    f.manage(manageRequest(reorderPayload, "student")),
    code("permission-denied"),
  );
  await assert.rejects(
    f.manage({ data: manageRequest(reorderPayload).data }),
    code("unauthenticated"),
  );
  await assert.rejects(
    f.manage(
      manageRequest({
        ...reorderPayload,
        items: reorderPayload.items.slice(0, 1),
      }),
    ),
    code("aborted"),
  );
  await assert.rejects(
    f.manage(
      manageRequest({
        ...reorderPayload,
        items: [
          { id: secondBanner.noticeId, revision: 0 },
          reorderPayload.items[1],
        ],
      }),
    ),
    code("aborted"),
  );
  assert.equal(f.data.get(noticePath(firstBanner.noticeId)).revision, 1);
  const ordered = await f.manage(manageRequest(reorderPayload));
  assert.deepEqual(
    ordered.items.map((item) => item.noticeOrder),
    [0, 1],
  );
  assert.equal(f.data.get(noticePath(secondBanner.noticeId)).revision, 2);
  assert.deepEqual(f.data.get(noticePath("text-only")), {
    content: "문구 공지",
    noticeOrder: 8,
  });
  assert.equal((await f.manage(manageRequest(reorderPayload))).replayed, true);
  await assert.rejects(
    f.manage(
      manageRequest({
        ...reorderPayload,
        items: [...reorderPayload.items].reverse(),
      }),
    ),
    code("already-exists"),
  );
  await assert.rejects(
    f.manage(manageRequest({ ...reorderPayload, requestId: "manage-stale" })),
    code("aborted"),
  );
  const deletePayload = {
    requestId: "manage-delete-1",
    action: "DELETE",
    noticeId: firstBanner.noticeId,
    expectedRevision: 2,
  };
  await assert.rejects(
    f.manage(manageRequest({ ...deletePayload, expectedRevision: 1 })),
    code("aborted"),
  );
  f.hooks.commitError = true;
  await assert.rejects(
    f.manage(manageRequest(deletePayload)),
    code("unavailable"),
  );
  assert(f.data.has(noticePath(firstBanner.noticeId)));
  assert(f.objects.has(firstBanner.imageStoragePath));
  f.hooks.lostAck = true;
  f.hooks.deleteError = true;
  const deleted = await f.manage(manageRequest(deletePayload));
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.replayed, true);
  assert(!f.data.has(noticePath(firstBanner.noticeId)));
  assert(f.objects.has(firstBanner.imageStoragePath));
  f.hooks.deleteError = false;
  await f.manage(manageRequest(deletePayload));
  assert(!f.objects.has(firstBanner.imageStoragePath));
  assert(f.data.has(noticePath(secondBanner.noticeId)));

  // A legacy sibling sharing the owner's image keeps that object until the last reference is gone.
  f = fixture();
  const shared = await f.handler(request());
  f.data.set(noticePath("legacy-shared"), {
    imageUrl: shared.imageUrl,
    imageStoragePath: shared.imageStoragePath,
  });
  const deleteOwner = manageRequest({
    action: "DELETE",
    noticeId: shared.noticeId,
    expectedRevision: 1,
  });
  await f.manage(deleteOwner);
  assert(f.objects.has(shared.imageStoragePath));
  await f.manage(
    manageRequest({
      requestId: "manage-delete-shared",
      action: "DELETE",
      noticeId: "legacy-shared",
      expectedRevision: 0,
    }),
  );
  assert(
    f.objects.has(shared.imageStoragePath),
    "Sibling deletion cannot delete another banner's storage path",
  );
  await f.manage(deleteOwner);
  assert.equal(f.objects.size, 0);

  console.log(
    "School banner management: publication, metadata, legacy edits, replacement cleanup, reorder revisions, deletion and shared-image safety passed.",
  );
  console.log(
    "School banner registration: validation, authority, semester, storage, replay, concurrent takeover and compensation passed.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
