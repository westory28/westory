const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const semesterCore = require("./semesterCore");
const { buildLessonAnswerKey } = require("./lessonAnswers");
const { assertLessonHtml } = require("./lessonHtml");

const LESSON_COMMAND_TYPES = Object.freeze({
  SAVE_LESSON_DOCUMENT: "saveLessonDocument",
  SAVE_LESSON_TREE: "saveLessonTree",
  PREPARE_LESSON_ASSET_UPLOAD: "prepareLessonAssetUpload",
});
const ASSET_COLLECTION = "lesson_asset_uploads";
const fail = (code, message, reason) => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () =>
  fail(
    "invalid-argument",
    "수업자료 저장 요청을 확인해 주세요.",
    "LESSON_PAYLOAD_INVALID",
  );
const key = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,160}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const rev = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value, allowed) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((name) => !allowed.includes(name))
  )
    invalid();
};
const normalizeTree = (tree) => {
  const ids = new Set();
  const visit = (nodes, depth) => {
    if (!Array.isArray(nodes) || depth > 12 || nodes.length > 1000) invalid();
    return nodes.map((node) => {
      object(node, ["id", "title", "children"]);
      if (
        !key(node.id) ||
        ids.has(node.id) ||
        typeof node.title !== "string" ||
        !node.title.trim() ||
        node.title.length > 300
      )
        invalid();
      ids.add(node.id);
      if (ids.size > 1000) invalid();
      return {
        id: node.id,
        title: node.title.trim(),
        children: visit(node.children || [], depth + 1),
      };
    });
  };
  return visit(tree, 0);
};
const DOCUMENT_KEYS = [
  "title",
  "videoUrl",
  "isVisibleToStudents",
  "contentHtml",
  "pdfName",
  "pdfUrl",
  "pdfStoragePath",
  "worksheetPageImages",
  "worksheetTextRegions",
  "worksheetBlanks",
  "worksheetExamHighlights",
  "worksheetFootnoteAnchors",
  "pdfProcessing",
  "footnotes",
];
const normalizeDocument = (value) => {
  object(value, DOCUMENT_KEYS);
  for (const name of [
    "title",
    "videoUrl",
    "contentHtml",
    "pdfName",
    "pdfUrl",
    "pdfStoragePath",
  ]) {
    if (
      value[name] !== undefined &&
      (typeof value[name] !== "string" ||
        value[name].length > (name === "contentHtml" ? 300000 : 3000))
    )
      invalid();
  }
  if (
    value.isVisibleToStudents !== undefined &&
    typeof value.isVisibleToStudents !== "boolean"
  )
    invalid();
  for (const name of [
    "worksheetPageImages",
    "worksheetTextRegions",
    "worksheetBlanks",
    "worksheetExamHighlights",
    "worksheetFootnoteAnchors",
    "footnotes",
  ]) {
    if (
      value[name] !== undefined &&
      (!Array.isArray(value[name]) || value[name].length > 1000)
    )
      invalid();
  }
  for (const name of [
    "worksheetBlanks",
    "worksheetExamHighlights",
    "worksheetFootnoteAnchors",
  ]) {
    const ids = new Set();
    for (const item of value[name] || []) {
      if (
        !key(item?.id) ||
        ids.has(item.id) ||
        !Number.isSafeInteger(item.page) ||
        item.page < 1
      )
        invalid();
      ids.add(item.id);
      for (const ratio of [
        "leftRatio",
        "topRatio",
        "widthRatio",
        "heightRatio",
      ])
        if (!Number.isFinite(item[ratio]) || item[ratio] < 0 || item[ratio] > 1)
          invalid();
      if (
        name === "worksheetBlanks" &&
        (typeof item.answer !== "string" || item.answer.length > 2000)
      )
        invalid();
    }
  }
  const clone = JSON.parse(JSON.stringify(value));
  if (clone.contentHtml !== undefined) assertLessonHtml(clone.contentHtml);
  const footnoteIds = new Set();
  for (const note of clone.footnotes || []) {
    assertLessonHtml(note.bodyHtml || "");
    if (!key(note?.id) || footnoteIds.has(note.id)) invalid();
    footnoteIds.add(note.id);
    if (note.linkUrl) {
      try {
        const url = new URL(note.linkUrl);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          invalid();
      } catch {
        invalid();
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(clone)) > 650000) invalid();
  return clone;
};
const normalizeLessonPayload = (type, value) => {
  const common = ["semesterId", "expectedSemesterRevision", "expectedRevision"];
  object(
    value,
    type === "saveLessonTree"
      ? [...common, "tree"]
      : type === "prepareLessonAssetUpload"
        ? [
            ...common,
            "unitId",
            "kind",
            "contentType",
            "byteSize",
            "sha256",
            "originalName",
          ]
        : [
            ...common,
            "unitId",
            "document",
            "assetUploadIds",
            "tree",
            "expectedTreeRevision",
          ],
  );
  if (!rev(value.expectedSemesterRevision) || !rev(value.expectedRevision))
    invalid();
  const scope = {
    semesterId: semesterCore.normalizeSemesterId(value.semesterId),
    expectedSemesterRevision: value.expectedSemesterRevision,
    expectedRevision: value.expectedRevision,
  };
  if (type === "saveLessonTree")
    return { ...scope, tree: normalizeTree(value.tree) };
  if (!key(value.unitId)) invalid();
  if (type === "prepareLessonAssetUpload") {
    const pdf = value.kind === "PDF";
    if (
      !["PDF", "PAGE", "FOOTNOTE"].includes(value.kind) ||
      !(pdf
        ? value.contentType === "application/pdf"
        : ["image/png", "image/jpeg", "image/webp"].includes(
            value.contentType,
          )) ||
      !Number.isSafeInteger(value.byteSize) ||
      value.byteSize < 1 ||
      value.byteSize >= (pdf ? 20 : 6) * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.originalName !== "string" ||
      value.originalName.length > 255
    )
      invalid();
    return {
      ...scope,
      unitId: value.unitId,
      kind: value.kind,
      contentType: value.contentType,
      byteSize: value.byteSize,
      sha256: value.sha256,
      originalName: value.originalName,
    };
  }
  if (
    !Array.isArray(value.assetUploadIds) ||
    value.assetUploadIds.length > 300 ||
    value.assetUploadIds.some((id) => !key(id))
  )
    invalid();
  if (value.tree !== undefined && !rev(value.expectedTreeRevision)) invalid();
  return {
    ...scope,
    unitId: value.unitId,
    document: normalizeDocument(value.document),
    assetUploadIds: [...new Set(value.assetUploadIds)],
    ...(value.tree !== undefined
      ? {
          tree: normalizeTree(value.tree),
          expectedTreeRevision: value.expectedTreeRevision,
        }
      : {}),
  };
};
const assertWritable = async (transaction, payload, actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole))
    fail(
      "permission-denied",
      "수업자료 편집 권한이 필요합니다.",
      "LESSON_MANAGE_REQUIRED",
    );
  const [pointer, manifest] = await transaction.getAll([
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`,
  ]);
  if (
    !pointer.exists ||
    !manifest.exists ||
    pointer.data?.semesterId !== payload.semesterId ||
    manifest.data?.status !== "ACTIVE" ||
    pointer.data?.revision !== manifest.data?.revision ||
    manifest.data?.revision !== payload.expectedSemesterRevision
  )
    fail(
      "failed-precondition",
      "현재 학기가 변경되었습니다. 화면을 다시 열어 주세요.",
      "LESSON_SEMESTER_NOT_ACTIVE",
    );
  const [year, term] = payload.semesterId.split("-");
  return `years/${year}/semesters/${term}`;
};
const resolveLesson = async (transaction, root, unitId) => {
  const scoped = await transaction.query(`${root}/lessons`, {
    field: "unitId",
    operator: "==",
    value: unitId,
    limit: 2,
  });
  const source = scoped.length
    ? scoped
    : await transaction.query("lessons", {
        field: "unitId",
        operator: "==",
        value: unitId,
        limit: 2,
      });
  if (source.length > 1)
    fail(
      "failed-precondition",
      "중복된 수업자료를 먼저 확인해 주세요.",
      "LESSON_SOURCE_AMBIGUOUS",
    );
  return {
    path: scoped[0]?.path || `${root}/lessons/unit-${unitId}`,
    data: source[0]?.data || {},
  };
};
const assertRevision = (data, expected) => {
  if ((data.contentRevision ?? 0) !== expected)
    fail(
      "aborted",
      "다른 화면에서 수업자료를 수정했습니다. 입력 내용을 보관한 뒤 다시 열어 주세요.",
      "LESSON_CONTENT_CONFLICT",
    );
};
const assetRefs = (document) =>
  [
    document.pdfUrl,
    document.pdfStoragePath,
    ...(document.worksheetPageImages || []).map((item) => item.imageUrl),
    ...(document.footnotes || []).flatMap((item) => [
      item.imageUrl,
      item.imageStoragePath,
      item.sourceArchiveImagePath,
      item.sourceArchiveThumbPath,
    ]),
  ].filter(Boolean);
const createLessonCommandAdapter = ({ now = () => Date.now() } = {}) => ({
  apply: async ({
    transaction,
    payload,
    actor,
    commandType,
    commandId,
    timestamp,
  }) => {
    const root = await assertWritable(transaction, payload, actor);
    const treePath = `${root}/curriculum/tree`;
    const treeSnapshot = await transaction.get(treePath);
    const legacyTree = !treeSnapshot.exists
      ? await transaction.get("curriculum/tree")
      : null;
    const currentTree = treeSnapshot.data || legacyTree?.data || {};
    const done = (id, refs, result) => ({
      target: { kind: commandType, id, refs },
      sourceHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      result,
    });
    if (commandType === "saveLessonTree") {
      assertRevision(treeSnapshot.data || {}, payload.expectedRevision);
      const contentRevision = payload.expectedRevision + 1;
      transaction.set(treePath, {
        tree: payload.tree,
        contentRevision,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      return done("tree", [treePath], { contentRevision });
    }
    const current = await resolveLesson(transaction, root, payload.unitId);
    assertRevision(current.data, payload.expectedRevision);
    const contains = (nodes) =>
      (nodes || []).some(
        (node) => node.id === payload.unitId || contains(node.children),
      );
    if (!contains(currentTree.tree))
      fail(
        "failed-precondition",
        "목차에 없는 수업자료입니다. 목차를 먼저 저장해 주세요.",
        "LESSON_UNIT_NOT_IN_TREE",
      );
    if (commandType === "prepareLessonAssetUpload") {
      const uploadId = commandId;
      const path = `${ASSET_COLLECTION}/${uploadId}`;
      const existing = await transaction.get(path);
      if (existing.exists)
        fail(
          "already-exists",
          "업로드 요청 식별자가 중복되었습니다.",
          "LESSON_UPLOAD_ID_CONFLICT",
        );
      const storagePath = `lesson_uploads/${uploadId}/source`;
      const expiresAtMs = now() + 60 * 60 * 1000;
      transaction.create(path, {
        ...payload,
        uploadId,
        storagePath,
        downloadToken: randomUUID(),
        ownerUid: actor.actorUid,
        lessonPath: current.path,
        status: "PENDING",
        expiresAtMs,
        createdAt: timestamp,
      });
      return done(uploadId, [path], { uploadId, storagePath, expiresAtMs });
    }
    const tickets = await transaction.getAll(
      payload.assetUploadIds.map((id) => `${ASSET_COLLECTION}/${id}`),
    );
    for (const ticket of tickets) {
      const data = ticket.data;
      if (
        !ticket.exists ||
        data.ownerUid !== actor.actorUid ||
        data.semesterId !== payload.semesterId ||
        data.unitId !== payload.unitId ||
        data.expectedRevision !== payload.expectedRevision ||
        data.status !== "VERIFIED" ||
        data.expiresAtMs <= now()
      )
        fail(
          "failed-precondition",
          "업로드한 파일의 검증이 완료되지 않았거나 저장 대상이 바뀌었습니다.",
          "LESSON_ASSET_NOT_READY",
        );
    }
    const allowed = new Set([
      ...assetRefs(current.data),
      ...tickets.flatMap((ticket) => [
        ticket.data.storagePath,
        ticket.data.url,
      ]),
    ]);
    const archiveNotes = (payload.document.footnotes || []).filter(
      (note) => note.sourceArchiveAssetId,
    );
    for (const note of archiveNotes) {
      if (!key(note.sourceArchiveAssetId)) invalid();
      const source = await transaction.get(
        `source_archive/${note.sourceArchiveAssetId}`,
      );
      const image = source.data?.image;
      const retained = (current.data.footnotes || []).some((previous) =>
        previous.sourceArchiveAssetId === note.sourceArchiveAssetId &&
        previous.sourceArchiveImagePath === note.sourceArchiveImagePath &&
        (previous.sourceArchiveThumbPath || "") === (note.sourceArchiveThumbPath || ""));
      if (
        !source.exists ||
        source.data?.deletedAt ||
        (!retained && (source.data?.processingStatus !== "ready" ||
        source.data?.mediaKind === "pdf" ||
        !image ||
        note.sourceArchiveImagePath !==
          (image.displayPath || image.thumbPath || image.originalPath) ||
        (note.sourceArchiveThumbPath || "") !== (image.thumbPath || "")))
      )
        fail(
          "permission-denied",
          "사료창고 이미지의 출처를 확인할 수 없습니다.",
          "LESSON_ARCHIVE_ASSET_INVALID",
        );
      allowed.add(note.sourceArchiveImagePath);
      if (note.sourceArchiveThumbPath) allowed.add(note.sourceArchiveThumbPath);
    }
    for (const ref of assetRefs(payload.document))
      if (!allowed.has(ref))
        fail(
          "permission-denied",
          "확인되지 않은 파일을 수업자료에 연결할 수 없습니다.",
          "LESSON_ASSET_NOT_OWNED",
        );
    const next = {
      ...current.data,
      ...payload.document,
      unitId: payload.unitId,
    };
    // Processing paths come only from the currently attached source or a verified PDF.
    const pdfTicket = tickets.find(
      (ticket) =>
        ticket.data.kind === "PDF" &&
        ticket.data.storagePath === next.pdfStoragePath,
    );
    const pdfPairChanged =
      (next.pdfStoragePath || "") !== (current.data.pdfStoragePath || "") ||
      (next.pdfUrl || "") !== (current.data.pdfUrl || "");
    if (
      pdfPairChanged &&
      (next.pdfStoragePath || next.pdfUrl) &&
      (!pdfTicket || next.pdfUrl !== pdfTicket.data.url)
    )
      fail(
        "permission-denied",
        "PDF 원본과 검증된 업로드가 일치하지 않습니다.",
        "LESSON_ASSET_KIND_INVALID",
      );
    const previousPageUrls = new Set(
      (current.data.worksheetPageImages || []).map((page) => page.imageUrl),
    );
    for (const page of next.worksheetPageImages || []) {
      if (
        !previousPageUrls.has(page.imageUrl) &&
        !tickets.some(
          (ticket) =>
            ticket.data.kind === "PAGE" && ticket.data.url === page.imageUrl,
        )
      )
        fail(
          "permission-denied",
          "확인된 PDF 페이지 이미지만 연결할 수 있습니다.",
          "LESSON_ASSET_KIND_INVALID",
        );
    }
    const previousNotes = current.data.footnotes || [];
    for (const note of next.footnotes || []) {
      const existing = previousNotes.some(
        (prior) =>
          prior.imageUrl === note.imageUrl &&
          prior.imageStoragePath === note.imageStoragePath,
      );
      if (
        (note.imageUrl || note.imageStoragePath) &&
        !existing &&
        !tickets.some(
          (ticket) =>
            ticket.data.kind === "FOOTNOTE" &&
            ticket.data.url === note.imageUrl &&
            ticket.data.storagePath === note.imageStoragePath,
        )
      )
        fail(
          "permission-denied",
          "각주 이미지와 검증된 업로드가 일치하지 않습니다.",
          "LESSON_ASSET_KIND_INVALID",
        );
    }
    const consumed = (ticket) =>
      ticket.data.kind === "PDF"
        ? next.pdfStoragePath === ticket.data.storagePath &&
          next.pdfUrl === ticket.data.url
        : ticket.data.kind === "PAGE"
          ? (next.worksheetPageImages || []).some(
              (page) => page.imageUrl === ticket.data.url,
            )
          : (next.footnotes || []).some(
              (note) =>
                note.imageStoragePath === ticket.data.storagePath &&
                note.imageUrl === ticket.data.url,
            );
    if (tickets.some((ticket) => !consumed(ticket)))
      fail(
        "invalid-argument",
        "수업자료에서 사용하지 않는 업로드가 포함되어 있습니다.",
        "LESSON_ASSET_UNUSED",
      );
    next.pdfProcessing = pdfTicket
      ? pdfTicket.data.pdfProcessing
      : next.pdfStoragePath
        ? current.data.pdfProcessing || null
        : null;
    buildLessonAnswerKey(next);
    const footnoteIds = new Set((next.footnotes || []).map((item) => item.id));
    if (
      (next.worksheetFootnoteAnchors || []).some(
        (item) => !footnoteIds.has(item.footnoteId),
      )
    )
      invalid();
    if (payload.tree !== undefined)
      assertRevision(treeSnapshot.data || {}, payload.expectedTreeRevision);
    const contentRevision = payload.expectedRevision + 1;
    transaction.set(current.path, {
      ...next,
      contentRevision,
      updatedAt: timestamp,
      updatedBy: actor.actorUid,
    });
    const refs = [current.path];
    for (const ticket of tickets) {
      transaction.set(
        ticket.path,
        {
          status: "ATTACHED",
          attachedAt: timestamp,
          attachedRevision: contentRevision,
        },
        { merge: true },
      );
      refs.push(ticket.path);
    }
    if (payload.tree !== undefined) {
      transaction.set(treePath, {
        tree: payload.tree,
        contentRevision: payload.expectedTreeRevision + 1,
        updatedAt: timestamp,
        updatedBy: actor.actorUid,
      });
      refs.push(treePath);
    }
    return done(payload.unitId, refs, {
      unitId: payload.unitId,
      contentRevision,
      treeRevision:
        payload.tree !== undefined ? payload.expectedTreeRevision + 1 : null,
      pdfProcessing: next.pdfProcessing,
    });
  },
});
module.exports = {
  LESSON_COMMAND_TYPES,
  ASSET_COLLECTION,
  normalizeLessonPayload,
  createLessonCommandAdapter,
};
