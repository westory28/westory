// Read-only binding checks for the teacher deletion transaction.
const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const hash = (value) => crypto.createHash("sha1").update(value).digest("hex");
const termIdFor = (word) => `term_${hash(word)}`;
const requestIdFor = ({ year, semester, uid }, word) =>
  `req_${hash(`${year}:${semester}:${uid}:${word}`)}`;
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
      ? "현재 자료에서 삭제 대상을 확인할 수 없습니다. 목록을 새로 고쳐 주세요."
      : "학생, 단어, 요청 또는 학기가 일치하지 않습니다. 목록을 새로 고쳐 주세요.",
    {
      reason: unverified
        ? "HISTORY_DICTIONARY_DELETE_UNVERIFIED"
        : "HISTORY_DICTIONARY_DELETE_MISMATCH",
    },
  );
};

const parseTarget = (data, { year, semester }) => {
  const uid = data?.uid;
  const requestId = data?.requestId ?? "";
  const word = data?.word ?? "";
  const normalized = data?.normalizedWord ?? "";
  if (
    !pathId(uid, 128) ||
    (requestId !== "" && !pathId(requestId, 120)) ||
    typeof word !== "string" ||
    typeof normalized !== "string" ||
    (word && normalize(word).length > 40) ||
    (normalized && normalize(normalized).length > 40) ||
    (word && normalized && normalize(word) !== normalize(normalized))
  )
    fail();
  const normalizedWord = normalize(normalized || word);
  const suppliedTermId = data?.termId ?? "";
  if (suppliedTermId !== "" && !pathId(suppliedTermId, 80)) fail();
  const termId =
    suppliedTermId || (normalizedWord ? termIdFor(normalizedWord) : "");
  if (
    !pathId(termId, 80) ||
    !/^\d{4}$/.test(year) ||
    !["1", "2"].includes(semester)
  )
    fail();
  return {
    uid,
    requestId,
    termId,
    word: word.trim(),
    normalizedWord,
    year,
    semester,
  };
};

const recordWord = (data) => {
  const values = ["normalizedWord", "word"]
    .filter((key) => Object.hasOwn(data, key))
    .map((key) => {
      if (typeof data[key] !== "string" || !normalize(data[key])) fail();
      return normalize(data[key]);
    });
  if (!values.length || values.some((value) => value !== values[0])) fail();
  return values[0];
};
const scopedRecord = (data, target, required = false) => {
  const year = String(data.year || ""),
    semester = String(data.semester || "");
  if (!year && !semester && !required) return false;
  if (year !== target.year || semester !== target.semester) fail();
  return true;
};
const optionalExact = (data, key, expected) => {
  if (Object.hasOwn(data, key) && data[key] !== expected) fail();
};

const inspectTarget = ({ target, wordData, requestData, profile }) => {
  if (!profile) fail(true);
  optionalExact(profile, "uid", target.uid);
  let currentWord = "",
    wordScoped = false;
  if (wordData) {
    optionalExact(wordData, "uid", target.uid);
    optionalExact(wordData, "termId", target.termId);
    optionalExact(wordData, "requestId", target.requestId);
    wordScoped = scopedRecord(wordData, target);
    currentWord = recordWord(wordData);
    if (
      (target.normalizedWord && target.normalizedWord !== currentWord) ||
      !["saved", "requested"].includes(wordData.status) ||
      (wordData.rewardTermId && !pathId(wordData.rewardTermId, 80))
    )
      fail();
  }

  let requestWord = "";
  if (requestData) {
    if (!target.requestId || requestData.uid !== target.uid) fail();
    scopedRecord(requestData, target, true);
    requestWord = recordWord(requestData);
    if (
      !["requested", "needs_approval", "resolved", "rejected"].includes(
        requestData.status,
      )
    )
      fail();
    // The deleted row held the rename bridge. A closed retry must not invent it
    // or attempt another reward reclaim, request write, or notification.
    if (!wordData && ["rejected", "resolved"].includes(requestData.status))
      return {
        noop: true,
        rejectRequest: false,
        recoverRequest: false,
        reclaimAllowed: false,
      };
    if (wordData && requestData.status === "rejected") fail();
    let bindingTermId = target.termId;
    const movedReference = ["matchedTermId", "resolvedTermId"].some(
      (key) => requestData[key] && requestData[key] !== target.termId,
    );
    // Legacy IDs may move without changing the spelling, or after renaming
    // back to the original word. The same reviewed origin must prove the link.
    if (wordData && (requestWord !== currentWord || movedReference)) {
      if (
        wordData.definitionSource !== "teacher_reviewed" ||
        !pathId(wordData.reviewedBy, 128) ||
        !wordData.reviewedAt ||
        wordData.requestId !== target.requestId ||
        !pathId(wordData.rewardTermId, 80) ||
        (!requestData.matchedTermId &&
          !requestData.resolvedTermId &&
          wordData.rewardTermId !== termIdFor(requestWord))
      )
        fail();
      bindingTermId = wordData.rewardTermId;
    } else if (
      !wordData &&
      target.normalizedWord &&
      target.normalizedWord !== requestWord
    )
      fail();
    for (const key of ["matchedTermId", "resolvedTermId"])
      if (requestData[key] && requestData[key] !== bindingTermId) fail();
    if (
      !requestData.matchedTermId &&
      !requestData.resolvedTermId &&
      bindingTermId !== termIdFor(requestWord)
    )
      fail();
  } else if (target.requestId) {
    // A deterministic ID alone is public information, not recovery proof.
    if (
      !wordData ||
      profile.role !== "student" ||
      wordData.uid !== target.uid ||
      wordData.termId !== target.termId ||
      wordData.requestId !== target.requestId ||
      !wordScoped ||
      target.requestId !== requestIdFor(target, currentWord) ||
      target.termId !== termIdFor(currentWord)
    )
      fail(true);
  }

  const hasRewardEvidence =
    wordData &&
    (wordData.rewardTermId ||
      wordData.rewardTransactionId ||
      Number(wordData.rewardAmount || 0) > 0 ||
      wordData.rewardAwardedAt);
  // Official saved legacy rows may have no UID/scope and no reward. Keep their
  // deletion compatible without searching an arbitrary caller-selected ledger.
  if (hasRewardEvidence && !wordScoped && !requestData) fail(true);
  return {
    noop: !wordData && !requestData,
    rejectRequest: Boolean(target.requestId),
    recoverRequest: Boolean(target.requestId && !requestData),
    reclaimAllowed: Boolean(wordData && (wordScoped || requestData)),
    rewardTermId: wordData?.rewardTermId || target.termId,
    word: wordData?.word || requestData?.word || currentWord || requestWord,
    normalizedWord: currentWord || requestWord,
  };
};

const assertRewardBinding = ({ reward, reclaim, uid, sourceId }) => {
  if (
    reward &&
    (reward.uid !== uid ||
      reward.type !== "history_dictionary" ||
      reward.sourceId !== sourceId ||
      typeof reward.delta !== "number" ||
      !Number.isFinite(reward.delta))
  )
    fail();
  if (
    reclaim &&
    (reclaim.uid !== uid ||
      reclaim.type !== "history_dictionary_reclaim" ||
      reclaim.sourceId !== sourceId ||
      typeof reclaim.delta !== "number" ||
      !Number.isFinite(reclaim.delta) ||
      reclaim.delta >= 0 ||
      (reward && reclaim.delta !== -reward.delta))
  )
    fail();
};

module.exports = { parseTarget, inspectTarget, assertRewardBinding };
