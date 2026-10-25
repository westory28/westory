// Generated from src/lib/quizAnalysis.ts. Do not edit.
// source-sha256: 723d158326364463fff652d8b7b76adc867c78ec78337480c88b4f59acf6dc9c
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildQuizItemStatistics = exports.buildQuizAnalysis = exports.deduplicateQuizAnalysisRecords = void 0;
const text = (value) => typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const uniqueText = (values) => [
    ...new Set((values || []).map(text).filter(Boolean)),
];
const revision = (value) => {
    const result = text(value);
    return result && result !== "legacy" ? result : "";
};
const score = (value) => typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
const timestamp = (value) => {
    if (value instanceof Date)
        return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === "object") {
        const row = value;
        if (typeof row.toMillis === "function") {
            try {
                return timestamp(row.toMillis());
            }
            catch {
                return null;
            }
        }
        if (typeof row.seconds === "number" && Number.isFinite(row.seconds)) {
            const nanos = typeof row.nanoseconds === "number" && Number.isFinite(row.nanoseconds)
                ? row.nanoseconds
                : 0;
            return row.seconds * 1000 + nanos / 1e6;
        }
    }
    return null;
};
const recordRefs = (row) => {
    const refs = [
        `${row.source === "canonical" ? "result" : "legacy"}:${text(row.id)}`,
    ];
    for (const value of [row.attemptId, row.canonicalAttemptId])
        if (text(value))
            refs.push(`attempt:${text(value)}`);
    if (text(row.resultId))
        refs.push(`${row.source === "canonical" ? "result" : "legacy"}:${text(row.resultId)}`);
    if (text(row.legacyResultId))
        refs.push(`legacy:${text(row.legacyResultId)}`);
    for (const value of [row.resultRef, row.submissionRef]) {
        const path = text(value);
        const match = path.match(/(?:^|\/)(semester_assessment_results|semester_assessment_submissions|quiz_results)\/([^/]+)$/);
        if (match)
            refs.push(`${match[1] === "semester_assessment_results" ? "result" : match[1] === "semester_assessment_submissions" ? "submission" : "legacy"}:${match[2]}`);
    }
    return refs;
};
/** Explicit references only. Equal timestamps, scores, names, or answers are not identity. */
const deduplicateQuizAnalysisRecords = (records) => {
    const ordered = [...records].sort((a, b) => Number(b.source === "canonical") - Number(a.source === "canonical") ||
        text(a.id).localeCompare(text(b.id)));
    const parents = ordered.map((_, index) => index);
    const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
    const owners = new Map();
    ordered.forEach((row, index) => {
        for (const ref of recordRefs(row)) {
            const key = JSON.stringify([
                text(row.studentUid),
                text(row.semesterId),
                ref,
            ]);
            const owner = owners.get(key);
            if (owner === undefined)
                owners.set(key, index);
            else {
                const left = find(owner), right = find(index);
                parents[Math.max(left, right)] = Math.min(left, right);
            }
        }
    });
    return ordered.filter((_, index) => find(index) === index);
};
exports.deduplicateQuizAnalysisRecords = deduplicateQuizAnalysisRecords;
const questionInScope = (question, scope) => {
    const units = [
        question.unitId,
        question.subUnitId,
        question.refBig,
        question.refMid,
        question.refSmall,
    ].map(text);
    return ((!scope.questionIds || scope.questionIds.includes(text(question.id))) &&
        (!scope.unitIds || scope.unitIds.some((id) => units.includes(text(id)))) &&
        (!scope.category || text(question.category) === scope.category) &&
        (!scope.examRound ||
            !text(question.examRound) ||
            text(question.examRound) === scope.examRound));
};
const latest = (rows) => {
    if (!rows.length)
        return { value: null, chronologyUnknown: false };
    if (rows.length === 1)
        return { value: rows[0], chronologyUnknown: false };
    const times = rows.map((row) => timestamp(row.submittedAt));
    if (times.includes(null))
        return { value: null, chronologyUnknown: true };
    const maximum = Math.max(...times);
    const winners = rows.filter((_, index) => times[index] === maximum);
    return {
        value: winners.length === 1 ? winners[0] : null,
        chronologyUnknown: winners.length !== 1,
    };
};
const buildStudentQuestions = (records, questions) => questions.map((question) => {
    const id = text(question.id);
    const rows = records.flatMap((record) => {
        // Duplicate items within one result must not add independent observations.
        const matches = record.items.filter((item) => text(item.questionId) === id);
        if (!matches.length)
            return [];
        // A malformed duplicate outcome is unavailable, rather than arbitrarily true/false.
        const item = matches.length === 1
            ? matches[0]
            : {
                questionId: id,
                correct: null,
                sourceRevision: matches.every((entry) => revision(entry.sourceRevision) ===
                    revision(matches[0].sourceRevision))
                    ? matches[0].sourceRevision
                    : undefined,
            };
        return [{ item, record, submittedAt: record.submittedAt }];
    });
    const currentRevision = revision(question.sourceRevision) || revision(question.contentRevision);
    const currentRows = rows.filter((row) => !!currentRevision &&
        revision(row.item.sourceRevision) === currentRevision);
    const selected = latest(currentRows);
    return {
        question,
        rows,
        currentRows,
        latest: selected.value,
        chronologyUnknown: selected.chronologyUnknown,
        revisionExcluded: rows.some((row) => !!currentRevision &&
            !!revision(row.item.sourceRevision) &&
            revision(row.item.sourceRevision) !== currentRevision),
        revisionUnknown: rows.some((row) => !currentRevision || !revision(row.item.sourceRevision)),
    };
});
const changesFor = (rows) => {
    const changes = {
        comparedQuestionCount: 0,
        wrongToCorrectCount: 0,
        correctToWrongCount: 0,
        unchangedCorrectCount: 0,
        unchangedWrongCount: 0,
        chronologyUnknownQuestionCount: 0,
        basis: "same_question_same_revision",
    };
    for (const row of rows) {
        if (row.currentRows.length < 2)
            continue;
        const times = row.currentRows.map((entry) => timestamp(entry.submittedAt));
        if (times.includes(null) || new Set(times).size !== times.length) {
            changes.chronologyUnknownQuestionCount += 1;
            continue;
        }
        const sorted = [...row.currentRows].sort((a, b) => timestamp(a.submittedAt) - timestamp(b.submittedAt));
        const first = sorted[0].item.correct, last = sorted[sorted.length - 1].item.correct;
        if (typeof first !== "boolean" || typeof last !== "boolean")
            continue;
        changes.comparedQuestionCount += 1;
        if (!first && last)
            changes.wrongToCorrectCount += 1;
        else if (first && !last)
            changes.correctToWrongCount += 1;
        else if (last)
            changes.unchangedCorrectCount += 1;
        else
            changes.unchangedWrongCount += 1;
    }
    return changes;
};
const conceptsFor = (rows) => {
    const concepts = new Map();
    for (const row of rows) {
        const item = row.latest?.item;
        if (!item || typeof item.correct !== "boolean")
            continue;
        for (const concept of uniqueText(item.concepts)) {
            const group = concepts.get(concept) || {
                concept,
                correctQuestionIds: [],
                wrongQuestionIds: [],
                reviewLessonIds: [],
            };
            (item.correct ? group.correctQuestionIds : group.wrongQuestionIds).push(text(row.question.id));
            if (text(item.reviewLessonId))
                group.reviewLessonIds = uniqueText([
                    ...group.reviewLessonIds,
                    item.reviewLessonId,
                ]);
            concepts.set(concept, group);
        }
    }
    return [...concepts.values()]
        .filter((row) => row.wrongQuestionIds.length > 0)
        .sort((a, b) => b.wrongQuestionIds.length - a.wrongQuestionIds.length ||
        a.concept.localeCompare(b.concept));
};
/**
 * Callers must load authorized current-semester records and the current roster.
 * The model rechecks both boundaries; it performs no fetching or writes.
 * Unit-partial records may inform item analysis, but never masquerade as a
 * recorded score for a smaller assessment. Results describe the loaded sample.
 */
const buildQuizAnalysis = (input) => {
    const scope = input.scope || {};
    const semesterId = text(input.semesterId);
    const rosterAvailable = input.rosterAvailable !== false;
    const visibleRoster = rosterAvailable ? input.students : [];
    const visibleStudentIds = new Set(visibleRoster.map((student) => text(student.uid)));
    const roster = scope.classId
        ? visibleRoster
        : [
            ...input.records
                .filter((record) => text(record.semesterId) === semesterId)
                .map((record) => ({ uid: text(record.studentUid) })),
            ...visibleRoster,
        ];
    const students = [
        ...new Map(roster
            .filter((student) => text(student.uid) &&
            (!scope.classId ||
                text(student.classId) === scope.classId))
            .map((student) => [text(student.uid), student])).values(),
    ];
    const studentIds = new Set(students.map((student) => text(student.uid)));
    const questions = [
        ...new Map(input.questions
            .filter((question) => text(question.id) && questionInScope(question, scope))
            .map((question) => [text(question.id), question])).values(),
    ];
    const questionIds = new Set(questions.map((question) => text(question.id)));
    const candidates = input.records.filter((record) => semesterId &&
        text(record.id) &&
        text(record.semesterId) === semesterId &&
        studentIds.has(text(record.studentUid)) &&
        (record.source === "canonical" || record.source === "legacy") &&
        Array.isArray(record.items));
    // Deduplicate before filtering by assessment metadata so a stale mirror cannot
    // make a canonical record appear in a scope it does not belong to.
    const unique = (0, exports.deduplicateQuizAnalysisRecords)(candidates);
    const records = unique.filter((record) => (!scope.questionIds ||
        record.items.some((item) => questionIds.has(text(item.questionId)))) &&
        (!scope.category || text(record.category) === scope.category) &&
        (!scope.examRound || text(record.examRound) === scope.examRound) &&
        (!scope.unitIds ||
            scope.unitIds.includes(text(record.unitId)) ||
            record.items.some((item) => questionIds.has(text(item.questionId)))));
    const byStudent = new Map();
    const studentRows = students.map((student) => {
        const studentRecords = records.filter((record) => text(record.studentUid) === text(student.uid));
        const rows = buildStudentQuestions(studentRecords, questions);
        byStudent.set(text(student.uid), rows);
        const selected = latest(studentRecords);
        const entireScope = !scope.unitIds ||
            (!!selected.value && scope.unitIds.includes(text(selected.value.unitId)));
        const items = rows.flatMap((row) => (row.latest ? [row.latest.item] : []));
        const correctCount = items.filter((item) => item.correct === true).length;
        const wrongCount = items.filter((item) => item.correct === false).length;
        const itemScore = scope.scoreBasis === "latest_current_revision_items";
        const latestScore = itemScore
            ? correctCount + wrongCount > 0
                ? (100 * correctCount) / (correctCount + wrongCount)
                : null
            : entireScope
                ? score(selected.value?.scorePercent)
                : null;
        return {
            ...student,
            uid: text(student.uid),
            attemptCount: studentRecords.length,
            latestRecord: selected.value,
            latestScore,
            scoreUnavailableReason: !studentRecords.length
                ? "no_attempt"
                : itemScore && latestScore !== null
                    ? null
                    : selected.chronologyUnknown
                        ? "chronology_unknown"
                        : !entireScope
                            ? "partial_scope"
                            : latestScore === null
                                ? "missing_score"
                                : null,
            correctCount,
            wrongCount,
            unknownCount: items.filter((item) => typeof item.correct !== "boolean").length +
                rows.filter((row) => row.chronologyUnknown).length,
            assessedQuestionCount: correctCount + wrongCount,
            currentQuestionCount: items.length,
            revisionExcludedCount: rows.filter((row) => row.revisionExcluded).length,
            revisionUnknownCount: rows.filter((row) => row.revisionUnknown).length,
            missingConceptQuestionCount: items.filter((item) => typeof item.correct === "boolean" &&
                !uniqueText(item.concepts).length).length,
            assessedConcepts: uniqueText(items
                .filter((item) => typeof item.correct === "boolean")
                .flatMap((item) => item.concepts || [])),
            wrongConcepts: conceptsFor(rows),
            changes: changesFor(rows),
        };
    });
    const questionRows = questions.map((question, index) => {
        const rows = [...byStudent.values()].map((entries) => entries[index]);
        const items = rows.flatMap((row) => row.latest ? [row.latest.item] : []);
        const correctCount = items.filter((item) => item.correct === true).length;
        const wrongCount = items.filter((item) => item.correct === false).length;
        const answers = items.filter((item) => typeof item.answer === "string" && item.answer.trim() !== "");
        const counts = new Map([
            ...new Set((question.options || []).filter((answer) => typeof answer === "string" && answer.trim())),
        ].map((answer) => [answer, 0]));
        for (const item of answers)
            counts.set(item.answer, (counts.get(item.answer) || 0) + 1);
        return {
            id: text(question.id),
            attemptedStudentCount: rows.filter((row) => row.rows.length > 0).length,
            distinctStudents: items.length,
            assessedStudentCount: correctCount + wrongCount,
            correctCount,
            wrongCount,
            unknownCorrectnessCount: items.filter((item) => typeof item.correct !== "boolean").length,
            correctRate: correctCount + wrongCount
                ? (100 * correctCount) / (correctCount + wrongCount)
                : null,
            knownAnswerStudentCount: answers.length,
            unansweredCount: items.filter((item) => typeof item.answer === "string" && item.answer.trim() === "").length,
            missingAnswerCount: items.filter((item) => !has(item, "answer") || typeof item.answer !== "string").length,
            optionDistribution: [...counts].map(([answer, count]) => ({
                answer,
                count,
                percent: answers.length ? (100 * count) / answers.length : 0,
                listedOption: (question.options || []).includes(answer),
            })),
            revisionExcludedCount: rows.filter((row) => row.revisionExcluded)
                .length,
            revisionUnknownCount: rows.filter((row) => row.revisionUnknown).length,
            chronologyUnknownCount: rows.filter((row) => row.chronologyUnknown)
                .length,
        };
    });
    const scores = studentRows
        .map((student) => student.latestScore)
        .filter((value) => value !== null);
    const scoreHistogram = [
        { label: "0–20점 미만", lower: 0, upper: 20, count: 0 },
        { label: "20–40점 미만", lower: 20, upper: 40, count: 0 },
        { label: "40–60점 미만", lower: 40, upper: 60, count: 0 },
        { label: "60–80점 미만", lower: 60, upper: 80, count: 0 },
        { label: "80–100점", lower: 80, upper: 101, count: 0 },
    ];
    for (const value of scores)
        scoreHistogram.find((band) => value >= band.lower && value < band.upper).count += 1;
    return {
        students: studentRows.filter((student) => visibleStudentIds.has(student.uid)),
        questions: questionRows,
        scoreHistogram,
        averageScore: scores.length
            ? scores.reduce((sum, value) => sum + value, 0) / scores.length
            : null,
        scoredStudentCount: scores.length,
        missingScoreStudentCount: studentRows.filter((student) => student.attemptCount > 0 && student.latestScore === null).length,
        participantCount: studentRows.filter((student) => student.attemptCount > 0)
            .length,
        unlistedParticipantCount: studentRows.filter((student) => student.attemptCount > 0 && !visibleStudentIds.has(student.uid)).length,
        recordCount: records.length,
        duplicateRecordCount: candidates.length - unique.length,
        excludedRecordCount: input.records.length - candidates.length + unique.length - records.length,
        scoreBasis: scope.scoreBasis || "latest_recorded_attempt",
        rosterAvailable,
    };
};
exports.buildQuizAnalysis = buildQuizAnalysis;
/**
 * Equal-weight dichotomous item analysis of the loaded, authorized sample.
 * A student's first recorded submission is chosen BEFORE validating its items;
 * a later successful/revised submission must never replace an excluded first.
 * Call with the whole assessment bank; a display-only subunit filter must not
 * alter the rest score or split a test form. Different forms are never pooled.
 */
const buildQuizItemStatistics = (input) => {
    const scope = input.scope || {};
    const questionMap = new Map(input.questions
        .filter((question) => text(question.id) && questionInScope(question, scope))
        .map((question) => [text(question.id), question]));
    const studentIds = new Set((input.rosterAvailable === false ? [] : input.students)
        .filter((student) => !scope.classId || text(student.classId) === scope.classId)
        .map((student) => text(student.uid)));
    const records = (0, exports.deduplicateQuizAnalysisRecords)(input.records.filter((record) => text(input.semesterId) &&
        text(record.id) &&
        text(record.studentUid) &&
        text(record.semesterId) === text(input.semesterId) &&
        (!scope.classId || studentIds.has(text(record.studentUid))) &&
        (record.source === "canonical" || record.source === "legacy") &&
        Array.isArray(record.items))).filter((record) => (!scope.category || text(record.category) === scope.category) &&
        (!scope.examRound || text(record.examRound) === scope.examRound) &&
        (!scope.unitIds || scope.unitIds.includes(text(record.unitId))));
    const assessmentKey = (record) => JSON.stringify([
        text(record.unitId),
        text(record.category),
        text(record.examRound),
    ]);
    const byStudentAssessment = new Map();
    for (const record of records) {
        const key = JSON.stringify([
            text(record.studentUid),
            assessmentKey(record),
        ]);
        const entries = byStudentAssessment.get(key) || [];
        entries.push(record);
        byStudentAssessment.set(key, entries);
    }
    const summary = {
        basis: "first_recorded_submission_same_form",
        questions: [],
        firstSubmissionCount: byStudentAssessment.size,
        eligibleSubmissionCount: 0,
        excludedChronologyCount: 0,
        excludedIncompleteCount: 0,
        excludedRevisionCount: 0,
    };
    const forms = new Map();
    for (const entries of byStudentAssessment.values()) {
        const times = entries.map((record) => timestamp(record.submittedAt));
        const firstTime = Math.min(...times.filter((value) => value !== null));
        const firstRows = entries.filter((_, index) => times[index] === firstTime);
        if (times.includes(null) || firstRows.length !== 1) {
            summary.excludedChronologyCount += 1;
            continue;
        }
        const first = firstRows[0];
        const ids = first.items.map((item) => text(item.questionId));
        if (!Number.isSafeInteger(first.totalCount) ||
            first.totalCount !== first.items.length ||
            first.items.length === 0 ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => !id) ||
            first.items.some((item) => typeof item.correct !== "boolean")) {
            summary.excludedIncompleteCount += 1;
            continue;
        }
        if (first.items.some((item) => {
            const current = questionMap.get(text(item.questionId));
            const currentRevision = current &&
                (revision(current.sourceRevision) ||
                    revision(current.contentRevision));
            return (!currentRevision || revision(item.sourceRevision) !== currentRevision);
        })) {
            summary.excludedRevisionCount += 1;
            continue;
        }
        const signature = first.items
            .map((item) => [text(item.questionId), revision(item.sourceRevision)])
            .sort(([left], [right]) => left.localeCompare(right));
        const formKey = JSON.stringify([assessmentKey(first), signature]);
        const cohort = forms.get(formKey) || [];
        cohort.push(first);
        forms.set(formKey, cohort);
        summary.eligibleSubmissionCount += 1;
    }
    const squaredDeviation = (values) => {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    };
    const rows = new Map([...questionMap.keys()].map((id) => [
        id,
        { id, formCount: 0, cohorts: [] },
    ]));
    for (const [formKey, cohort] of [...forms].sort(([left], [right]) => left.localeCompare(right))) {
        const sampleSize = cohort.length;
        const itemCount = cohort[0].items.length;
        const maps = cohort.map((record) => new Map(record.items.map((item) => [text(item.questionId), item])));
        const totals = cohort.map((record) => record.items.filter((item) => item.correct).length);
        const totalDeviation = squaredDeviation(totals);
        const alphaUnavailableReason = sampleSize < 3
            ? "insufficient_students"
            : itemCount < 2
                ? "single_item"
                : totalDeviation === 0
                    ? "constant_total_score"
                    : null;
        // Same denominator for all variances cancels; this is Cronbach alpha/KR-20
        // for complete, equally weighted 0/1 items. Do not clamp negative reliability.
        const itemDeviationSum = cohort[0].items.reduce((sum, item) => sum +
            squaredDeviation(maps.map((map) => Number(map.get(text(item.questionId)).correct))), 0);
        const alphaReliability = alphaUnavailableReason
            ? null
            : (itemCount / (itemCount - 1)) * (1 - itemDeviationSum / totalDeviation);
        for (const sourceItem of cohort[0].items) {
            const id = text(sourceItem.questionId);
            const question = questionMap.get(id);
            const items = maps.map((map) => map.get(id));
            const values = items.map((item) => Number(item.correct));
            const rest = totals.map((total, index) => total - values[index]);
            const itemDeviation = squaredDeviation(values);
            const restDeviation = squaredDeviation(rest);
            const correlationUnavailableReason = sampleSize < 3
                ? "insufficient_students"
                : itemCount < 2
                    ? "single_item"
                    : itemDeviation === 0
                        ? "constant_item"
                        : restDeviation === 0
                            ? "constant_rest_score"
                            : null;
            const meanX = values.reduce((sum, value) => sum + value, 0) / sampleSize;
            const meanY = rest.reduce((sum, value) => sum + value, 0) / sampleSize;
            const covariance = values.reduce((sum, value, index) => sum + (value - meanX) * (rest[index] - meanY), 0);
            const correlation = correlationUnavailableReason
                ? null
                : Math.max(-1, Math.min(1, covariance / Math.sqrt(itemDeviation * restDeviation)));
            const answers = new Map([
                ...new Set((question.options || []).filter((answer) => typeof answer === "string" && answer.trim())),
            ].map((answer) => [answer, []]));
            let unansweredCount = 0;
            let missingAnswerCount = 0;
            items.forEach((item, index) => {
                if (typeof item.answer !== "string") {
                    missingAnswerCount += 1;
                }
                else if (!item.answer.trim()) {
                    unansweredCount += 1;
                }
                else {
                    const restScores = answers.get(item.answer) || [];
                    restScores.push(rest[index]);
                    answers.set(item.answer, restScores);
                }
            });
            const row = rows.get(id);
            row.cohorts.push({
                formKey,
                itemCount,
                sampleSize,
                smallSample: sampleSize < 20,
                correctCount: values.reduce((sum, value) => sum + value, 0),
                difficultyPercent: meanX * 100,
                correctedItemTotalCorrelation: correlation,
                correlationUnavailableReason,
                alphaReliability,
                alphaUnavailableReason,
                options: [...answers].map(([answer, restScores]) => ({
                    answer,
                    count: restScores.length,
                    percent: (100 * restScores.length) / sampleSize,
                    meanRestPercent: restScores.length && itemCount > 1
                        ? (100 * restScores.reduce((sum, value) => sum + value, 0)) /
                            (restScores.length * (itemCount - 1))
                        : null,
                    listedOption: (question.options || []).includes(answer),
                })),
                unansweredCount,
                missingAnswerCount,
            });
            row.formCount = row.cohorts.length;
        }
    }
    summary.questions = [...rows.values()];
    return summary;
};
exports.buildQuizItemStatistics = buildQuizItemStatistics;
