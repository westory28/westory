const { createHash } = require("node:crypto");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");
const sharp = require("sharp");
const { onCallWithStudentMaintenance } = require("./studentMaintenance");
const {
  assertStudentRegistrationAccess,
} = require("./studentRegistrationAccess");
const { assertActiveApplicationSession } = require("./sessionAuthority");

const BUCKET_NAME = "history-quiz-yongsin.firebasestorage.app";
const ADMIN_EMAIL = "westoria28@gmail.com";
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 8;
const ASSET_PATH =
  /^years\/(\d{4})\/semesters\/([12])\/written_exam_analyses\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,80}\.(pdf|png|webp))$/;
const TYPES = { pdf: "application/pdf", png: "image/png", webp: "image/webp" };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid = (message) => new HttpsError("invalid-argument", message);
const conflict = () =>
  new HttpsError(
    "failed-precondition",
    "이미 등록 중인 자료와 내용이 다릅니다. 등록 상태를 새로고침한 뒤 다시 시도해 주세요.",
  );
const missing = (error) => Number(error?.code) === 404;
const payload = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw invalid("자료 요청 정보를 확인해 주세요.");
  const { _session, ...value } = data;
  const keys =
    value.action === "upload"
      ? [
          "action",
          "storagePath",
          "contentType",
          "totalSize",
          "sha256",
          "chunkIndex",
          "contentBase64",
        ]
      : value.action === "read"
        ? ["action", "storagePath", "chunkIndex"]
        : value.action === "remove"
          ? ["action", "storagePath"]
          : [];
  if (
    !keys.length ||
    Object.keys(value).sort().join("|") !== keys.sort().join("|")
  )
    throw invalid("자료 요청 항목이 올바르지 않습니다.");
  return value;
};
const parsePath = (storagePath) => {
  const match = typeof storagePath === "string" && ASSET_PATH.exec(storagePath);
  if (!match) throw invalid("원안지 자료 경로가 올바르지 않습니다.");
  const [, year, semester, examId, revision, fileName, extension] = match;
  const manifestPath = `years/${year}/semesters/${semester}/written_exam_analyses/${examId}`;
  return {
    storagePath,
    year,
    semester,
    examId,
    revision,
    fileName,
    extension,
    manifestPath,
    revisionPath: `${manifestPath}/revisions/${revision}`,
    contentType: TYPES[extension],
    maxBytes: (extension === "pdf" ? 30 : 12) * 1024 * 1024,
  };
};
const decodeChunk = (data, scope) => {
  if (
    data.contentType !== scope.contentType ||
    !Number.isSafeInteger(data.totalSize) ||
    data.totalSize < 1 ||
    data.totalSize > scope.maxBytes ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    !Number.isSafeInteger(data.chunkIndex) ||
    data.chunkIndex < 0 ||
    data.chunkIndex >= Math.ceil(data.totalSize / CHUNK_BYTES) ||
    typeof data.contentBase64 !== "string" ||
    !data.contentBase64.length ||
    data.contentBase64.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
    data.contentBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.contentBase64)
  )
    throw invalid("파일 형식·용량 또는 분할 정보를 확인해 주세요.");
  const bytes = Buffer.from(data.contentBase64, "base64");
  const expected = Math.min(
    CHUNK_BYTES,
    data.totalSize - data.chunkIndex * CHUNK_BYTES,
  );
  if (
    bytes.length !== expected ||
    bytes.toString("base64") !== data.contentBase64
  )
    throw invalid("분할 파일 내용이 올바르지 않습니다.");
  return bytes;
};
const validateFile = async (bytes, scope) => {
  if (scope.extension === "pdf") {
    if (
      !/^%PDF-[12]\.\d/.test(bytes.toString("ascii", 0, 8)) ||
      !bytes
        .subarray(Math.max(0, bytes.length - 2048))
        .includes(Buffer.from("%%EOF"))
    )
      throw invalid("PDF 파일 내용을 확인해 주세요.");
    return;
  }
  const magic =
    scope.extension === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
  if (!magic)
    throw invalid("페이지 이미지 형식과 파일 내용이 일치하지 않습니다.");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 64 * 1024 * 1024,
      failOn: "warning",
    });
    const info = await image.metadata();
    if (
      info.format !== scope.extension ||
      !info.width ||
      !info.height ||
      info.width > 8192 ||
      info.height > 8192 ||
      (info.pages || 1) !== 1
    )
      throw new Error("invalid image");
    await image.stats();
  } catch (_) {
    throw invalid(
      "페이지 이미지를 읽을 수 없습니다. PNG·WebP 정지 이미지를 사용해 주세요.",
    );
  }
};

const createWrittenExamAssetHandler = ({
  db,
  bucket,
  assertSession = assertActiveApplicationSession,
} = {}) => {
  if (!db || !bucket || typeof assertSession !== "function")
    throw new TypeError(
      "Written exam assets require database, bucket and session guard.",
    );
  const assertManager = async (request) => {
    const identity = await assertSession(request);
    const uid = request.auth?.uid;
    if (!uid || (identity?.uid && identity.uid !== uid))
      throw new HttpsError("unauthenticated", "다시 로그인해 주세요.");
    const email = String(request.auth.token?.email || "")
      .trim()
      .toLowerCase();
    if (email !== ADMIN_EMAIL) {
      if (!/@yongshin-ms\.ms\.kr$/.test(email))
        throw new HttpsError(
          "permission-denied",
          "시험 자료를 관리할 권한이 없습니다.",
        );
      const snap = await db.doc(`users/${uid}`).get();
      const profile = snap.exists ? snap.data() : undefined;
      assertStudentRegistrationAccess(profile, snap.exists);
      if (profile.role !== "teacher")
        throw new HttpsError(
          "permission-denied",
          "시험 자료를 관리할 권한이 없습니다.",
        );
    }
    return uid;
  };
  const assertStage = async (scope, uid, transaction, allowCleanup = false) => {
    const get = (ref) => (transaction ? transaction.get(ref) : ref.get());
    // Read the canonical pointer and manifest, never a browser-supplied semester.
    const [pointerSnap, semesterSnap, revisionSnap] = await Promise.all([
      get(db.doc("site_settings/semester_active")),
      get(db.doc(`semester_manifests/${scope.year}-${scope.semester}`)),
      get(db.doc(scope.revisionPath)),
    ]);
    const pointer = pointerSnap.exists ? pointerSnap.data() : {};
    const semester = semesterSnap.exists ? semesterSnap.data() : {};
    const revision = revisionSnap.exists ? revisionSnap.data() : {};
    if (
      pointer.semesterId !== `${scope.year}-${scope.semester}` ||
      !Number.isSafeInteger(pointer.revision) ||
      pointer.revision < 0 ||
      !semesterSnap.exists ||
      semester.semesterId !== pointer.semesterId ||
      semester.revision !== pointer.revision ||
      semester.status !== "ACTIVE" ||
      semester.readOnly === true
    )
      throw new HttpsError(
        "failed-precondition",
        "현재 학기가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      );
    if (
      !revisionSnap.exists ||
      (revision.state !== "staging" &&
        !(allowCleanup && revision.state === "cleanup")) ||
      revision.uploadedBy !== uid ||
      revision.year !== scope.year ||
      revision.semester !== scope.semester ||
      revision.examId !== scope.examId ||
      revision.revision !== scope.revision
    )
      throw new HttpsError(
        "permission-denied",
        "등록 중인 본인 자료만 변경할 수 있습니다.",
      );
    return revision;
  };
  const lockedStage = (scope, uid, action) =>
    db.runTransaction(
      async (transaction) => {
        await assertStage(scope, uid, transaction);
        // Admin read-write transactions retain pessimistic locks through the GCS
        // operation. Never retry a callback with an external side effect.
        return action();
      },
      { maxAttempts: 1 },
    );
  const metadata = async (file) => {
    try {
      return (await file.getMetadata())[0];
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  };
  const chunkPath = (scope, index) =>
    `${scope.storagePath.slice(0, scope.storagePath.lastIndexOf("/"))}/_chunks/${digest(scope.fileName)}-${index}`;
  const matches = (meta, expected, size, contentType) =>
    meta &&
    Number(meta.size) === size &&
    meta.contentType === contentType &&
    Object.entries(expected).every(
      ([key, value]) => meta.metadata?.[key] === String(value),
    );
  const saveImmutable = async (file, bytes, contentType, custom) => {
    try {
      await file.save(bytes, {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          cacheControl: "private, no-store",
          metadata: custom,
        },
      });
    } catch (error) {
      // A lost response is recoverable; a different payload at this path is not.
      if (!matches(await metadata(file), custom, bytes.length, contentType)) {
        if (Number(error?.code) === 412) throw conflict();
        throw error;
      }
    }
  };
  const removeChunks = async (scope, count = MAX_CHUNKS) => {
    for (let index = 0; index < count; index++)
      await bucket
        .file(chunkPath(scope, index))
        .delete({ ignoreNotFound: true });
  };
  return async (request) => {
    const uid = await assertManager(request);
    const data = payload(request.data);
    const scope = parsePath(data.storagePath);
    if (data.action === "remove") {
      // Commit the cancellation before deleting any bytes. A publisher waiting
      // on this transaction must observe cleanup and cannot publish missing files.
      await db.runTransaction(
        async (transaction) => {
          const revision = await assertStage(scope, uid, transaction, true);
          if (revision.state === "staging")
            transaction.update(db.doc(scope.revisionPath), {
              state: "cleanup",
            });
        },
        // This callback only changes Firestore state. Retry contention between
        // cleanup calls for different files in the same revision safely.
        { maxAttempts: 5 },
      );
      await bucket.file(scope.storagePath).delete({ ignoreNotFound: true });
      await removeChunks(scope);
      return { deleted: true };
    }
    if (data.action === "read") {
      if (
        !Number.isSafeInteger(data.chunkIndex) ||
        data.chunkIndex < 0 ||
        data.chunkIndex >= MAX_CHUNKS
      )
        throw invalid("자료 분할 번호가 올바르지 않습니다.");
      const [revisionSnap, manifestSnap] = await Promise.all([
        db.doc(scope.revisionPath).get(),
        db.doc(scope.manifestPath).get(),
      ]);
      const revision = revisionSnap.exists ? revisionSnap.data() : {};
      const manifest = manifestSnap.exists ? manifestSnap.data() : {};
      const listed =
        Array.isArray(manifest.files) &&
        manifest.files.find((file) => file.fileName === scope.fileName);
      if (
        !revisionSnap.exists ||
        revision.state !== "ready" ||
        revision.year !== scope.year ||
        revision.semester !== scope.semester ||
        revision.examId !== scope.examId ||
        revision.revision !== scope.revision ||
        !manifestSnap.exists ||
        manifest.revision !== scope.revision ||
        manifest.year !== scope.year ||
        manifest.semester !== scope.semester ||
        !listed ||
        listed.contentType !== scope.contentType
      )
        throw new HttpsError(
          "permission-denied",
          "등록 완료된 시험 자료만 열 수 있습니다.",
        );
      const file = bucket.file(scope.storagePath);
      const meta = await metadata(file);
      const totalSize = Number(meta?.size);
      if (
        !meta ||
        !Number.isSafeInteger(totalSize) ||
        totalSize < 1 ||
        totalSize > scope.maxBytes ||
        totalSize !== listed.size ||
        meta.contentType !== scope.contentType ||
        data.chunkIndex >= Math.ceil(totalSize / CHUNK_BYTES) ||
        !Object.entries({
          ownerUid: revision.uploadedBy,
          year: scope.year,
          semester: scope.semester,
          examId: scope.examId,
          revision: scope.revision,
        }).every(
          ([key, value]) =>
            typeof value === "string" && meta.metadata?.[key] === value,
        )
      )
        throw new HttpsError(
          "failed-precondition",
          "등록된 자료 정보를 확인할 수 없습니다.",
        );
      const start = data.chunkIndex * CHUNK_BYTES;
      const end = Math.min(totalSize, start + CHUNK_BYTES) - 1;
      const [bytes] = await bucket
        .file(scope.storagePath, { generation: meta.generation })
        .download({ start, end, validation: false });
      if (bytes.length !== end - start + 1)
        throw new HttpsError(
          "data-loss",
          "자료의 일부를 읽지 못했습니다. 다시 시도해 주세요.",
        );
      return {
        contentBase64: bytes.toString("base64"),
        contentType: scope.contentType,
        totalSize,
        chunkIndex: data.chunkIndex,
        ...(/^[a-f0-9]{64}$/.test(meta.metadata?.sha256 || "")
          ? { sha256: meta.metadata.sha256 }
          : {}),
      };
    }
    const bytes = decodeChunk(data, scope);
    const ownerMetadata = {
      ownerUid: uid,
      year: scope.year,
      semester: scope.semester,
      examId: scope.examId,
      revision: scope.revision,
      sha256: data.sha256,
    };
    const destination = bucket.file(scope.storagePath);
    const count = Math.ceil(data.totalSize / CHUNK_BYTES);
    await assertStage(scope, uid);
    const previous = await metadata(destination);
    if (previous) {
      if (!matches(previous, ownerMetadata, data.totalSize, data.contentType))
        throw conflict();
      const start = data.chunkIndex * CHUNK_BYTES;
      const [stored] = await bucket
        .file(scope.storagePath, { generation: previous.generation })
        .download({ start, end: start + bytes.length - 1, validation: false });
      if (!stored.equals(bytes)) throw conflict();
      if (count > 1)
        await lockedStage(scope, uid, () => removeChunks(scope, count));
      return { accepted: true, complete: true };
    }
    if (count === 1) {
      if (digest(bytes) !== data.sha256)
        throw invalid("파일 검증값이 일치하지 않습니다. 다시 등록해 주세요.");
      await validateFile(bytes, scope);
      await assertManager(request);
      await lockedStage(scope, uid, () =>
        saveImmutable(destination, bytes, data.contentType, ownerMetadata),
      );
      return { accepted: true, complete: true };
    }
    const chunkMetadata = {
      ...ownerMetadata,
      totalSize: String(data.totalSize),
      chunkIndex: String(data.chunkIndex),
      contentType: data.contentType,
      chunkHash: digest(bytes),
    };
    await lockedStage(scope, uid, () =>
      saveImmutable(
        bucket.file(chunkPath(scope, data.chunkIndex)),
        bytes,
        "application/octet-stream",
        chunkMetadata,
      ),
    );
    if (data.chunkIndex !== count - 1)
      return { accepted: true, complete: false };
    const buffers = [];
    for (let index = 0; index < count; index++) {
      const file = bucket.file(chunkPath(scope, index));
      const meta = await metadata(file);
      const expectedSize = Math.min(
        CHUNK_BYTES,
        data.totalSize - index * CHUNK_BYTES,
      );
      if (
        !matches(
          meta,
          {
            ...ownerMetadata,
            totalSize: String(data.totalSize),
            chunkIndex: String(index),
            contentType: data.contentType,
          },
          expectedSize,
          "application/octet-stream",
        )
      )
        throw new HttpsError(
          "failed-precondition",
          "파일의 일부가 누락되었거나 내용이 다릅니다. 다시 등록해 주세요.",
        );
      const [part] = await bucket
        .file(chunkPath(scope, index), { generation: meta.generation })
        .download();
      if (
        part.length !== expectedSize ||
        digest(part) !== meta.metadata.chunkHash
      )
        throw new HttpsError(
          "data-loss",
          "분할 파일의 내용이 일치하지 않습니다.",
        );
      buffers.push(part);
    }
    const combined = Buffer.concat(buffers);
    if (combined.length !== data.totalSize || digest(combined) !== data.sha256)
      throw invalid("파일 검증값이 일치하지 않습니다. 다시 등록해 주세요.");
    await validateFile(combined, scope);
    await assertManager(request);
    await lockedStage(scope, uid, async () => {
      await saveImmutable(
        destination,
        combined,
        data.contentType,
        ownerMetadata,
      );
      // Do not acknowledge completion until all private chunks are removed.
      // A failed cleanup keeps the revision staging and is retried above.
      await removeChunks(scope, count);
    });
    return { accepted: true, complete: true };
  };
};
let defaultHandler;
const handler = () =>
  (defaultHandler ||= createWrittenExamAssetHandler({
    db: getFirestore(),
    bucket: getStorage().bucket(BUCKET_NAME),
  }));
module.exports = {
  CHUNK_BYTES,
  createWrittenExamAssetHandler,
  manageWrittenExamAsset: onCallWithStudentMaintenance(
    {
      region: "asia-northeast3",
      memory: "512MiB",
      timeoutSeconds: 120,
      concurrency: 1,
      minInstances: 0,
      maxInstances: 5,
    },
    (request) => handler()(request),
  ),
};
