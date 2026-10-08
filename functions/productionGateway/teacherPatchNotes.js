const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const PATCH_NOTE_COMMAND_TYPES = Object.freeze({
  CREATE_PATCH_NOTE: "createTeacherPatchNote",
  UPDATE_PATCH_NOTE: "updateTeacherPatchNote",
  UPDATE_PATCH_NOTE_STATUS: "updateTeacherPatchNoteStatus",
  DELETE_PATCH_NOTE: "deleteTeacherPatchNote",
});
const fail = (code, message, reason) => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () =>
  fail(
    "invalid-argument",
    "패치 메모의 내용을 확인해 주세요.",
    "PATCH_NOTE_INVALID",
  );
const allowedKeys = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
};
const text = (value, max, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    invalid();
  return value.trim();
};
const revision = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const noteKey = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const CONTENT_KEYS = [
  "title",
  "body",
  "type",
  "priority",
  "sourcePath",
  "targetLabel",
  "targetText",
  "targetSelector",
  "targetRect",
];
const normalizeContent = (content) => {
  allowedKeys(content, CONTENT_KEYS);
  const sourcePath = text(content.sourcePath, 240, true);
  if (!/^\/teacher(?:[/?#]|$)/.test(sourcePath)) invalid();
  if (
    !["bug", "improvement", "content", "etc"].includes(content.type) ||
    !["normal", "high"].includes(content.priority)
  )
    invalid();
  let targetRect = null;
  if (content.targetRect != null) {
    allowedKeys(content.targetRect, ["x", "y", "width", "height"]);
    targetRect = {};
    for (const key of ["x", "y", "width", "height"]) {
      const value = content.targetRect[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 10_000_000 ||
        (["width", "height"].includes(key) && value < 0)
      )
        invalid();
      targetRect[key] = Math.round(value);
    }
  }
  return {
    title: text(content.title, 80, true),
    body: text(content.body, 2000, true),
    type: content.type,
    priority: content.priority,
    sourcePath,
    targetLabel: text(content.targetLabel ?? "", 120),
    targetText: text(content.targetText ?? "", 240),
    targetSelector: text(content.targetSelector ?? "", 240),
    targetRect,
  };
};
const normalizePatchNotePayload = (commandType, payload) => {
  if (commandType === PATCH_NOTE_COMMAND_TYPES.CREATE_PATCH_NOTE) {
    allowedKeys(payload, ["content"]);
    return { content: normalizeContent(payload.content) };
  }
  const contentUpdate =
    commandType === PATCH_NOTE_COMMAND_TYPES.UPDATE_PATCH_NOTE;
  const statusUpdate =
    commandType === PATCH_NOTE_COMMAND_TYPES.UPDATE_PATCH_NOTE_STATUS;
  if (
    !contentUpdate &&
    !statusUpdate &&
    commandType !== PATCH_NOTE_COMMAND_TYPES.DELETE_PATCH_NOTE
  )
    invalid();
  allowedKeys(payload, [
    "noteId",
    "expectedNoteRevision",
    ...(contentUpdate ? ["content"] : statusUpdate ? ["status"] : []),
  ]);
  if (!noteKey(payload.noteId) || !revision(payload.expectedNoteRevision))
    invalid();
  const result = {
    noteId: payload.noteId,
    expectedNoteRevision: payload.expectedNoteRevision,
  };
  if (contentUpdate) result.content = normalizeContent(payload.content);
  if (statusUpdate) {
    if (!["open", "done"].includes(payload.status)) invalid();
    result.status = payload.status;
  }
  return result;
};

const createPatchNoteCommandAdapter = () => ({
  apply: async ({
    transaction,
    commandType,
    payload,
    payloadHash,
    receiptId,
    timestamp,
    actor,
  }) => {
    if (
      !actor?.actorUid ||
      actor.actorUid.includes("/") ||
      !["teacher", "admin"].includes(actor.actorRole)
    ) {
      fail(
        "permission-denied",
        "교사 개인 메모만 저장할 수 있습니다.",
        "PATCH_NOTE_TEACHER_REQUIRED",
      );
    }
    // The Gateway receipt binds actor + command type + client intent ID. Even
    // after deletion, replay of the original create cannot recreate this note.
    const creating = commandType === PATCH_NOTE_COMMAND_TYPES.CREATE_PATCH_NOTE;
    const noteId = creating
      ? `memo_${createHash("sha256").update(receiptId).digest("hex")}`
      : payload.noteId;
    const path = `teacherPatchNotes/${actor.actorUid}/notes/${noteId}`;
    const current = await transaction.get(path);
    if (creating && current.exists)
      fail(
        "already-exists",
        "이미 생성된 메모입니다. 목록을 다시 불러와 주세요.",
        "PATCH_NOTE_CREATE_CONFLICT",
      );
    if (!creating && !current.exists)
      fail(
        "not-found",
        "메모가 삭제되었습니다. 작성 중인 내용은 유지됩니다.",
        "PATCH_NOTE_NOT_FOUND",
      );
    if (current.exists && current.data.ownerUid !== actor.actorUid)
      fail(
        "permission-denied",
        "본인 메모만 변경할 수 있습니다.",
        "PATCH_NOTE_OWNER_MISMATCH",
      );
    const currentRevision =
      current.exists && Object.hasOwn(current.data, "noteRevision")
        ? current.data.noteRevision
        : 0;
    if (!revision(currentRevision))
      fail(
        "failed-precondition",
        "메모의 저장 버전을 확인할 수 없습니다.",
        "PATCH_NOTE_REVISION_INVALID",
      );
    if (!creating && currentRevision !== payload.expectedNoteRevision)
      fail(
        "aborted",
        "다른 화면에서 메모가 변경되었습니다. 작성 내용은 유지되므로 목록에서 최신 메모를 확인해 주세요.",
        "PATCH_NOTE_CONFLICT",
      );
    const noteRevision = currentRevision + 1;
    const deleting = commandType === PATCH_NOTE_COMMAND_TYPES.DELETE_PATCH_NOTE;
    const status = creating
      ? "open"
      : commandType === PATCH_NOTE_COMMAND_TYPES.UPDATE_PATCH_NOTE_STATUS
        ? payload.status
        : current.data.status;
    if (!deleting && !["open", "done"].includes(status))
      fail(
        "failed-precondition",
        "메모의 처리 상태를 확인할 수 없습니다.",
        "PATCH_NOTE_STATUS_INVALID",
      );
    if (creating) {
      transaction.create(path, {
        ...payload.content,
        ownerUid: actor.actorUid,
        noteRevision,
        status,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (deleting) {
      transaction.delete(path);
    } else {
      transaction.set(path, {
        ...current.data,
        ...(payload.content || {}),
        ...(commandType === PATCH_NOTE_COMMAND_TYPES.UPDATE_PATCH_NOTE_STATUS
          ? { status, completedAt: status === "done" ? timestamp : null }
          : {}),
        noteRevision,
        updatedAt: timestamp,
      });
    }
    return {
      target: { kind: "teacher-patch-note", id: noteId, refs: [path] },
      sourceHash: payloadHash,
      result: {
        noteId,
        noteRevision,
        status: status || null,
        deleted: deleting,
      },
    };
  },
});
module.exports = {
  PATCH_NOTE_COMMAND_TYPES,
  normalizePatchNotePayload,
  createPatchNoteCommandAdapter,
};
