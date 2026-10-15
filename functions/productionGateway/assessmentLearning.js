// Diagnostic observations never change grading, rewards, or attempt eligibility.
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const safeText = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const safeKey = value => value && !["__proto__", "constructor", "prototype"].includes(value);
const finiteInteger = (value, max) => Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : null;

const normalizeQuestionLearning = value => {
  const concepts = Array.isArray(value?.concepts)
    ? [...new Set(value.concepts.map(item => safeText(item, 60)).filter(Boolean))].slice(0, 8) : [];
  const misconceptionTags = object(value?.misconceptionTags)
    ? Object.fromEntries(Object.entries(value.misconceptionTags).slice(0, 10)
      .filter(([key, tag]) => safeKey(key) && key.length <= 500 && typeof tag === "string" && tag.trim())
      .map(([key, tag]) => [key, safeText(tag, 120)])) : {};
  return {
    concepts,
    cognitiveProcess: safeText(value?.cognitiveProcess, 60),
    familyId: safeText(value?.familyId),
    derivedFromQuestionId: safeText(value?.derivedFromQuestionId),
    misconceptionTags,
    reviewLessonId: safeText(value?.reviewLessonId),
  };
};

const questionLearningSnapshot = document => {
  const value = document.data || {};
  const snapshot = {
    id: String(value.id ?? document.path.split("/").at(-1)),
    docId: document.path.split("/").at(-1),
    sourceRevision: safeText(String(value.contentRevision || value.revision || "legacy"), 80),
    unitId: safeText(value.unitId), subUnitId: safeText(value.subUnitId),
    refBig: safeText(value.refBig), refMid: safeText(value.refMid), refSmall: safeText(value.refSmall),
    ...normalizeQuestionLearning(value),
  };
  // At most 200 rows * 2 KiB: diagnostic metadata must not overflow the
  // Firestore attempt/result document or prevent a student from starting.
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= 2048) return snapshot;
  const reduced = { ...snapshot, misconceptionTags: {}, metadataLimited: true };
  if (Buffer.byteLength(JSON.stringify(reduced), "utf8") <= 2048) return reduced;
  const minimal = { id: snapshot.id, sourceRevision: snapshot.sourceRevision,
    unitId: snapshot.unitId, subUnitId: snapshot.subUnitId, concepts: [], metadataLimited: true };
  if (Buffer.byteLength(JSON.stringify(minimal), "utf8") <= 2048) return minimal;
  return { id: snapshot.id, concepts: [], metadataLimited: true };
};

// Invalid optional diagnostics are discarded, never rejected with the answers.
// Bounds apply again against the server-owned attempt before persistence.
const normalizeAnalytics = (value, attempt, nowMs = Date.now(), answers) => {
  if (!object(value) || value.version !== 1 || !object(value.questions)) return null;
  const entries = Object.entries(value.questions);
  if (entries.length > 200) return null;
  const maxMs = attempt
    ? Math.max(0, Math.min(21_600_000, nowMs - Date.parse(attempt.startedAtIso)))
    : 21_600_000;
  if (!Number.isFinite(maxMs)) return null;
  const allowed = attempt ? new Set(attempt.questionIds || []) : null;
  let partial = value.quality !== "complete";
  let totalMs = 0;
  const questions = {};
  for (const [id, item] of entries) {
    if (!safeKey(id) || id.length > 160 || (allowed && !allowed.has(id)) || !object(item)) { partial = true; continue; }
    const activeMs = finiteInteger(item.activeMs, maxMs);
    const hiddenMs = finiteInteger(item.hiddenMs, maxMs);
    const changes = finiteInteger(item.answerChangeCount, 10_000);
    const revisits = finiteInteger(item.revisitCount, 10_000);
    if (activeMs === null || hiddenMs === null || changes === null || revisits === null || activeMs + hiddenMs > maxMs + 1000) { partial = true; continue; }
    const first = item.firstResponseMs === null ? null : finiteInteger(item.firstResponseMs, activeMs);
    const final = item.finalResponseMs === null ? null : finiteInteger(item.finalResponseMs, activeMs);
    const unanswered = answers && !String(answers[id] || "").trim();
    const validTimes = (item.firstResponseMs === null || first !== null)
      && (item.finalResponseMs === null || final !== null)
      && (first === null || final === null || first <= final);
    const quality = item.quality === "complete" && validTimes
      && (!answers || unanswered || (first !== null && final !== null)) ? "complete" : "partial";
    if (quality === "partial") partial = true;
    questions[id] = {
      activeMs, hiddenMs,
      firstResponseMs: unanswered || !validTimes ? null : first,
      finalResponseMs: unanswered || !validTimes ? null : final,
      answerChangeCount: changes, revisitCount: revisits,
      hintViewed: item.hintViewed === true,
      quality,
    };
    totalMs += activeMs + hiddenMs;
  }
  if (totalMs > maxMs + 1000) return null;
  if (allowed && answers && [...allowed].some(id => String(answers[id] || "").trim() && !questions[id])) partial = true;
  return { version: 1, quality: partial ? "partial" : "complete", questions };
};

const rankLearningCandidates = (source, priorAttempts) => {
  const seen = new Set();
  const needsReview = new Set();
  const latestByQuestion = new Map();
  for (const attempt of [...priorAttempts].sort((a, b) => String(a.submittedAtIso || "").localeCompare(String(b.submittedAtIso || "")))) {
    for (const id of attempt.questionIds || []) seen.add(id);
    if (attempt.status !== "SUBMITTED") continue;
    for (const item of attempt.gradingSnapshot || []) {
      const clean = value => String(value ?? "").replace(/\s+/g, "").trim();
      latestByQuestion.set(item.id, { needsReview: clean(attempt.answers?.[item.id]) !== clean(item.answer) || attempt.analytics?.questions?.[item.id]?.hintViewed === true,
        concepts: attempt.learningSnapshot?.find(question => question.id === item.id)?.concepts || [] });
    }
  }
  for (const item of latestByQuestion.values()) if (item.needsReview) for (const concept of item.concepts) needsReview.add(concept);
  return new Map((source.answerKey || []).map(item => {
    const concepts = source.learningSnapshot?.find(question => question.id === item.id)?.concepts || [];
    const review = concepts.some(concept => needsReview.has(concept));
    return [item.id, !seen.has(item.id) ? (review ? 0 : 1) : (latestByQuestion.get(item.id)?.needsReview ? 2 : 3)];
  }));
};

// An omitted snapshot is explicit; never truncate source material into a false
// historical question. Reserve headroom for Firestore field/index overhead.
const boundQuestionSnapshots = (candidates, questionIds, baseDocument = {}) => {
  let remaining = Math.max(0, Math.min(128 * 1024, 750_000 - Buffer.byteLength(JSON.stringify(baseDocument), "utf8")));
  const byId = new Map(candidates.map(item => [String(item.id), item]));
  const questionSnapshots = [], questionSnapshotOmittedIds = [];
  for (const id of questionIds) {
    const snapshot = byId.get(String(id));
    const size = snapshot ? Buffer.byteLength(JSON.stringify(snapshot), "utf8") + 2 : Infinity;
    if (size > 32 * 1024 || size > remaining) { questionSnapshotOmittedIds.push(String(id)); continue; }
    questionSnapshots.push(snapshot);
    remaining -= size;
  }
  return { questionSnapshots, questionSnapshotOmittedIds };
};

const captureQuestionSnapshots = (documents, questionIds, baseDocument) => {
  const candidates = [];
  const selected = new Set(questionIds.map(String));
  for (const document of documents) {
    const source = document.data || {};
    const id = String(source.id ?? document.path.split("/").at(-1));
    if (!selected.has(id) || typeof source.question !== "string"
      || !["choice", "ox", "short", "word", "order", "matching"].includes(source.type)) continue;
    const snapshot = { id, question: source.question, type: source.type, answer: String(source.answer ?? "") };
    for (const key of ["explanation", "passage", "image", "hint", "unitId", "subUnitId", "refBig", "refMid", "refSmall"])
      if (typeof source[key] === "string") snapshot[key] = source[key];
    if (typeof source.hintEnabled === "boolean") snapshot.hintEnabled = source.hintEnabled;
    if (Array.isArray(source.options) && source.options.every(item => typeof item === "string")) snapshot.options = [...source.options];
    if (source.type === "order" && !snapshot.options?.length)
      snapshot.options = snapshot.answer.split("||").map(item => item.trim()).filter(Boolean);
    if (Array.isArray(source.choiceOptionImages) && source.choiceOptionImages.every(item => item === null || typeof item === "string")) snapshot.choiceOptionImages = [...source.choiceOptionImages];
    if (source.type === "matching") {
      const pairs = Array.isArray(source.matchingPairs) && source.matchingPairs.length ? source.matchingPairs
        : snapshot.answer.split("||").map(item => { const [left, right] = item.split("=>"); return { left, right }; });
      snapshot.matchingPairs = pairs.filter(pair => typeof pair?.left === "string" && typeof pair?.right === "string")
        .map(pair => ({ left: pair.left, right: pair.right, ...(typeof pair.rightImage === "string" ? { rightImage: pair.rightImage } : {}) }));
    }
    candidates.push(snapshot);
  }
  return boundQuestionSnapshots(candidates, questionIds, baseDocument);
};

const questionPresentation = (snapshots) => snapshots.map(snapshot => {
  const { answer, explanation, matchingPairs, ...presentation } = snapshot;
  if (snapshot.type === "order" && presentation.options) presentation.options = [...presentation.options].sort();
  if (snapshot.type === "matching") {
    // Separate sorted lists carry the choices without exposing correct pairings.
    presentation.matchingLeftOptions = (matchingPairs || []).map(pair => pair.left);
    presentation.matchingRightOptions = (matchingPairs || []).map(pair => ({ right: pair.right, rightImage: pair.rightImage || null }))
      .sort((a, b) => a.right.localeCompare(b.right));
  }
  return presentation;
});

module.exports = { normalizeQuestionLearning, questionLearningSnapshot, normalizeAnalytics, rankLearningCandidates,
  captureQuestionSnapshots, boundQuestionSnapshots, questionPresentation };
