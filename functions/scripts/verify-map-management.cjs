const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const map = require("../mapManagement");
const root = "years/2026/semesters/2/map_resources";
const document = {
  title: "한국사",
  category: "한국사",
  type: "google",
  googleQuery: "한반도",
  sortOrder: 1,
};
const scope = { semesterId: "2026-2", expectedSemesterRevision: 4 };
const actor = { actorUid: "teacher-one", actorRole: "teacher" };
const initial = () => ({
  "site_settings/semester_active": { semesterId: "2026-2", revision: 4 },
  "semester_manifests/2026-2": { status: "ACTIVE", revision: 4 },
  [`${root}/one`]: {
    ...document,
    contentRevision: 2,
    preservedLegacy: { note: "공유 원본" },
  },
});
class Store {
  constructor(seed = initial()) {
    this.docs = new Map(Object.entries(seed));
  }
  async run(fn) {
    const staged = new Map(this.docs);
    let written = false;
    const get = async (path) => {
      assert.equal(written, false, "all reads must precede writes");
      return { path, exists: staged.has(path), data: staged.get(path) || null };
    };
    const transaction = {
      get,
      getAll: (paths) => Promise.all(paths.map(get)),
      query: async (path, filter = {}) => {
        assert.equal(written, false);
        return [...staged]
          .filter(
            ([key]) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes("/"),
          )
          .slice(0, filter.limit || Infinity)
          .map(([path, data]) => ({ path, exists: true, data }));
      },
      set: (path, value, options) => {
        written = true;
        staged.set(
          path,
          options?.merge ? { ...staged.get(path), ...value } : value,
        );
      },
      create: (path, value) => {
        written = true;
        assert.equal(staged.has(path), false);
        staged.set(path, value);
      },
      delete: (path) => {
        written = true;
        staged.delete(path);
      },
    };
    const result = await fn(transaction);
    this.docs = staged;
    return result;
  }
}
const source = (store, mapId = "one", originScope = "semester") => {
  const data = store.docs.get(
    `${originScope === "semester" ? root : "map_resources"}/${mapId}`,
  );
  return {
    mapId,
    originScope,
    sourceExists: !!data,
    sourceHash: data ? map.fingerprint(data) : "",
    expectedRevision: data?.contentRevision || 0,
  };
};
const run = (store, type, payload, who = actor) =>
  store.run((transaction) =>
    map.createMapCommandAdapter({ now: () => 1000 }).apply({
      transaction,
      commandType: type,
      payload: map.normalizeMapPayload(type, { ...scope, ...payload }),
      actor: who,
      commandId: randomUUID(),
      timestamp: 123,
    }),
  );
const row = (store, mapId = "one", originScope = "semester") => ({
  ...source(store, mapId, originScope),
  document: { ...document, title: "수정된 지도" },
  assetUploadIds: [],
});
const rejected = async (fn, reason) =>
  assert.rejects(fn, (error) => error.details?.reason === reason);
async function main() {
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    console.log(`PASS ${name}`);
    count++;
  };
  await test("metadata CAS and unknown legacy fields survive", async () => {
    const store = new Store();
    const old = row(store);
    const result = await run(store, "saveMapResources", { resources: [old] });
    const next = store.docs.get(`${root}/one`);
    assert.equal(next.contentRevision, 3);
    assert.deepEqual(next.preservedLegacy, { note: "공유 원본" });
    assert.equal(result.result.resources[0].sourceHash, map.fingerprint(next));
    assert.equal(result.result.resources[0].originScope, "semester");
    await rejected(
      () => run(store, "saveMapResources", { resources: [old] }),
      "MAP_CONTENT_CONFLICT",
    );
  });
  await test("full source hash catches unknown-field concurrent mutation", async () => {
    const store = new Store();
    const saved = row(store);
    store.docs.set(`${root}/one`, {
      ...store.docs.get(`${root}/one`),
      extra: "changed",
    });
    await rejected(
      () => run(store, "saveMapResources", { resources: [saved] }),
      "MAP_CONTENT_CONFLICT",
    );
  });
  await test("atomic batch rolls back first row on second row conflict", async () => {
    const store = new Store();
    const original = store.docs.get(`${root}/one`);
    await rejected(
      () =>
        run(store, "saveMapResources", {
          resources: [
            row(store),
            {
              ...row(store, "two"),
              sourceExists: true,
              sourceHash: "a".repeat(64),
            },
          ],
        }),
      "MAP_CONTENT_CONFLICT",
    );
    assert.deepEqual(store.docs.get(`${root}/one`), original);
  });
  await test("legacy explicit source only while scoped collection empty", async () => {
    const store = new Store();
    store.docs.set("map_resources/old", { ...document });
    const input = row(store, "old", "legacy");
    await rejected(
      () => run(store, "saveMapResources", { resources: [input] }),
      "MAP_LEGACY_SOURCE_CHANGED",
    );
    store.docs.delete(`${root}/one`);
    await run(store, "saveMapResources", { resources: [input] });
    assert.equal(store.docs.get("map_resources/old").contentRevision, 1);
    assert.equal(store.docs.has(`${root}/old`), false);
  });
  await test("missing source cannot be recreated from revision zero", async () => {
    const store = new Store();
    await rejected(
      () =>
        run(store, "saveMapResources", {
          resources: [
            {
              ...row(store),
              expectedRevision: 0,
              sourceExists: false,
              sourceHash: "",
            },
          ],
        }),
      "MAP_CONTENT_CONFLICT",
    );
  });
  await test("student and inactive semester denied", async () => {
    const store = new Store();
    await rejected(
      () =>
        run(
          store,
          "saveMapResources",
          { resources: [row(store)] },
          { actorUid: "student", actorRole: "student" },
        ),
      "MAP_MANAGE_REQUIRED",
    );
    store.docs.set("semester_manifests/2026-2", {
      status: "ARCHIVED",
      revision: 4,
    });
    await rejected(
      () => run(store, "saveMapResources", { resources: [row(store)] }),
      "MAP_SEMESTER_NOT_ACTIVE",
    );
  });
  await test("answer fields cannot enter metadata command", async () => {
    const store = new Store();
    const input = row(store);
    input.document.pdfBlanks = [];
    await rejected(
      () => run(store, "saveMapResources", { resources: [input] }),
      "MAP_PAYLOAD_INVALID",
    );
  });
  await test("foreign/unverified/expired tickets cannot attach", async () => {
    for (const override of [
      { ownerUid: "other" },
      { status: "PENDING" },
      { expiresAtMs: 999 },
      { mapId: "other" },
    ]) {
      const store = new Store();
      const input = row(store);
      input.assetUploadIds = ["upload-one"];
      store.docs.set("map_asset_uploads/upload-one", {
        ...scope,
        ...source(store),
        ownerUid: actor.actorUid,
        status: "VERIFIED",
        expiresAtMs: 2000,
        byteSize: 10,
        ...override,
      });
      await rejected(
        () => run(store, "saveMapResources", { resources: [input] }),
        "MAP_ASSET_NOT_READY",
      );
    }
  });
  await test("arbitrary attachment URLs are rejected", async () => {
    const store = new Store();
    const input = row(store);
    Object.assign(input.document, {
      type: "image",
      fileUrl: "https://example.org/a.png",
      imageUrl: "https://example.org/a.png",
      storagePath: "arbitrary",
    });
    await rejected(
      () => run(store, "saveMapResources", { resources: [input] }),
      "MAP_ASSET_KIND_INVALID",
    );
  });
  await test("verified original and exact source-bound page atomically attach", async () => {
    const store = new Store();
    const input = row(store);
    const ticket = {
      ...scope,
      ...source(store),
      ownerUid: actor.actorUid,
      status: "VERIFIED",
      expiresAtMs: 2000,
      byteSize: 10,
    };
    store.docs.set("map_asset_uploads/pdf-one", {
      ...ticket,
      uploadId: "pdf-one",
      kind: "PDF",
      url: "https://example.org/original.pdf",
      storagePath: "map_uploads/pdf-one/source",
      pageCount: 1,
    });
    store.docs.set("map_asset_uploads/page-one", {
      ...ticket,
      uploadId: "page-one",
      kind: "PAGE",
      url: "https://example.org/page.png",
      sourceUploadId: "pdf-one",
      page: 1,
      width: 100,
      height: 100,
    });
    input.assetUploadIds = ["pdf-one", "page-one"];
    Object.assign(input.document, {
      type: "pdf",
      fileUrl: "https://example.org/original.pdf",
      storagePath: "map_uploads/pdf-one/source",
      pdfPageImages: [
        {
          page: 1,
          imageUrl: "https://example.org/page.png",
          width: 100,
          height: 100,
        },
      ],
    });
    await run(store, "saveMapResources", { resources: [input] });
    assert.equal(
      store.docs.get("map_asset_uploads/pdf-one").status,
      "ATTACHED",
    );
    assert.equal(
      store.docs.get("map_asset_uploads/page-one").status,
      "ATTACHED",
    );
  });
  await test("delete validates exact origin and protects Google built-in", async () => {
    const store = new Store();
    await run(store, "deleteMapResource", source(store));
    assert.equal(store.docs.has(`${root}/one`), false);
    await rejected(
      () =>
        run(store, "deleteMapResource", {
          ...source(store, "google-maps"),
          sourceExists: true,
          sourceHash: "a".repeat(64),
        }),
      "MAP_PAYLOAD_INVALID",
    );
  });
  console.log(`Map management: ${count} checks passed.`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
