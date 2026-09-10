const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createUploadHandler } = require("../lessonAssetTransport");
const bytes = Buffer.from("test-file");
let checks = 0;
const setup = (change = () => {}, sessionError = false, storageError = 0) => {
  const state = {
    "lesson_asset_uploads/upload-one": {
      ownerUid: "teacher",
      storagePath: "lesson_uploads/upload-one/source",
      expiresAtMs: 2000,
      status: "PENDING",
      semesterId: "2026-2",
      expectedSemesterRevision: 1,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: "image/png",
    },
    "users/teacher": { role: "teacher" },
    "site_settings/semester_active": { semesterId: "2026-2", revision: 1 },
    "semester_manifests/2026-2": { status: "ACTIVE", revision: 1 },
  };
  change(state);
  let writes = 0;
  const snap = (path) => ({ exists: !!state[path], data: () => state[path] });
  const db = {
    doc: (path) => ({ path, get: async () => snap(path) }),
    getAll: async (...refs) => refs.map((ref) => snap(ref.path)),
  };
  const handler = createUploadHandler({
    db,
    now: () => 1000,
    assertSession: async (_, options) => {
      assert.equal(options.highRisk, true);
      assert.equal(options.recentAuth, true);
      if (sessionError)
        throw Object.assign(Error("session"), { code: "unauthenticated" });
      return { uid: "teacher" };
    },
    bucket: {
      file: (path) => ({
        save: async (data, options) => {
          assert.equal(path, "lesson_uploads/upload-one/source");
          assert.deepEqual(data, bytes);
          assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
          assert.equal(options.metadata.metadata.ownerUid, "teacher");
          writes++;
          if (storageError)
            throw Object.assign(Error("storage"), { code: storageError });
        },
      }),
    },
  });
  return {
    handler,
    writes: () => writes,
    request: {
      auth: { token: { email: "teacher@example.test" } },
      data: { uploadId: "upload-one", contentBase64: bytes.toString("base64") },
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
  const session = setup(() => {}, true);
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
    const test = setup(
      (s) => (s["lesson_asset_uploads/upload-one"].status = status),
    );
    const result = await test.handler(test.request);
    assert.equal(result.accepted, true);
    assert.equal(result.replayed, status !== "PENDING");
    assert.equal(test.writes(), status === "PENDING" ? 1 : 0);
    checks++;
  }
  const replay = setup(() => {}, false, 412);
  assert.equal((await replay.handler(replay.request)).replayed, true);
  checks++;
  const failed = setup(() => {}, false, 503);
  await assert.rejects(failed.handler(failed.request), { code: 503 });
  checks++;
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
