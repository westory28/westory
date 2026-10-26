const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const maps = require("../mapManagement");

const now = 1800000000000;
const scope = { semesterId: "2026-2", expectedSemesterRevision: 3 };
const actor = { actorUid: "map-teacher-fixture", actorRole: "teacher" };
const root = "years/2026/semesters/2/map_resources";
const source = {
  mapId: "map-fixture",
  originScope: "semester",
  expectedRevision: 0,
  sourceExists: false,
  sourceHash: "",
};
const main = {
  uploadId: "pdf-fixture",
  kind: "PDF",
  storagePath: "map_uploads/pdf-fixture/source",
  url: "https://example.test/pdf",
  pageCount: 1,
  byteSize: 100,
};
const page = {
  uploadId: "page-fixture",
  kind: "PAGE",
  storagePath: "map_uploads/page-fixture/source",
  url: "https://example.test/page",
  sourceUploadId: main.uploadId,
  page: 1,
  width: 1785,
  height: 2526,
  byteSize: 100,
};

function fixture() {
  const docs = new Map([
    [
      "site_settings/semester_active",
      { semesterId: scope.semesterId, revision: 3 },
    ],
    ["semester_manifests/2026-2", { status: "ACTIVE", revision: 3 }],
    ...[main, page].map((asset) => [
      `map_asset_uploads/${asset.uploadId}`,
      {
        ...asset,
        ...scope,
        ...source,
        ownerUid: actor.actorUid,
        status: "VERIFIED",
        expiresAtMs: now + 3600000,
      },
    ]),
  ]);
  const writes = [];
  const snapshot = (p) => ({ path: p, exists: docs.has(p), data: docs.get(p) });
  const transaction = {
    get: async (p) => {
      assert.equal(writes.length, 0, "transaction reads precede writes");
      return snapshot(p);
    },
    getAll: async (paths) => Promise.all(paths.map((p) => transaction.get(p))),
    query: async (p) =>
      [...docs.keys()]
        .filter(
          (key) =>
            key.startsWith(`${p}/`) && !key.slice(p.length + 1).includes("/"),
        )
        .map(snapshot),
    set: (p, data, options) => {
      writes.push({ operation: "set", path: p });
      docs.set(p, options?.merge ? { ...docs.get(p), ...data } : data);
    },
    delete: (p) => {
      writes.push({ operation: "delete", path: p });
      docs.delete(p);
    },
    create: (p, data) => {
      assert(!docs.has(p));
      transaction.set(p, data);
    },
  };
  const document = {
    title: "지도",
    category: "한국사",
    type: "pdf",
    sortOrder: 1,
    fileUrl: main.url,
    storagePath: main.storagePath,
    pdfPageImages: [{ page: 1, imageUrl: page.url, width: 952, height: 1348 }],
    pdfRegions: [
      { label: "위치", page: 1, left: 20, top: 30, width: 40, height: 20 },
    ],
  };
  const payload = {
    ...scope,
    resources: [
      { ...source, document, assetUploadIds: [main.uploadId, page.uploadId] },
    ],
  };
  const execute = (type = "saveMapResources", raw = payload) =>
    maps.createMapCommandAdapter({ now: () => now }).apply({
      transaction,
      commandType: type,
      payload: maps.normalizeMapPayload(type, raw),
      actor,
      commandId: "fixture-command",
      timestamp: new Date(now),
    });
  return { docs, writes, document, payload, execute };
}

function loadClient(handler) {
  const sourcePath = path.resolve(
    __dirname,
    "../../../src/lib/mapManagementCommands.ts",
  );
  const javascript = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports = {};
  const auth = {
    currentUser: {
      uid: actor.actorUid,
      getIdTokenResult: async () => ({ claims: { auth_time: 123 } }),
    },
  };
  const calls = [];
  const firebase = {
    auth,
    getHttpsCallable: async (name) => async (input) => {
      calls.push({ name, input });
      if (name === "openApplicationSession")
        return {
          data: {
            status: "active",
            authTime: 123,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            revision: "a".repeat(64),
          },
        };
      return { data: await handler(name, input) };
    },
  };
  // Exercise the real session gate against the same isolated auth/transport
  // fixture; a pass-through session mock would conceal ownership regressions.
  const applicationSession = {};
  const sessionSourcePath = path.resolve(__dirname, "../../../src/lib/applicationSession.ts");
  const sessionJavascript = ts.transpileModule(fs.readFileSync(sessionSourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(sessionJavascript, {
    exports: applicationSession,
    require(name) {
      if (name === "./firebase") return firebase;
      if (name === "./semesterArchive") return { isSemesterArchive: false };
      throw new Error(`Unexpected session dependency: ${name}`);
    },
  });
  vm.runInNewContext(javascript, {
    exports,
    crypto: crypto.webcrypto,
    TextEncoder,
    Uint8Array,
    Blob,
    Date,
    btoa,
    require(name) {
      if (name === "./firebase") return firebase;
      if (name === "./applicationSession") return applicationSession;
      if (name === "./appCheck")
        return { ensureWestoryAppCheck: async () => {} };
      if (name === "./lessonManagement")
        return { getLessonCommandScope: async () => scope };
      if (name === "./brandWatermark")
        return { watermarkImageBlob: async () => {
          throw new Error("PDF transport checks must not invoke image watermarking");
        } };
      throw new Error(`Unexpected client dependency: ${name}`);
    },
  });
  return { api: exports, calls, auth };
}

(async () => {
  let checks = 0;
  for (const size of [
    [952, 1348],
    [1785, 2526],
    [953, 1348],
  ]) {
    const f = fixture();
    Object.assign(f.document.pdfPageImages[0], {
      width: size[0],
      height: size[1],
    });
    await f.execute();
    assert.deepEqual(
      f.docs.get(`${root}/${source.mapId}`).pdfPageImages[0],
      f.document.pdfPageImages[0],
    );
    assert.equal(
      f.docs.get(`map_asset_uploads/${main.uploadId}`).status,
      "ATTACHED",
    );
    checks++;
  }
  for (const change of [
    (f) => (f.document.pdfPageImages[0].width = 1200),
    (f) => (f.document.pdfPageImages[0].width = 0),
    (f) =>
      Object.assign(f.document.pdfPageImages[0], {
        width: 100000,
        height: 100000,
      }),
    (f) => (f.docs.get(`map_asset_uploads/${page.uploadId}`).width = 0),
    (f) =>
      (f.docs.get(`map_asset_uploads/${page.uploadId}`).sourceUploadId =
        "another-pdf"),
    (f) => (f.docs.get(`map_asset_uploads/${page.uploadId}`).page = 2),
    (f) =>
      (f.document.pdfPageImages[0].imageUrl =
        "https://example.test/unverified"),
    (f) =>
      (f.docs.get(`map_asset_uploads/${page.uploadId}`).ownerUid =
        "another-teacher"),
    (f) => (f.docs.get("site_settings/semester_active").revision = 4),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(async () => f.execute());
    assert.equal(f.writes.length, 0);
    checks++;
  }
  {
    const f = fixture();
    const prior = {
      ...f.document,
      pdfBlanks: [
        {
          id: "historical-blank",
          answer: "보존",
          page: 1,
          left: 10,
          top: 20,
          width: 30,
          height: 40,
        },
      ],
      answerOptions: ["보존"],
      contentRevision: 5,
      unknownLegacyMetadata: { keep: true },
    };
    f.docs.set(`${root}/${source.mapId}`, prior);
    f.payload.resources[0] = {
      ...source,
      sourceExists: true,
      expectedRevision: 5,
      sourceHash: maps.fingerprint(prior),
      document: { ...f.document, title: "새 제목" },
      assetUploadIds: [],
    };
    await f.execute();
    const saved = f.docs.get(`${root}/${source.mapId}`);
    assert.deepEqual(saved.pdfBlanks, prior.pdfBlanks);
    assert.deepEqual(saved.answerOptions, prior.answerOptions);
    assert.deepEqual(saved.unknownLegacyMetadata, prior.unknownLegacyMetadata);
    checks++;
  }
  for (const mismatch of ["revision", "hash", "legacy-shadow"]) {
    const f = fixture();
    const legacy = mismatch === "legacy-shadow";
    const raw = { ...f.document, contentRevision: 2 };
    const originScope = legacy ? "legacy" : "semester";
    f.docs.set(`${legacy ? "map_resources" : root}/${source.mapId}`, raw);
    if (legacy) f.docs.set(`${root}/other-map`, { title: "현재 자료" });
    f.payload.resources[0] = {
      ...source,
      originScope,
      sourceExists: true,
      expectedRevision: mismatch === "revision" ? 1 : 2,
      sourceHash: mismatch === "hash" ? "0".repeat(64) : maps.fingerprint(raw),
      document: f.document,
      assetUploadIds: [],
    };
    await assert.rejects(
      async () => f.execute(),
      (error) =>
        error.details?.reason ===
        (legacy ? "MAP_LEGACY_SOURCE_CHANGED" : "MAP_CONTENT_CONFLICT"),
    );
    assert.equal(f.writes.length, 0);
    checks++;
  }
  {
    const f = fixture();
    f.docs.set(`map_resources/${source.mapId}`, f.document);
    f.payload.resources[0] = {
      ...source,
      originScope: "legacy",
      sourceExists: true,
      sourceHash: maps.fingerprint(f.document),
      document: { ...f.document, title: "명시한 이전 경로" },
      assetUploadIds: [],
    };
    await f.execute();
    assert.equal(
      f.docs.get(`map_resources/${source.mapId}`).title,
      "명시한 이전 경로",
    );
    assert(!f.docs.has(`${root}/${source.mapId}`));
    checks++;
  }
  {
    const f = fixture();
    f.docs.set(`${root}/${source.mapId}`, f.document);
    await f.execute("deleteMapResource", {
      ...scope,
      ...source,
      sourceExists: true,
      sourceHash: maps.fingerprint(f.document),
    });
    assert.deepEqual(f.writes, [
      { operation: "delete", path: `${root}/${source.mapId}` },
    ]);
    assert(f.docs.has(`map_asset_uploads/${main.uploadId}`));
    checks++;
  }
  {
    let deletedAsset = false;
    const attached = {
      status: "ATTACHED",
      expiresAtMs: now - 1,
      storagePath: main.storagePath,
    };
    const snapshot = { id: main.uploadId, ref: {}, data: () => attached };
    const cleanup = maps.createExpiredMapUploadCleanup({
      now: () => now,
      db: {
        collection: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ docs: [snapshot] }) }),
          }),
        }),
        runTransaction: async (callback) =>
          callback({ get: async () => snapshot, set: () => {} }),
      },
      bucket: {
        file: () => {
          deletedAsset = true;
          throw new Error("attached assets are immutable");
        },
      },
    });
    await cleanup();
    assert.equal(deletedAsset, false);
    checks++;
  }
  {
    const client = loadClient(() => {
      throw new Error("No network expected");
    });
    const raw = {
      title: "원문",
      timestamp: { seconds: 12, nanoseconds: 34, toMillis: () => 12000 },
      extra: { z: 1, a: 2 },
    };
    const ref = await client.api.createMapSourceRef(
      source.mapId,
      "semester",
      raw,
    );
    assert.equal(ref.sourceHash, maps.fingerprint(raw));
    assert.throws(() =>
      client.api.validateMapUploadFile(
        new Blob(["x"], { type: "image/svg+xml" }),
        "IMAGE",
      ),
    );
    assert.equal(
      client.api.validateMapUploadFile(
        new Blob(["x"], { type: "image/webp" }),
        "IMAGE",
      ),
      "image/webp",
    );
    checks++;
  }
  {
    for (const signedIn of [false, true]) {
      const client = loadClient(() => {
        throw new Error("Invalid authentication must not reach a command");
      });
      if (signedIn) client.auth.currentUser.getIdTokenResult = async () => ({ claims: { auth_time: 0 } });
      else client.auth.currentUser = null;
      await assert.rejects(client.api.saveMapResources({}, [{ source, document: fixture().document }]));
      assert.equal(client.calls.length, 0, "Missing owner and invalid session tokens fail before transport");
      checks++;
    }
  }
  {
    let savedPayload;
    const client = loadClient(async (name, input) => {
      if (name === "executeCommand") {
        savedPayload = input.payload;
        throw Object.assign(new Error("lost response"), {
          code: "functions/unavailable",
        });
      }
      assert.equal(name, "getCommandStatus");
      return {
        status: "SUCCEEDED",
        result: {
          resources: [
            {
              ...source,
              contentRevision: 1,
              sourceExists: true,
              sourceHash: "b".repeat(64),
            },
          ],
        },
      };
    });
    const document = {
      ...fixture().document,
      id: source.mapId,
      description: "",
      pdfBlanks: [{ answer: "must not send" }],
      answerOptions: ["must not send"],
      storageScope: "legacy",
    };
    const saved = await client.api.saveMapResources({}, [{ source, document }]);
    assert.equal(saved[0].expectedRevision, 1);
    assert(!Object.hasOwn(savedPayload.resources[0].document, "pdfBlanks"));
    assert(!Object.hasOwn(savedPayload.resources[0].document, "answerOptions"));
    assert(!Object.hasOwn(savedPayload.resources[0].document, "id"));
    assert.equal(client.calls[0].name, "openApplicationSession");
    assert.deepEqual({ ...client.calls.find((call) => call.name === "executeCommand").input._session }, {
      authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2, revision: "a".repeat(64),
    });
    checks++;
  }
  {
    let preparations = 0,
      attempts = 0;
    const client = loadClient(async (name, input) => {
      if (name === "executeCommand") {
        preparations++;
        assert.equal(input.commandType, "prepareMapAssetUpload");
        return {
          status: "SUCCEEDED",
          result: {
            uploadId: main.uploadId,
            storagePath: main.storagePath,
            expiresAtMs: Date.now() + 3600000,
          },
        };
      }
      assert.equal(name, "uploadMapAssetContent");
      assert.equal(input.uploadId, main.uploadId);
      if (++attempts <= 2)
        throw Object.assign(new Error("lost upload response"), {
          code: "functions/unavailable",
        });
      return {
        uploadId: main.uploadId,
        storagePath: main.storagePath,
        url: main.url,
      };
    });
    const input = {
      source,
      kind: "PDF",
      file: new Blob(["%PDF-fixture"], { type: "application/pdf" }),
      originalName: "fixture.pdf",
    };
    await assert.rejects(client.api.uploadMapAsset({}, input));
    const result = await client.api.uploadMapAsset({}, input);
    assert.equal(result.url, main.url);
    assert.equal(preparations, 1);
    assert.equal(attempts, 3);
    checks++;
  }
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/pages/teacher/MapResources.tsx"),
    "utf8",
  );
  assert(
    !/\b(?:uploadBytes|deleteObject|setDoc|deleteDoc|fallbackScope)\b/.test(
      pageSource,
    ),
  );
  checks++;
  console.log(
    `PASS map management: ${checks} coordinate, ownership, conflict, immutable asset and client recovery checks; network 0`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
