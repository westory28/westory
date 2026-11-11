"use strict";

// Teacher corrections are a separate projection. Frozen questions, submissions,
// attempt eligibility and the original reward ledger are never rewritten.
const { createHash } = require("node:crypto");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { isQuizAnswerCorrect } = require("./quizAnswerMatching");
const { normalizeAchievementMetadata } = require("./historyAchievementMetadata");

const hash = value => createHash("sha256").update(value).digest("hex");
const text = value => String(value ?? "").trim();
const hasAnswers = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const version = question => String(question?.contentRevision || question?.revision || "legacy");
const correctionKey = (scope, docId) => hash(`${scope}\n${docId}`);
const indexKey = definitionId => hash(definitionId);
const idOf = (question, docId) => text(question?.id ?? docId);
const definitionIdOf = (scope, question) => ["quiz", scope, question.unitId, question.category, question.examRound]
  .filter(Boolean).join(":").replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 180);
const fingerprint = question => hash(canonical({
  type: text(question?.type), question: text(question?.question),
  options: question?.type === "order" && !question.options?.length ? text(question.answer).split("||").map(text).filter(Boolean) : question?.options || [],
  choiceOptionImages: question?.choiceOptionImages || [],
  matchingPairs: question?.type === "matching" ? question.matchingPairs?.length ? question.matchingPairs
    : text(question.answer).split("||").map(pair => { const [left, right] = pair.split("=>"); return { left, right }; }) : [],
  passage: text(question?.passage), examplePassage: text(question?.examplePassage), image: text(question?.image),
  passageSet: question?.passageSet ? { id: text(question.passageSet.id), instruction: text(question.passageSet.instruction),
    passage: text(question.passageSet.passage), image: text(question.passageSet.image) } : null,
  examRound: text(question?.examRound), paperOrder: question?.paperOrder ?? null, points: question?.points ?? null,
}));

// Analysis identity describes what pupils saw, not the grading key or learning
// tags. Call only with a complete original/bank document, before compacting it.
// A missing historical presentation deliberately retains revision-based identity.
const paperMaterialHash = question => question && text(question.question)
  && ["choice", "ox", "short", "word", "order", "matching"].includes(question.type)
  ? fingerprint(question) : "";

function withQuizPaperMaterialHashes(raw, snapshotCache) {
  const withoutMaterialHash = value => {
    const { paperMaterialHash: _derived, ...original } = value;
    return original;
  };
  if (!Array.isArray(raw?.questionSnapshots)) return Array.isArray(raw?.learningSnapshot)
    ? { ...raw, learningSnapshot: raw.learningSnapshot.map(withoutMaterialHash) } : raw;
  const materials = new Map();
  const questionSnapshots = raw.questionSnapshots.map(question => {
    const cached = snapshotCache?.get(question);
    const digest = cached?.paperMaterialHash || paperMaterialHash(question);
    if (digest) materials.set(text(question.id), digest);
    if (cached) return cached;
    const presentation = { ...withoutMaterialHash(question), ...(digest ? { paperMaterialHash: digest } : {}) };
    snapshotCache?.set(question, presentation);
    return presentation;
  });
  return { ...raw, questionSnapshots, ...(Array.isArray(raw.learningSnapshot) ? {
    learningSnapshot: raw.learningSnapshot.map(item => ({ ...withoutMaterialHash(item),
      ...(materials.has(text(item.id)) ? { paperMaterialHash: materials.get(text(item.id)) } : {}) })),
  } : {}) };
}

function buildCorrection(scope, docId, before, after, previous = {}) {
  if (!before || !after || !after.unitId || !after.category || idOf(before, docId) !== idOf(after, docId)
    || before.unitId !== after.unitId || before.category !== after.category || text(before.examRound) !== text(after.examRound)
    || fingerprint(before) !== fingerprint(after)) return null;
  const materialHash = fingerprint(after);
  const sourceRevisions = [...new Set([
    ...(previous.materialHash === materialHash ? previous.sourceRevisions || [] : []), version(before), version(after),
  ])].slice(-200);
  const metadata = { id: idOf(after, docId), sourceRevision: version(after), ...normalizeAchievementMetadata(after) };
  return { semesterId: scope, definitionId: definitionIdOf(scope, after), docId, id: idOf(after, docId),
    sourceRevision: version(after), sourceRevisions, materialHash, type: after.type, answer: text(after.answer),
    answerChanged: text(before.answer) !== text(after.answer) || (previous.materialHash === materialHash && previous.answerChanged === true),
    points: Number.isFinite(after.points) ? after.points : 1, metadata,
    changedBy: text(after.updatedBy), reason: text(after.updateReason) };
}

function applicableCorrection(result, correction) {
  if (!correction || result.assessmentKind !== "QUIZ" || result.semesterId !== correction.semesterId
    || result.definitionId !== correction.definitionId || !hasAnswers(result.answers) || !Array.isArray(result.answerChecks)
    || !result.answerChecks.some(item => String(item.id) === correction.id)) return false;
  const snapshot = (result.questionSnapshots || []).find(item => String(item.id) === correction.id);
  if (snapshot) return fingerprint(snapshot) === correction.materialHash;
  // Omitted historical images are never replaced with today's question. Only a
  // known, continuously compatible source revision permits grading that record.
  const metadata = (result.learningSnapshot || []).find(item => String(item.id) === correction.id);
  return Boolean(metadata?.sourceRevision && correction.sourceRevisions.includes(String(metadata.sourceRevision)));
}

function effectiveQuizResult(raw) {
  if (raw?.assessmentKind !== "QUIZ") return raw;
  if (!raw.gradingCorrections || !hasAnswers(raw.answers) || !Array.isArray(raw.answerChecks)) {
    if (!raw.gradingCorrectionSummary) return raw;
    // Compact previous-round score queries intentionally omit answers and paper
    // bodies. Project only correction metadata already validated at write time.
    const metadata = new Map((raw.learningSnapshot || []).map(item => [String(item.id), item]));
    const accepted = new Map();
    for (const correction of Object.values(raw.gradingCorrections || {})) {
      const original = metadata.get(correction.id);
      const snapshot = (raw.questionSnapshots || []).find(item => String(item.id) === correction.id);
      if (correction.semesterId === raw.semesterId && correction.definitionId === raw.definitionId
        && (snapshot ? fingerprint(snapshot) === correction.materialHash
          : original && correction.sourceRevisions?.includes(String(original.sourceRevision)))) {
        accepted.set(correction.id, correction);
        metadata.set(correction.id, { ...original, ...correction.metadata });
      }
    }
    return { ...raw, ...raw.gradingCorrectionSummary,
      ...(raw.learningSnapshot ? { learningSnapshot: [...metadata.values()] } : {}),
      ...(raw.questionSnapshots ? { questionSnapshots: raw.questionSnapshots.map(item =>
        Object.hasOwn(accepted.get(String(item.id)) || {}, "answer")
          ? { ...item, answer: accepted.get(String(item.id)).answer } : item) } : {}) };
  }
  const corrections = new Map(Object.values(raw.gradingCorrections).filter(item => applicableCorrection(raw, item))
    .map(item => [item.id, item]));
  if (!corrections.size) return raw;
  let earnedDelta = 0;
  const answerChecks = raw.answerChecks.map(check => {
    const correction = corrections.get(String(check.id));
    if (!correction) return check;
    const correct = Object.hasOwn(correction, "answer")
      ? isQuizAnswerCorrect(correction.type, raw.answers[check.id] || "", correction.answer) : check.correct;
    earnedDelta += (Number(correct) - Number(check.correct === true)) * correction.points;
    return { ...check, correct };
  });
  const score = answerChecks.filter(item => item.correct === true).length;
  const weighted = Number.isFinite(raw.earnedPoints) && Number.isFinite(raw.maxPoints);
  const earnedPoints = weighted ? Math.round((raw.earnedPoints + earnedDelta) * 10000) / 10000 : undefined;
  const percent = weighted ? raw.maxPoints > 0 ? Math.round(earnedPoints / raw.maxPoints * 10000) / 100 : 0
    : answerChecks.length ? Math.round(score / answerChecks.length * 100) : 0;
  const metadata = new Map((raw.learningSnapshot || []).map(item => [String(item.id), item]));
  for (const [id, correction] of corrections) metadata.set(id, { ...metadata.get(id), ...correction.metadata });
  return { ...raw, score, percent, answerChecks, learningSnapshot: [...metadata.values()],
    ...(weighted ? { earnedPoints } : {}),
    questionSnapshots: (raw.questionSnapshots || []).map(item => Object.hasOwn(corrections.get(String(item.id)) || {}, "answer")
      ? { ...item, answer: corrections.get(String(item.id)).answer } : item) };
}

function createQuizQuestionCorrectionService({ db }) {
  const applyToResult = async (resultRef, correctionRefs) => db.runTransaction(async transaction => {
    const [resultSnap, ...correctionSnaps] = await transaction.getAll(resultRef, ...correctionRefs);
    if (!resultSnap.exists) return false;
    let result = resultSnap.data();
    if (!hasAnswers(result.answers)) {
      // Older canonical results keep answers only in their immutable submission.
      // Read that exact bound document once, and never copy its answers into storage.
      const attemptId = text(result.attemptId);
      if (result.assessmentKind !== "QUIZ" || !attemptId || attemptId !== resultRef.id
        || result.submissionRef !== `semester_assessment_submissions/${attemptId}`) return false;
      const [submissionSnap] = await transaction.getAll(db.doc(result.submissionRef));
      const submission = submissionSnap.data();
      if (!submission || !result.studentUid || submission.studentUid !== result.studentUid
        || submission.semesterId !== result.semesterId || submission.attemptId !== attemptId
        || submission.definitionId !== result.definitionId
        || (submission.submissionId && submission.submissionId !== attemptId)
        || (submission.sourceHash && result.sourceHash && submission.sourceHash !== result.sourceHash)
        || !hasAnswers(submission.answers)) return false;
      result = { ...result, answers: submission.answers };
    }
    const next = { ...(result.gradingCorrections || {}) };
    let changed = false;
    for (const snapshot of correctionSnaps) {
      const correction = snapshot.exists ? snapshot.data() : null;
      if (!applicableCorrection(result, correction)) continue;
      const key = hash(correction.id);
      const originalRevision = (result.learningSnapshot || []).find(item => String(item.id) === correction.id)?.sourceRevision;
      const stored = { semesterId: correction.semesterId, definitionId: correction.definitionId,
        id: correction.id, sourceRevision: correction.sourceRevision,
        sourceRevisions: [...new Set([text(originalRevision), correction.sourceRevision].filter(Boolean))],
        materialHash: correction.materialHash, type: correction.type, points: correction.points, metadata: correction.metadata,
        ...(correction.answerChanged ? { answer: correction.answer } : {}) };
      if (canonical(next[key]) === canonical(stored)) continue;
      // A retry or a delayed question event must not roll a projection back.
      if (Number(next[key]?.sourceRevision) > Number(correction.sourceRevision)) continue;
      next[key] = stored;
      changed = true;
    }
    if (!changed) return false;
    const correctionVersion = hash(canonical(next));
    const effective = effectiveQuizResult({ ...result, gradingCorrections: next });
    const gradingCorrectionSummary = { score: effective.score, percent: effective.percent, answerChecks: effective.answerChecks,
      ...(Number.isFinite(effective.earnedPoints) ? { earnedPoints: effective.earnedPoints } : {}) };
    transaction.set(resultRef, { gradingCorrections: next, gradingCorrectionSummary,
      gradingCorrectionVersion: correctionVersion }, { merge: true });
    transaction.set(db.doc(`quiz_result_correction_signals/${resultRef.id}`), {
      semesterId: result.semesterId, studentUid: result.studentUid, assessmentKind: "QUIZ",
      version: correctionVersion, updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  const onQuestion = async event => {
    if (!event.data?.before?.exists || !event.data?.after?.exists) return;
    const { year, semester, questionId } = event.params;
    const scope = `${year}-${semester}`;
    if (!/^\d{4}-[12]$/.test(scope)) return;
    const ref = db.doc(`quiz_question_corrections/${correctionKey(scope, questionId)}`);
    const correction = await db.runTransaction(async transaction => {
      const [current, prior] = await transaction.getAll(event.data.after.ref, ref);
      if (!current.exists) return null;
      // Always project the latest committed teacher edit, even when events arrive out of order.
      const next = buildCorrection(scope, questionId, event.data.before.data(), current.data(), prior.data());
      if (!next) return null;
      if (canonical(prior.data()) !== canonical(next)) transaction.set(ref, next);
      transaction.set(db.doc(`quiz_question_correction_indexes/${indexKey(next.definitionId)}`), {
        semesterId: scope, definitionId: next.definitionId,
        questions: { [hash(next.id)]: { id: next.id, correctionId: ref.id } },
      }, { merge: true });
      return next;
    });
    if (!correction) return;
    let cursor, count = 0;
    do {
      let query = db.collection("semester_assessment_results").where("definitionId", "==", correction.definitionId)
        .select("assessmentKind", "semesterId", "answerChecks", "gradingCorrections")
        .orderBy(FieldPath.documentId()).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if ((count += page.size) > 10000) throw new Error("Quiz correction result limit exceeded");
      for (let offset = 0; offset < page.docs.length; offset += 8) await Promise.all(page.docs.slice(offset, offset + 8).map(document => {
        const value = document.data();
        if (value.assessmentKind !== "QUIZ" || value.semesterId !== scope
          || !(value.answerChecks || []).some(item => String(item.id) === correction.id)
          || value.gradingCorrections?.[hash(correction.id)]?.sourceRevision === correction.sourceRevision) return;
        return applyToResult(document.ref, [ref]);
      }));
      cursor = page.size === 100 ? page.docs.at(-1) : null;
    } while (cursor);
  };

  const onCreatedResult = async event => {
    const result = event.data?.data();
    if (result?.assessmentKind !== "QUIZ" || !result.definitionId) return;
    // One small index read for new submissions; no question-bank scan. This also
    // catches an in-flight attempt whose frozen key predates a teacher correction.
    const index = (await db.doc(`quiz_question_correction_indexes/${indexKey(result.definitionId)}`).get()).data();
    if (index?.semesterId !== result.semesterId || index?.definitionId !== result.definitionId) return;
    const ids = new Set((result.answerChecks || []).map(item => String(item.id)));
    const refs = Object.values(index.questions || {}).filter(item => ids.has(item.id))
      .map(item => db.doc(`quiz_question_corrections/${item.correctionId}`));
    if (refs.length) await applyToResult(event.data.ref, refs);
  };
  const onResult = async event => {
    if (!event.data?.after?.exists) {
      if (event.data?.before?.exists && event.data.before.data()?.assessmentKind === "QUIZ")
        await db.doc(`quiz_result_correction_signals/${event.params.resultId}`).delete();
      return;
    }
    if (!event.data.before?.exists) await onCreatedResult({ data: event.data.after });
  };
  return { onQuestion, onCreatedResult, onResult, applyToResult };
}

function createQuizQuestionCorrectionTriggers({ db }) {
  const service = createQuizQuestionCorrectionService({ db });
  const options = { region: "asia-northeast3", retry: true, memory: "512MiB", maxInstances: 5, timeoutSeconds: 540 };
  return {
    reconcileQuizQuestionCorrection: onDocumentWritten({ ...options, document: "years/{year}/semesters/{semester}/quiz_questions/{questionId}" }, service.onQuestion),
    reconcileQuizResultCorrection: onDocumentWritten({ ...options, document: "semester_assessment_results/{resultId}" }, service.onResult),
  };
}
module.exports = { fingerprint, paperMaterialHash, withQuizPaperMaterialHashes, buildCorrection, applicableCorrection, effectiveQuizResult,
  createQuizQuestionCorrectionService, createQuizQuestionCorrectionTriggers, correctionKey, indexKey };
