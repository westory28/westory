const { createHash, randomUUID } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const semesterCore = require("./semesterCore");

const MAP_COMMAND_TYPES = Object.freeze({
  SAVE_MAP_RESOURCES: "saveMapResources",
  DELETE_MAP_RESOURCE: "deleteMapResource",
  PREPARE_MAP_ASSET_UPLOAD: "prepareMapAssetUpload",
});
const ASSET_COLLECTION = "map_asset_uploads";
const DOCUMENT_KEYS = [
  "title",
  "category",
  "tabGroup",
  "description",
  "type",
  "imageUrl",
  "fileUrl",
  "storagePath",
  "fileName",
  "mimeType",
  "embedUrl",
  "googleQuery",
  "externalUrl",
  "pdfPageImages",
  "pdfRegions",
  "pdfTagSections",
  "sortOrder",
];
// Answer fields can only be changed through updateMapResourceBlanks.
// The fingerprint includes the entire raw source, including unknown legacy fields.
const FINGERPRINT_KEYS = [
  ...DOCUMENT_KEYS,
  "pdfBlanks",
  "answerOptions",
  "contentRevision",
];
const fail = (code, reason, message = "지도 저장 요청을 확인해 주세요.") => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () => fail("invalid-argument", "MAP_PAYLOAD_INVALID");
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
const canonical = (value) =>
  value && typeof value.toMillis === "function"
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((name) => [name, canonical(value[name])]),
          )
        : value;
const fingerprint = (data) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
const strings = (value, max = 100) => {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 200,
    ) ||
    new Set(value).size !== value.length
  )
    invalid();
};
const safeUrl = (value) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      invalid();
  } catch {
    invalid();
  }
};
const normalizeDocument = (value) => {
  object(value, DOCUMENT_KEYS);
  for (const name of DOCUMENT_KEYS.filter(
    (name) =>
      !["pdfPageImages", "pdfRegions", "pdfTagSections", "sortOrder"].includes(
        name,
      ),
  )) {
    if (
      value[name] !== undefined &&
      (typeof value[name] !== "string" ||
        value[name].length > (name === "description" ? 10000 : 3000))
    )
      invalid();
  }
  if (
    !value.title?.trim() ||
    !value.category?.trim() ||
    !["pdf", "image", "google", "iframe"].includes(value.type) ||
    !Number.isFinite(value.sortOrder)
  )
    invalid();
  for (const name of ["embedUrl", "externalUrl"]) safeUrl(value[name]);
  if (
    (value.type === "iframe" && !value.embedUrl) ||
    (value.type === "google" && !value.googleQuery?.trim())
  )
    invalid();
  const pages = value.pdfPageImages || [],
    regions = value.pdfRegions || [],
    sections = value.pdfTagSections || [];
  if (
    !Array.isArray(pages) ||
    pages.length > 150 ||
    !Array.isArray(regions) ||
    regions.length > 1000 ||
    !Array.isArray(sections) ||
    sections.length > 30
  )
    invalid();
  const pageIds = new Set();
  for (const page of pages) {
    object(page, ["page", "imageUrl", "width", "height"]);
    if (
      !Number.isSafeInteger(page.page) ||
      page.page < 1 ||
      pageIds.has(page.page) ||
      typeof page.imageUrl !== "string" ||
      !page.imageUrl ||
      page.imageUrl.length > 3000 ||
      !Number.isFinite(page.width) ||
      page.width <= 0 ||
      !Number.isFinite(page.height) ||
      page.height <= 0 ||
      page.width * page.height > 50000000
    )
      invalid();
    pageIds.add(page.page);
  }
  const sectionIds = new Set();
  for (const section of sections) {
    object(section, ["id", "label", "tags"]);
    if (
      !key(section.id) ||
      sectionIds.has(section.id) ||
      typeof section.label !== "string" ||
      !section.label.trim() ||
      section.label.length > 200
    )
      invalid();
    sectionIds.add(section.id);
    strings(section.tags);
  }
  const tags = new Set(sections.flatMap((section) => section.tags));
  for (const region of regions) {
    object(region, [
      "label",
      "page",
      "left",
      "top",
      "width",
      "height",
      "shortcutEnabled",
      "tags",
    ]);
    if (
      typeof region.label !== "string" ||
      !region.label.trim() ||
      region.label.length > 300 ||
      !Number.isSafeInteger(region.page) ||
      region.page < 1 ||
      (region.shortcutEnabled !== undefined &&
        typeof region.shortcutEnabled !== "boolean")
    )
      invalid();
    for (const name of ["left", "top", "width", "height"])
      if (
        !Number.isFinite(region[name]) ||
        region[name] < 0 ||
        region[name] > 100000
      )
        invalid();
    if (region.tags !== undefined) {
      strings(region.tags);
      if (region.tags.some((tag) => !tags.has(tag))) invalid();
    }
  }
  return JSON.parse(JSON.stringify(value));
};
const normalizeSource = (value) => {
  if (
    !key(value.mapId) ||
    !["semester", "legacy"].includes(value.originScope) ||
    !rev(value.expectedRevision) ||
    typeof value.sourceExists !== "boolean" ||
    (value.sourceExists
      ? !/^[a-f0-9]{64}$/.test(value.sourceHash)
      : value.sourceHash !== "" || value.expectedRevision !== 0)
  )
    invalid();
  return {
    mapId: value.mapId,
    originScope: value.originScope,
    expectedRevision: value.expectedRevision,
    sourceExists: value.sourceExists,
    sourceHash: value.sourceHash,
  };
};
const SOURCE_KEYS = [
  "mapId",
  "originScope",
  "expectedRevision",
  "sourceExists",
  "sourceHash",
];
const normalizeMapPayload = (type, value) => {
  const common = ["semesterId", "expectedSemesterRevision"];
  object(
    value,
    type === "saveMapResources"
      ? [...common, "resources"]
      : type === "deleteMapResource"
        ? [...common, ...SOURCE_KEYS]
        : [
            ...common,
            ...SOURCE_KEYS,
            "kind",
            "sourceUploadId",
            "page",
            "contentType",
            "byteSize",
            "sha256",
            "originalName",
          ],
  );
  if (!rev(value.expectedSemesterRevision)) invalid();
  const scope = {
    semesterId: semesterCore.normalizeSemesterId(value.semesterId),
    expectedSemesterRevision: value.expectedSemesterRevision,
  };
  if (type === "saveMapResources") {
    if (
      !Array.isArray(value.resources) ||
      !value.resources.length ||
      value.resources.length > 100
    )
      invalid();
    const ids = new Set(),
      uploads = new Set();
    const resources = value.resources.map((item) => {
      object(item, [...SOURCE_KEYS, "document", "assetUploadIds"]);
      const source = normalizeSource(item);
      if (
        ids.has(source.mapId) ||
        !Array.isArray(item.assetUploadIds) ||
        item.assetUploadIds.length > 151
      )
        invalid();
      ids.add(source.mapId);
      for (const id of item.assetUploadIds) {
        if (!key(id) || uploads.has(id)) invalid();
        uploads.add(id);
      }
      return {
        ...source,
        document: normalizeDocument(item.document),
        assetUploadIds: [...item.assetUploadIds],
      };
    });
    if (
      uploads.size > 250 ||
      Buffer.byteLength(JSON.stringify(resources)) > 650000
    )
      invalid();
    return { ...scope, resources };
  }
  const source = normalizeSource(value);
  if (type === "deleteMapResource") {
    if (!source.sourceExists || source.mapId === "google-maps") invalid();
    return { ...scope, ...source };
  }
  if (type !== "prepareMapAssetUpload") invalid();
  const pdf = value.kind === "PDF";
  if (
    !["PDF", "IMAGE", "PAGE"].includes(value.kind) ||
    !(pdf
      ? value.contentType === "application/pdf"
      : ["image/png", "image/jpeg", "image/webp"].includes(
          value.contentType,
        )) ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > (pdf ? 20 : 6) * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.originalName !== "string" ||
    value.originalName.length > 255
  )
    invalid();
  if (
    value.kind === "PAGE"
      ? !key(value.sourceUploadId) ||
        !Number.isSafeInteger(value.page) ||
        value.page < 1 ||
        value.page > 150
      : value.sourceUploadId !== "" || value.page !== 0
  )
    invalid();
  return {
    ...scope,
    ...source,
    kind: value.kind,
    sourceUploadId: value.sourceUploadId,
    page: value.page,
    contentType: value.contentType,
    byteSize: value.byteSize,
    sha256: value.sha256,
    originalName: value.originalName,
  };
};
const assertWritable = async (transaction, payload, actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole))
    fail(
      "permission-denied",
      "MAP_MANAGE_REQUIRED",
      "지도 편집 권한이 필요합니다.",
    );
  const [pointer, manifest] = await transaction.getAll([
    semesterCore.ACTIVE_SEMESTER_POINTER_PATH,
    `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${payload.semesterId}`,
  ]);
  if (
    !pointer.exists ||
    !manifest.exists ||
    pointer.data.semesterId !== payload.semesterId ||
    manifest.data.status !== "ACTIVE" ||
    pointer.data.revision !== payload.expectedSemesterRevision ||
    manifest.data.revision !== payload.expectedSemesterRevision
  )
    fail(
      "failed-precondition",
      "MAP_SEMESTER_NOT_ACTIVE",
      "현재 학기가 변경되었습니다. 편집 내용을 보관한 뒤 다시 열어 주세요.",
    );
  const [year, semester] = payload.semesterId.split("-");
  return `years/${year}/semesters/${semester}/map_resources`;
};
const resolveSource = async (transaction, collection, input) => {
  if (
    input.originScope === "legacy" &&
    (await transaction.query(collection, { limit: 1 })).length
  )
    fail(
      "failed-precondition",
      "MAP_LEGACY_SOURCE_CHANGED",
      "현재 학기의 지도 목록이 변경되었습니다. 편집 내용을 보관한 뒤 다시 열어 주세요.",
    );
  const path = `${input.originScope === "legacy" ? "map_resources" : collection}/${input.mapId}`;
  const current = await transaction.get(path);
  if (
    current.exists !== input.sourceExists ||
    (current.data?.contentRevision ?? 0) !== input.expectedRevision ||
    (current.exists && fingerprint(current.data) !== input.sourceHash)
  )
    fail(
      "aborted",
      "MAP_CONTENT_CONFLICT",
      "다른 화면에서 지도를 변경했습니다. 편집 내용을 보관한 뒤 다시 열어 주세요.",
    );
  return { path, data: current.data || {} };
};
const assertTicket = (ticket, input, payload, actor, now) => {
  if (
    !ticket?.exists ||
    ticket.data.ownerUid !== actor.actorUid ||
    ticket.data.semesterId !== payload.semesterId ||
    ticket.data.expectedSemesterRevision !== payload.expectedSemesterRevision ||
    SOURCE_KEYS.some((name) => ticket.data[name] !== input[name]) ||
    ticket.data.status !== "VERIFIED" ||
    ticket.data.expiresAtMs <= now()
  )
    fail(
      "failed-precondition",
      "MAP_ASSET_NOT_READY",
      "업로드한 파일의 검증 또는 저장 대상을 확인해 주세요.",
    );
};
const createMapCommandAdapter = ({ now = Date.now } = {}) => ({
  apply: async ({
    transaction,
    payload,
    actor,
    commandType,
    commandId,
    timestamp,
  }) => {
    const collection = await assertWritable(transaction, payload, actor);
    const done = (id, refs, result) => ({
      target: { kind: commandType, id, refs },
      sourceHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      result,
    });
    if (commandType !== "saveMapResources") {
      const current = await resolveSource(transaction, collection, payload);
      if (commandType === "deleteMapResource") {
        transaction.delete(current.path);
        return done(payload.mapId, [current.path], {
          mapId: payload.mapId,
          deleted: true,
        });
      }
      const path = `${ASSET_COLLECTION}/${commandId}`;
      if ((await transaction.get(path)).exists)
        fail("already-exists", "MAP_UPLOAD_ID_CONFLICT");
      if (payload.kind === "PAGE") {
        const source = await transaction.get(
          `${ASSET_COLLECTION}/${payload.sourceUploadId}`,
        );
        assertTicket(source, payload, payload, actor, now);
        if (source.data.kind !== "PDF" || payload.page > source.data.pageCount)
          invalid();
      }
      const storagePath = `map_uploads/${commandId}/source`,
        expiresAtMs = now() + 3600000;
      transaction.create(path, {
        ...payload,
        uploadId: commandId,
        ownerUid: actor.actorUid,
        mapPath: current.path,
        storagePath,
        downloadToken: randomUUID(),
        expiresAtMs,
        status: "PENDING",
        createdAt: timestamp,
      });
      return done(commandId, [path], {
        uploadId: commandId,
        storagePath,
        expiresAtMs,
      });
    }
    // Read and validate every row and every attachment before the first write.
    const prepared = [];
    let totalBytes = 0;
    for (const input of payload.resources) {
      const current = await resolveSource(transaction, collection, input);
      const tickets = await transaction.getAll(
        input.assetUploadIds.map((id) => `${ASSET_COLLECTION}/${id}`),
      );
      for (const ticket of tickets) {
        assertTicket(ticket, input, payload, actor, now);
        totalBytes += ticket.data.byteSize;
      }
      const next = { ...current.data, ...input.document };
      const main = tickets.find((ticket) =>
        ["PDF", "IMAGE"].includes(ticket.data.kind),
      );
      if (
        !main &&
        next.type !== current.data.type &&
        (next.fileUrl || next.imageUrl || next.storagePath)
      )
        fail("permission-denied", "MAP_ASSET_KIND_INVALID");
      const pairChanged = ["fileUrl", "storagePath", "imageUrl"].some(
        (name) => (next[name] || "") !== (current.data[name] || ""),
      );
      if (
        (pairChanged || main) &&
        (next.fileUrl || next.storagePath || next.imageUrl)
      ) {
        if (
          !main ||
          main.data.kind !== (next.type === "pdf" ? "PDF" : "IMAGE") ||
          next.fileUrl !== main.data.url ||
          next.storagePath !== main.data.storagePath ||
          (next.type === "image"
            ? next.imageUrl !== main.data.url
            : !!next.imageUrl)
        )
          fail("permission-denied", "MAP_ASSET_PAIR_INVALID");
      }
      if (
        ["image", "pdf"].includes(next.type) &&
        !(next.type === "image" ? next.imageUrl : next.fileUrl)
      )
        invalid();
      const priorPages = current.data.pdfPageImages || [];
      for (const page of next.pdfPageImages || []) {
        const ticket = tickets.find(
          (item) =>
            item.data.kind === "PAGE" && item.data.url === page.imageUrl,
        );
        if (ticket) {
          if (
            !main ||
            main.data.kind !== "PDF" ||
            ticket.data.sourceUploadId !== main.data.uploadId ||
            ticket.data.page !== page.page ||
            ticket.data.width !== page.width ||
            ticket.data.height !== page.height
          )
            fail("permission-denied", "MAP_PAGE_SOURCE_INVALID");
        } else if (
          main ||
          !priorPages.some(
            (old) =>
              old.imageUrl === page.imageUrl &&
              old.page === page.page &&
              old.width === page.width &&
              old.height === page.height,
          )
        )
          fail("permission-denied", "MAP_PAGE_SOURCE_INVALID");
      }
      if (
        tickets.some((ticket) =>
          ticket === main
            ? next.storagePath !== ticket.data.storagePath
            : ticket.data.kind !== "PAGE" ||
              !(next.pdfPageImages || []).some(
                (page) => page.imageUrl === ticket.data.url,
              ),
        )
      )
        fail("invalid-argument", "MAP_ASSET_UNUSED");
      if (
        main?.data.kind === "PDF" &&
        ((next.pdfPageImages || []).length !== main.data.pageCount ||
          (next.pdfPageImages || []).some(
            (page) => page.page > main.data.pageCount,
          ))
      )
        invalid();
      const contentRevision = input.expectedRevision + 1;
      const document = {
        ...next,
        contentRevision,
        updatedAt: new Date(now()).toISOString(),
        updatedBy: actor.actorUid,
      };
      prepared.push({
        input,
        current,
        tickets,
        document,
        result: {
          mapId: input.mapId,
          contentRevision,
          originScope: input.originScope,
          sourceHash: fingerprint(document),
          sourceExists: true,
        },
      });
    }
    if (totalBytes > 100 * 1024 * 1024)
      fail("invalid-argument", "MAP_ASSET_TOTAL_SIZE_INVALID");
    const refs = [];
    for (const row of prepared) {
      transaction.set(row.current.path, row.document);
      refs.push(row.current.path);
      for (const ticket of row.tickets) {
        transaction.set(
          ticket.path,
          {
            status: "ATTACHED",
            attachedAt: timestamp,
            attachedRevision: row.document.contentRevision,
            expiresAtMs: FieldValue.delete(),
          },
          { merge: true },
        );
        refs.push(ticket.path);
      }
    }
    return done(commandId, refs, {
      resources: prepared.map((row) => row.result),
    });
  },
});

// Callable transport returns only this owner's verified ticket. Firestore and
// Storage client writes remain denied; no ticket-read Rules exception is needed.
const inspectPdf = async (bytes) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 150) invalid();
    for (let page = 1; page <= pdf.numPages; page++) await pdf.getPage(page);
    return { pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
};
const createMapUploadHandler =
  ({
    db,
    bucket,
    assertSession,
    now = Date.now,
    pdfMetadata = inspectPdf,
    imageMetadata = async (bytes) =>
      require("sharp")(bytes, { limitInputPixels: 50000000 }).metadata(),
  }) =>
  async (request) => {
    const { uid } = await assertSession(request, {
      recentAuth: true,
      highRisk: true,
    });
    const { uploadId, contentBase64 } = request.data || {};
    if (
      !key(uploadId) ||
      typeof contentBase64 !== "string" ||
      !contentBase64.length ||
      contentBase64.length > 28 * 1024 * 1024 ||
      contentBase64.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    )
      invalid();
    const ticketRef = db.doc(`${ASSET_COLLECTION}/${uploadId}`);
    const [snapshot, profile] = await db.getAll(
      ticketRef,
      db.doc(`users/${uid}`),
    );
    const ticket = snapshot.data();
    if (
      !snapshot.exists ||
      ticket.ownerUid !== uid ||
      !(
        profile.data()?.role === "teacher" ||
        request.auth?.token?.email === "westoria28@gmail.com"
      ) ||
      ticket.storagePath !== `map_uploads/${uploadId}/source` ||
      !["PENDING", "VERIFIED", "ATTACHED"].includes(ticket.status) ||
      ticket.expiresAtMs <= now()
    )
      fail("permission-denied", "MAP_UPLOAD_NOT_OWNED");
    const bytes = Buffer.from(contentBase64, "base64");
    if (
      bytes.length !== ticket.byteSize ||
      bytes.length > (ticket.kind === "PDF" ? 20 : 6) * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== ticket.sha256
    )
      invalid();
    const checkActive = async (transaction) => {
      const [pointer, manifest, source] = await transaction.getAll(
        db.doc(semesterCore.ACTIVE_SEMESTER_POINTER_PATH),
        db.doc(
          `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${ticket.semesterId}`,
        ),
        db.doc(ticket.mapPath),
      );
      if (
        pointer.data()?.semesterId !== ticket.semesterId ||
        pointer.data()?.revision !== ticket.expectedSemesterRevision ||
        manifest.data()?.status !== "ACTIVE" ||
        manifest.data()?.revision !== ticket.expectedSemesterRevision
      )
        fail("failed-precondition", "MAP_SEMESTER_NOT_ACTIVE");
      if (
        source.exists !== ticket.sourceExists ||
        (source.data()?.contentRevision ?? 0) !== ticket.expectedRevision ||
        (source.exists && fingerprint(source.data()) !== ticket.sourceHash)
      )
        fail("aborted", "MAP_CONTENT_CONFLICT");
      if (ticket.originScope === "legacy") {
        const [year, term] = ticket.semesterId.split("-");
        if (
          !(
            await transaction.get(
              db
                .collection(`years/${year}/semesters/${term}/map_resources`)
                .limit(1),
            )
          ).empty
        )
          fail("failed-precondition", "MAP_LEGACY_SOURCE_CHANGED");
      }
    };
    // An attached ticket may be replayed after the map revision advances.
    if (ticket.status === "ATTACHED")
      return {
        uploadId,
        storagePath: ticket.storagePath,
        url: ticket.url,
        width: ticket.width || 0,
        height: ticket.height || 0,
      };
    await db.runTransaction(checkActive);
    let dimensions = {};
    try {
      if (ticket.kind === "PDF") {
        if (
          !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")) ||
          !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))
        )
          invalid();
        dimensions = await pdfMetadata(bytes);
      } else {
        const metadata = await imageMetadata(bytes);
        if (
          { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[
            metadata.format
          ] !== ticket.contentType ||
          !metadata.width ||
          !metadata.height ||
          metadata.width * metadata.height > 50000000
        )
          invalid();
        dimensions = { width: metadata.width, height: metadata.height };
      }
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ticketRef);
        if (latest.data()?.status === "PENDING")
          transaction.set(
            ticketRef,
            { status: "FAILED", error: "파일 형식 검증에 실패했습니다." },
            { merge: true },
          );
      });
      throw error;
    }
    const file = bucket.file(ticket.storagePath);
    try {
      await file.save(bytes, {
        resumable: false,
        contentType: ticket.contentType,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: "private,max-age=3600",
          metadata: {
            ownerUid: uid,
            uploadId,
            firebaseStorageDownloadTokens: ticket.downloadToken,
          },
        },
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      const [existing] = await file.download();
      if (createHash("sha256").update(existing).digest("hex") !== ticket.sha256)
        fail("failed-precondition", "MAP_UPLOAD_OBJECT_CONFLICT");
    }
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(ticket.storagePath)}?alt=media&token=${ticket.downloadToken}`;
    await db.runTransaction(async (transaction) => {
      await checkActive(transaction);
      const latest = await transaction.get(ticketRef);
      if (
        latest.data()?.expiresAtMs <= now() ||
        !["PENDING", "VERIFIED"].includes(latest.data()?.status)
      )
        fail("failed-precondition", "MAP_UPLOAD_EXPIRED");
      transaction.set(
        ticketRef,
        { status: "VERIFIED", url, ...dimensions, verifiedAtMs: now() },
        { merge: true },
      );
    });
    return { uploadId, storagePath: ticket.storagePath, url, ...dimensions };
  };
const createExpiredMapUploadCleanup =
  ({ db, bucket, now = Date.now }) =>
  async () => {
    const expired = await db
      .collection(ASSET_COLLECTION)
      .where("expiresAtMs", "<=", now())
      .limit(100)
      .get();
    let removed = 0;
    for (const snapshot of expired.docs) {
      const ticket = await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(snapshot.ref);
        const data = latest.data();
        if (!data || data.expiresAtMs > now()) return null;
        if (["ATTACHED", "CLEANED", "CLEANUP_BLOCKED"].includes(data.status)) {
          transaction.set(
            snapshot.ref,
            { expiresAtMs: FieldValue.delete() },
            { merge: true },
          );
          return null;
        }
        if (data.storagePath !== `map_uploads/${snapshot.id}/source`) {
          transaction.set(
            snapshot.ref,
            {
              status: "CLEANUP_BLOCKED",
              cleanupError: "STORAGE_PATH_MISMATCH",
              expiresAtMs: FieldValue.delete(),
            },
            { merge: true },
          );
          return null;
        }
        transaction.set(snapshot.ref, { status: "EXPIRED" }, { merge: true });
        return data;
      });
      if (!ticket) continue;
      const file = bucket.file(ticket.storagePath);
      try {
        const [metadata] = await file.getMetadata();
        if (
          metadata.metadata?.uploadId !== snapshot.id ||
          metadata.metadata?.ownerUid !== ticket.ownerUid
        ) {
          await snapshot.ref.set(
            {
              status: "CLEANUP_BLOCKED",
              cleanupError: "STORAGE_METADATA_MISMATCH",
              expiresAtMs: FieldValue.delete(),
            },
            { merge: true },
          );
          continue;
        }
        await bucket
          .file(ticket.storagePath, { generation: metadata.generation })
          .delete();
      } catch (error) {
        if (Number(error.code) !== 404) throw error;
      }
      // Wait beyond the callable's 120-second maximum before removing its
      // tombstone, so no pre-expiry upload can recreate an untracked object.
      if (ticket.expiresAtMs < now() - 10 * 60 * 1000)
        await snapshot.ref.delete();
      removed++;
    }
    return { removed };
  };
module.exports = {
  MAP_COMMAND_TYPES,
  ASSET_COLLECTION,
  DOCUMENT_KEYS,
  FINGERPRINT_KEYS,
  fingerprint,
  normalizeMapPayload,
  createMapCommandAdapter,
  createMapUploadHandler,
  createExpiredMapUploadCleanup,
};
