const { dictionaryTermPath, assertDictionaryActiveSemester } = require("./historyDictionaryScope");
const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const HISTORY_DICTIONARY_IMPORT_COMMAND_TYPES = Object.freeze({
  SAVE_HISTORY_DICTIONARY_TERMS_BULK: "saveHistoryDictionaryTermsBulk",
});
const MAX_TERMS = 200;
const fail = (code, message, reason) => {
  throw new HttpsError(code, message, { reason });
};
const invalid = () =>
  fail(
    "invalid-argument",
    "등록할 단어와 설명, 학기 정보를 확인해 주세요. 한 번에 최대 200개까지 등록할 수 있습니다.",
    "HISTORY_DICTIONARY_IMPORT_INVALID",
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
const text = (value, max, min = 0) => {
  if (typeof value !== "string") invalid();
  // Preserve the existing dictionary sanitizer's whitespace and case behavior,
  // but reject excess content instead of silently truncating a submitted row.
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < min || normalized.length > max) invalid();
  return normalized;
};
const normalizeHistoryDictionaryWord = (word) =>
  word.trim().replace(/\s+/g, " ").toLowerCase();
const buildHistoryDictionaryTermId = (normalizedWord) =>
  `term_${createHash("sha1").update(normalizedWord).digest("hex")}`;

const normalizeHistoryDictionaryImportPayload = (commandType, payload) => {
  if (
    commandType !==
    HISTORY_DICTIONARY_IMPORT_COMMAND_TYPES.SAVE_HISTORY_DICTIONARY_TERMS_BULK
  )
    invalid();
  allowedKeys(payload, ["year", "semester", "terms"]);
  const year = text(payload.year, 4, 4);
  const semester = text(payload.semester, 1, 1);
  if (!/^\d{4}$/.test(year) || !["1", "2"].includes(semester)) invalid();
  if (
    !Array.isArray(payload.terms) ||
    payload.terms.length < 1 ||
    payload.terms.length > MAX_TERMS
  )
    invalid();
  const seen = new Set();
  const terms = payload.terms.map((item) => {
    allowedKeys(item, [
      "word",
      "definition",
      "studentLevel",
      "relatedUnitId",
      "tags",
    ]);
    const word = text(item.word, 40, 1);
    const normalizedWord = normalizeHistoryDictionaryWord(word);
    if (seen.has(normalizedWord)) invalid();
    seen.add(normalizedWord);
    const rawTags = item.tags === undefined ? [] : item.tags;
    if (!Array.isArray(rawTags) || rawTags.length > 12) invalid();
    const tags = [];
    const seenTags = new Set();
    for (const value of rawTags) {
      const tag = text(value, 24);
      const key = tag.toLowerCase();
      if (!tag || seenTags.has(key)) continue;
      seenTags.add(key);
      tags.push(tag);
    }
    return {
      word,
      definition: text(item.definition, 1200, 5),
      studentLevel:
        text(item.studentLevel === undefined ? "" : item.studentLevel, 80) ||
        "중학생 수준",
      relatedUnitId: text(
        item.relatedUnitId === undefined ? "" : item.relatedUnitId,
        120,
      ),
      tags,
    };
  });
  // The frozen context is the actual semester storage boundary.
  return { year, semester, terms };
};

const createHistoryDictionaryImportCommandAdapter = () => ({
  apply: async ({
    transaction,
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
    )
      fail(
        "permission-denied",
        "역사 사전을 등록할 교사 권한이 필요합니다.",
        "HISTORY_DICTIONARY_IMPORT_TEACHER_REQUIRED",
      );
    await assertDictionaryActiveSemester(transaction, payload);
    const terms = payload.terms.map((term) => {
      const normalizedWord = normalizeHistoryDictionaryWord(term.word);
      return {
        ...term,
        normalizedWord,
        termId: buildHistoryDictionaryTermId(normalizedWord),
      };
    });
    const paths = terms.map((term) => dictionaryTermPath(payload, term.termId));
    // Gateway reads its actor-bound receipt first. Read every target before any
    // create so one conflict rolls back the whole import, receipt, and audit.
    const existing = await transaction.getAll(paths);
    if (existing.some((snapshot) => snapshot.exists))
      fail(
        "already-exists",
        "이미 등록된 단어가 있습니다. 목록을 새로 고친 뒤 중복 항목을 제외해 주세요.",
        "HISTORY_DICTIONARY_BULK_CONFLICT",
      );
    terms.forEach(({ termId, ...term }, index) => {
      transaction.create(paths[index], {
        ...term,
        year: payload.year, semester: payload.semester,
        status: "published",
        createdBy: actor.actorUid,
        updatedBy: actor.actorUid,
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: timestamp,
      });
    });
    return {
      target: { kind: "history-dictionary-import", id: receiptId, refs: paths },
      sourceHash: payloadHash,
      result: { savedCount: terms.length, termIds: terms.map((term) => term.termId) },
    };
  },
});

module.exports = {
  HISTORY_DICTIONARY_IMPORT_COMMAND_TYPES,
  normalizeHistoryDictionaryImportPayload,
  buildHistoryDictionaryTermId,
  createHistoryDictionaryImportCommandAdapter,
};
