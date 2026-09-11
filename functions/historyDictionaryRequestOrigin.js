// A request's original term and a reward's original term are independent.
// Callers validate UID, semester, request identity/status and normalized text
// before using this read-only origin check. Client-supplied origins are ignored.
const pathId = (value, limit) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value === value.trim() &&
  !/[\/\\\x00-\x1f\x7f]/.test(value) &&
  value !== "." &&
  value !== "..";

const readStoredOrigin = (wordData, fail) => {
  const value =
    wordData && Object.hasOwn(wordData, "requestOriginTermId")
      ? wordData.requestOriginTermId
      : "";
  if (value !== "" && !pathId(value, 80)) fail();
  return value;
};

const resolveOrigin = ({
  targetTermId,
  requestId,
  wordData,
  currentWord,
  requestWord,
  requestData,
  canonicalRequestTermId,
  fail,
}) => {
  const explicitOrigin = readStoredOrigin(wordData, fail);
  let origin = explicitOrigin || targetTermId;
  const movedReference = ["matchedTermId", "resolvedTermId"].some(
    (key) => requestData[key] && requestData[key] !== targetTermId,
  );
  if (
    wordData &&
    (requestWord !== currentWord ||
      movedReference ||
      (explicitOrigin && explicitOrigin !== targetTermId))
  ) {
    if (
      wordData.definitionSource !== "teacher_reviewed" ||
      !pathId(wordData.reviewedBy, 128) ||
      !wordData.reviewedAt ||
      wordData.requestId !== requestId
    )
      fail();
    // Only records without an explicit origin use the previous reviewed bridge.
    // A contradictory explicit origin never falls back to the reward pointer.
    origin = explicitOrigin || wordData.rewardTermId;
    if (!pathId(origin, 80)) fail();
  }
  for (const key of ["matchedTermId", "resolvedTermId"])
    if (requestData[key] && requestData[key] !== origin) fail();
  if (
    !requestData.matchedTermId &&
    !requestData.resolvedTermId &&
    origin !== canonicalRequestTermId
  )
    fail();
  return origin;
};

module.exports = { readStoredOrigin, resolveOrigin };
