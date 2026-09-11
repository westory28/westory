const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Store } = require("./verify-lesson-answers.cjs");
const gateway = require("../commandGateway");
const lesson = require("../lessonManagement");
const root = "years/2026/semesters/2";
const lessonPath = `${root}/lessons/source`;
const treePath = `${root}/curriculum/tree`;
const seed = () => ({
  "site_settings/semester_active": { semesterId: "2026-2", revision: 4 },
  "semester_manifests/2026-2": { revision: 4, status: "ACTIVE" },
  [treePath]: {
    tree: [{ id: "unit-one", title: "수업", children: [] }],
    contentRevision: 3,
  },
  [lessonPath]: {
    unitId: "unit-one",
    title: "수업",
    contentRevision: 2,
    worksheetExamHighlights: [
      {
        id: "point-one",
        page: 1,
        leftRatio: 0.1,
        topRatio: 0.1,
        widthRatio: 0.1,
        heightRatio: 0.1,
      },
    ],
    contentHtml: "[정답]",
    worksheetPageImages: [
      {
        page: 1,
        imageUrl: "https://existing.example/page.png",
        width: 100,
        height: 100,
      },
    ],
    pdfStoragePath: "legacy/file.pdf",
    pdfProcessing: {
      extractionStatus: "ready",
      file: { storagePath: "legacy/file.pdf" },
    },
  },
});
const scope = {
  semesterId: "2026-2",
  expectedSemesterRevision: 4,
  expectedRevision: 2,
};
const payload = () => ({
  ...scope,
  unitId: "unit-one",
  document: { title: "수정" },
  assetUploadIds: [],
});
const setup = (mutate = () => {}) => {
  const data = seed();
  mutate(data);
  const store = new Store(data);
  const core = gateway.createCommandGatewayCore({
    store,
    projectId: "demo-westory-session-lesson-management",
    serverTimestamp: () => 123,
    concreteTimestamp: () => 123,
    assertSession: async (request, options) => {
      assert.deepEqual(options, { recentAuth: true, highRisk: true });
      return {
        uid: request.auth.uid,
        email: request.auth.token.email,
        sessionId: "teacher-session",
        schemaVersion: 2,
        revision: 1,
      };
    },
    authorizeCommand: async ({ request }) => ({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      actorRole: request.auth.uid === "teacher" ? "teacher" : "student",
    }),
    commandAdapters: Object.fromEntries(
      Object.values(lesson.LESSON_COMMAND_TYPES).map((type) => [
        type,
        lesson.createLessonCommandAdapter({ now: () => 1000 }),
      ]),
    ),
  });
  const execute = (commandType, value, id = randomUUID(), uid = "teacher") =>
    core.execute({
      auth: { uid, token: { email: `${uid}@example.test` } },
      data: { commandId: id, commandType, payload: value },
    });
  return { store, execute };
};
let checks = 0;
const rejected = async (reason, input, mutate, uid) => {
  const { store, execute } = setup(mutate);
  const before = structuredClone([...store.docs]);
  await assert.rejects(
    execute("saveLessonDocument", input, randomUUID(), uid),
    (error) => error.details?.reason === reason,
  );
  assert.deepEqual([...store.docs], before);
  checks++;
};
(async () => {
  const { store, execute } = setup();
  const id = randomUUID();
  const response = await execute("saveLessonDocument", payload(), id);
  assert.equal(response.result.contentRevision, 3);
  assert.deepEqual(
    store.docs.get(lessonPath).worksheetExamHighlights,
    seed()[lessonPath].worksheetExamHighlights,
  );
  assert.equal(
    store.docs.get(lessonPath).pdfProcessing.extractionStatus,
    "ready",
  );
  assert.equal(
    (await execute("saveLessonDocument", payload(), id)).replayed,
    true,
  );
  checks += 4;
  await rejected("LESSON_MANAGE_REQUIRED", payload(), undefined, "student");
  await rejected("LESSON_CONTENT_CONFLICT", {
    ...payload(),
    expectedRevision: 1,
  });
  await rejected("LESSON_SEMESTER_NOT_ACTIVE", payload(), (data) => {
    data["semester_manifests/2026-2"].status = "ARCHIVED";
  });
  await rejected("LESSON_UNIT_NOT_IN_TREE", payload(), (data) => {
    data[treePath].tree = [];
  });
  await rejected("LESSON_ASSET_NOT_OWNED", {
    ...payload(),
    document: { pdfStoragePath: "victim/private.pdf" },
  });
  await rejected("LESSON_PAYLOAD_INVALID", {
    ...payload(),
    document: { title: "ok", contentRevision: 999 },
  });
  await rejected("LESSON_HTML_UNSAFE", {
    ...payload(),
    document: {
      contentHtml: '<img src="https://example.test/a" onerror="alert(1)">',
    },
  });
  await rejected("LESSON_HTML_UNSAFE", {
    ...payload(),
    document: { contentHtml: '<a href="javascript&#58;alert(1)">링크</a>' },
  });
  await rejected("LESSON_HTML_UNSAFE", {
    ...payload(),
    document: {
      footnotes: [
        { id: "note-one", bodyHtml: '<svg onload="alert(1)"></svg>' },
      ],
    },
  });
  await rejected("LESSON_HTML_UNSAFE", {
    ...payload(),
    document: {
      contentHtml:
        '<p style="background-color:url(https://example.test)">글</p>',
    },
  });
  await rejected("LESSON_PAYLOAD_INVALID", {
    ...payload(),
    document: {
      footnotes: [{ id: "note-one", linkUrl: "javascript:alert(1)" }],
    },
  });
  await rejected("LESSON_CONTENT_CONFLICT", {
    ...payload(),
    tree: [{ id: "unit-one", title: "new", children: [] }],
    expectedTreeRevision: 2,
  });
  const atomic = setup();
  const saved = await atomic.execute("saveLessonDocument", {
    ...payload(),
    tree: [{ id: "unit-one", title: "수정", children: [] }],
    expectedTreeRevision: 3,
  });
  assert.equal(saved.result.treeRevision, 4);
  assert.equal(atomic.store.docs.get(treePath).tree[0].title, "수정");
  checks++;
  const legacy = setup((data) => {
    data["lessons/legacy"] = data[lessonPath];
    delete data[lessonPath];
  });
  await legacy.execute("saveLessonDocument", payload());
  assert.equal(
    legacy.store.docs.get(`${root}/lessons/unit-unit-one`).contentRevision,
    3,
  );
  assert.equal(legacy.store.docs.get("lessons/legacy").contentRevision, 2);
  checks++;
  const assets = setup();
  const prepared = await assets.execute("prepareLessonAssetUpload", {
    ...scope,
    unitId: "unit-one",
    kind: "FOOTNOTE",
    byteSize: 100,
    contentType: "image/png",
    sha256: "a".repeat(64),
    originalName: "image.png",
  });
  assert.match(prepared.result.storagePath, /^lesson_uploads\/[\w-]+\/source$/);
  const ticketPath = `${lesson.ASSET_COLLECTION}/${prepared.result.uploadId}`;
  const ticket = assets.store.docs.get(ticketPath);
  assert.equal(ticket.ownerUid, "teacher");
  assert.equal(ticket.status, "PENDING");
  checks++;
  const attach = {
    ...payload(),
    document: {
      footnotes: [
        {
          id: "note-one",
          imageUrl: "https://verified.example/image.png",
          imageStoragePath: ticket.storagePath,
        },
      ],
    },
    assetUploadIds: [ticket.uploadId],
  };
  await assert.rejects(
    assets.execute("saveLessonDocument", attach),
    (error) => error.details?.reason === "LESSON_ASSET_NOT_READY",
  );
  checks++;
  assets.store.docs.set(ticketPath, {
    ...ticket,
    status: "VERIFIED",
    url: "https://verified.example/image.png",
  });
  await assert.rejects(
    assets.execute("saveLessonDocument", {
      ...attach,
      document: { pdfUrl: "https://verified.example/image.png" },
    }),
    (error) => error.details?.reason === "LESSON_ASSET_KIND_INVALID",
  );
  checks++;
  await assert.rejects(
    assets.execute("saveLessonDocument", {
      ...attach,
      document: {
        pdfStoragePath: "",
        pdfUrl: "https://verified.example/image.png",
      },
    }),
    (error) => error.details?.reason === "LESSON_ASSET_KIND_INVALID",
  );
  checks++;
  await assert.rejects(
    assets.execute("saveLessonDocument", {
      ...attach,
      document: { title: "unused" },
    }),
    (error) => error.details?.reason === "LESSON_ASSET_UNUSED",
  );
  checks++;
  await assets.execute("saveLessonDocument", attach);
  assert.equal(assets.store.docs.get(ticketPath).status, "ATTACHED");
  assert.equal(
    assets.store.docs.get(lessonPath).footnotes[0].imageStoragePath,
    ticket.storagePath,
  );
  checks++;
  const tree = setup();
  const retainedNote = { id: "archive-note", sourceArchiveAssetId: "source-image", sourceArchiveImagePath: "source-archive/source-image/v-old/display.webp", sourceArchiveThumbPath: "source-archive/source-image/v-old/thumb.webp" };
  const archiveSeed = (data) => {
    data[lessonPath].footnotes = [retainedNote];
    data["source_archive/source-image"] = { mediaKind: "image", processingStatus: "processing", image: { displayPath: "source-archive/source-image/v-new/display.webp" } };
  };
  const archive = setup(archiveSeed);
  await archive.execute("saveLessonDocument", { ...payload(), document: { footnotes: [retainedNote] } });
  assert.deepEqual(archive.store.docs.get(lessonPath).footnotes, [retainedNote]);
  checks++;
  await rejected("LESSON_ARCHIVE_ASSET_INVALID", { ...payload(), document: { footnotes: [{ ...retainedNote, sourceArchiveImagePath: "source-archive/source-image/v-other/display.webp" }] } }, archiveSeed);
  await rejected("LESSON_ARCHIVE_ASSET_INVALID", { ...payload(), document: { footnotes: [retainedNote] } }, (data) => { archiveSeed(data); data["source_archive/source-image"].deletedAt = 123; });
  const treePayload = {
    ...scope,
    expectedRevision: 3,
    tree: [{ id: "unit-one", title: "목차", children: [] }],
  };
  const parallel = await Promise.allSettled([
    tree.execute("saveLessonTree", treePayload),
    tree.execute("saveLessonTree", treePayload),
  ]);
  assert.equal(
    parallel.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      networkAccess: 0,
      coverage:
        "teacher role, semester, CAS, atomic tree+content, legacy copy, core point IDs, ticket ownership and attach",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
