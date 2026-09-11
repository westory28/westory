// Read-only validation for a teacher edit. New text is intentionally independent
// of the stored word; the stored word proves the original request connection.
const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const requestOrigin = require("./historyDictionaryRequestOrigin");

const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const termIdFor = (word) =>
  `term_${crypto.createHash("sha1").update(word).digest("hex")}`;
const pathId = (value, limit) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value === value.trim() &&
  !/[\/\\\x00-\x1f\x7f]/.test(value) &&
  value !== "." &&
  value !== "..";
const fail = (unverified = false) => {
  throw new HttpsError(
    "failed-precondition",
    unverified
      ? "현재 자료에서 수정 대상의 연결을 확인할 수 없습니다. 목록을 새로 고쳐 주세요."
      : "학생, 단어, 요청 또는 학기가 일치하지 않습니다. 목록을 새로 고쳐 주세요.",
    {
      reason: unverified
        ? "HISTORY_DICTIONARY_UPDATE_UNVERIFIED"
        : "HISTORY_DICTIONARY_UPDATE_MISMATCH",
    },
  );
};

const parseTarget = (data, { year, semester }) => {
  if (
    !pathId(data?.uid, 128) ||
    !pathId(data?.termId, 80) ||
    !/^\d{4}$/.test(year) ||
    !["1", "2"].includes(semester)
  )
    fail();
  return { uid: data.uid, termId: data.termId, year, semester };
};
const optionalExact = (data, key, expected) => {
  if (Object.hasOwn(data, key) && data[key] !== expected) fail();
};
const recordWord = (data) => {
  const words = ["word", "normalizedWord"]
    .filter((key) => Object.hasOwn(data, key))
    .map((key) => {
      if (typeof data[key] !== "string" || !normalize(data[key])) fail();
      return normalize(data[key]);
    });
  if (!words.length || words.some((word) => word !== words[0])) fail();
  return words[0];
};
const scopedRecord = (data, target, required = false) => {
  const year = String(data.year || ""),
    semester = String(data.semester || "");
  if (!year && !semester && !required) return false;
  if (year !== target.year || semester !== target.semester) fail();
  return true;
};

// Run before constructing a path from a stored request ID.
const inspectCurrent = ({ target, wordData, profile }) => {
  if (!profile) fail(true);
  optionalExact(profile, "uid", target.uid);
  optionalExact(wordData, "uid", target.uid);
  optionalExact(wordData, "termId", target.termId);
  const scoped = scopedRecord(wordData, target);
  const currentWord = recordWord(wordData);
  if (!["saved", "requested"].includes(wordData.status)) fail();
  const requestId = Object.hasOwn(wordData, "requestId")
    ? wordData.requestId
    : "";
  if (requestId !== "" && !pathId(requestId, 120)) fail();
  requestOrigin.readStoredOrigin(wordData, fail);
  if (
    Object.hasOwn(wordData, "rewardTermId") &&
    wordData.rewardTermId !== "" &&
    !pathId(wordData.rewardTermId, 80)
  )
    fail();
  const hasRewardEvidence =
    wordData.rewardTermId ||
    wordData.rewardTransactionId ||
    Number(wordData.rewardAmount || 0) > 0 ||
    wordData.rewardAwardedAt;
  // Do not turn the caller's chosen semester into unverified reward provenance.
  if (!scoped && hasRewardEvidence && !requestId) fail(true);
  return { requestId, currentWord, preserveUnscoped: !scoped && !requestId };
};

const inspectRequest = ({ target, wordData, binding, requestData }) => {
  if (!binding.requestId) return "";
  // Editing must not silently bless an orphaned link or synthesize a request.
  if (!requestData) fail(true);
  if (requestData.uid !== target.uid) fail();
  scopedRecord(requestData, target, true);
  const requestWord = recordWord(requestData);
  if (!["requested", "needs_approval", "resolved"].includes(requestData.status))
    fail();
  return requestOrigin.resolveOrigin({
    targetTermId: target.termId,
    requestId: binding.requestId,
    wordData,
    currentWord: binding.currentWord,
    requestWord,
    requestData,
    canonicalRequestTermId: termIdFor(requestWord),
    fail,
  });
};

module.exports = { parseTarget, inspectCurrent, inspectRequest };
