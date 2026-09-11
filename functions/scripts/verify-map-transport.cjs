const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const {
  createMapUploadHandler,
  createExpiredMapUploadCleanup,
  fingerprint,
} = require("../mapManagement");
const bytes = Buffer.from("test-image");
const hash = createHash("sha256").update(bytes).digest("hex");
const mapPath = "years/2026/semesters/2/map_resources/one";
const docData = { title: "지도", type: "image", contentRevision: 2 };
const build = () => {
  const documents = new Map(
    Object.entries({
      "map_asset_uploads/upload-one": {
        ownerUid: "teacher",
        storagePath: "map_uploads/upload-one/source",
        mapPath,
        uploadId: "upload-one",
        kind: "IMAGE",
        byteSize: bytes.length,
        sha256: hash,
        contentType: "image/png",
        status: "PENDING",
        expiresAtMs: 2000000,
        downloadToken: "test-only",
        semesterId: "2026-2",
        expectedSemesterRevision: 4,
        sourceExists: true,
        expectedRevision: 2,
        sourceHash: fingerprint(docData),
        originScope: "semester",
      },
      "users/teacher": { role: "teacher" },
      "site_settings/semester_active": { semesterId: "2026-2", revision: 4 },
      "semester_manifests/2026-2": { status: "ACTIVE", revision: 4 },
      [mapPath]: docData,
    }),
  );
  const objects = new Map();
  let saves = 0;
  const put = (ref, value, options) => {
    const next = options?.merge
      ? { ...documents.get(ref.path), ...value }
      : { ...value };
    for (const name of Object.keys(next))
      if (next[name]?.isEqual?.(FieldValue.delete())) delete next[name];
    documents.set(ref.path, next);
  };
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    ref: db.doc(path),
    exists: documents.has(path),
    data: () => documents.get(path),
  });
  const db = {
    doc: (path) => ({
      path,
      set: async (value, options) => put({ path }, value, options),
      delete: async () => documents.delete(path),
    }),
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async (fn) => {
      const staged = new Map(documents);
      try {
        return await fn({
          getAll: db.getAll,
          get: async (ref) => snapshot(ref.path),
          set: put,
        });
      } catch (error) {
        documents.clear();
        for (const entry of staged) documents.set(...entry);
        throw error;
      }
    },
    collection: (path) => ({
      where: (field, op, value) => ({
        limit: (limit) => ({
          get: async () => ({
            docs: [...documents]
              .filter(
                ([key, data]) =>
                  key.startsWith(`${path}/`) &&
                  typeof data[field] === "number" &&
                  data[field] <= value,
              )
              .slice(0, limit)
              .map(([key]) => snapshot(key)),
          }),
        }),
      }),
    }),
  };
  const bucket = {
    name: "test-bucket",
    file: (path, options) => ({
      save: async (content, settings) => {
        assert.equal(settings.preconditionOpts.ifGenerationMatch, 0);
        if (objects.has(path)) throw { code: 412 };
        saves++;
        objects.set(path, {
          bytes: content,
          metadata: { generation: "1", metadata: settings.metadata.metadata },
        });
      },
      download: async () => [objects.get(path).bytes],
      getMetadata: async () => {
        if (!objects.has(path)) throw { code: 404 };
        return [objects.get(path).metadata];
      },
      delete: async () => {
        assert.equal(options.generation, objects.get(path).metadata.generation);
        objects.delete(path);
      },
    }),
  };
  const assertSession = async (_req, options) => {
    assert.deepEqual(options, { recentAuth: true, highRisk: true });
    return { uid: "teacher" };
  };
  return {
    db,
    bucket,
    documents,
    objects,
    assertSession,
    saves: () => saves,
    ticket: () => documents.get("map_asset_uploads/upload-one"),
  };
};
const request = {
  auth: { uid: "teacher", token: {} },
  data: { uploadId: "upload-one", contentBase64: bytes.toString("base64") },
};
const handler = (env) =>
  createMapUploadHandler({
    ...env,
    now: () => 1000000,
    imageMetadata: async () => ({ format: "png", width: 20, height: 10 }),
  });
const rejected = (fn) => assert.rejects(fn);
async function main() {
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    count++;
  };
  await test("owner-bound immutable image upload verifies real metadata", async () => {
    const env = build();
    const result = await handler(env)(request);
    assert.equal(env.ticket().status, "VERIFIED");
    assert.equal(result.width, 20);
    assert.equal(result.height, 10);
    await handler(env)(request);
    assert.equal(env.saves(), 1);
  });
  await test("cross-owner, expired, student and inactive uploads denied", async () => {
    for (const mutation of [
      (env) => (env.ticket().ownerUid = "other"),
      (env) => (env.ticket().expiresAtMs = 0),
      (env) => env.documents.set("users/teacher", { role: "student" }),
      (env) =>
        env.documents.set("semester_manifests/2026-2", {
          status: "ARCHIVED",
          revision: 4,
        }),
    ]) {
      const env = build();
      mutation(env);
      await rejected(() => handler(env)(request));
      assert.equal(env.saves(), 0);
    }
  });
  await test("hash, byte-size and source revision mismatch deny before storage", async () => {
    for (const mutation of [
      (env) => (env.ticket().sha256 = "a".repeat(64)),
      (env) => env.ticket().byteSize++,
      (env) => env.documents.set(mapPath, { ...docData, contentRevision: 3 }),
    ]) {
      const env = build();
      mutation(env);
      await rejected(() => handler(env)(request));
      assert.equal(env.saves(), 0);
    }
  });
  await test("declared image type mismatch marks failed ticket", async () => {
    const env = build();
    env.ticket().contentType = "image/jpeg";
    await rejected(() => handler(env)(request));
    assert.equal(env.ticket().status, "FAILED");
    assert.equal(env.saves(), 0);
  });
  await test("expired unattached cleanup removes exact owned object after grace", async () => {
    const env = build();
    await handler(env)(request);
    env.ticket().expiresAtMs = 1000;
    await createExpiredMapUploadCleanup({ ...env, now: () => 1000000 })();
    assert.equal(env.objects.size, 0);
    assert.equal(env.documents.has("map_asset_uploads/upload-one"), false);
  });
  await test("legacy attached expiry removed without deleting object", async () => {
    const env = build();
    await handler(env)(request);
    env.ticket().status = "ATTACHED";
    env.ticket().expiresAtMs = 1000;
    await createExpiredMapUploadCleanup({ ...env, now: () => 1000000 })();
    assert.equal(env.objects.size, 1);
    assert.equal(env.ticket().expiresAtMs, undefined);
  });
  await test("metadata mismatch quarantines ticket without repeated queue starvation", async () => {
    const env = build();
    await handler(env)(request);
    env.ticket().expiresAtMs = 1000;
    env.objects.get(env.ticket().storagePath).metadata.metadata.ownerUid =
      "other";
    await createExpiredMapUploadCleanup({ ...env, now: () => 1000000 })();
    assert.equal(env.objects.size, 1);
    assert.equal(env.ticket().status, "CLEANUP_BLOCKED");
    assert.equal(env.ticket().expiresAtMs, undefined);
  });
  await test("late immutable object recreation stays tracked during grace", async () => {
    const env = build();
    await handler(env)(request);
    env.ticket().expiresAtMs = 999000;
    await createExpiredMapUploadCleanup({ ...env, now: () => 1000000 })();
    assert.equal(env.ticket().status, "EXPIRED");
    assert.equal(env.objects.size, 0);
    await rejected(() => handler(env)(request));
  });
  console.log(`Map transport: ${count} checks passed.`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
