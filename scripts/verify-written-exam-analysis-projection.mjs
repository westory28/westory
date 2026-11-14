import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

async function source(file) {
  const bundled = await build({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    console,
  });
  return module.exports;
}
const { projectWrittenExamAnalysis: project } = await source(
  "src/lib/writtenExamAnalysisProjection.ts",
);
const {
  buildCumulativeAchievementScores: levels,
  adaptAchievementAttempts,
  buildAchievementAnalysis,
} = await source("src/lib/achievementAnalysis.ts");
const questions = [1, 2, 3, 4].map((number) => ({
  number,
  answer: String(number),
  points: 5,
  options: ["1", "2", "3", "4", "5"],
  achievementStandardCodes: ["9역10-02"],
  targetAchievementLevel: "C",
  intendedDifficulty: "medium",
  concepts: ["조선"],
}));
const student = {
  key: "3-1-1",
  grade: "3",
  class: "1",
  number: "1",
  name: "가상학생",
  totalScore: 15,
  responses: questions.map((q) => ({
    questionNumber: q.number,
    answer: q.number === 4 ? "1" : q.answer,
    correct: q.number !== 4,
    score: q.number === 4 ? 0 : 5,
  })),
};
const base = {
  id: "exam",
  title: "합성 시험",
  grade: "3",
  revision: "rev1",
  examDate: "2026-11-14",
  questions,
  students: [student],
  semesterId: "2026-2",
  mock: null,
};
const calc = (data) =>
  levels({
    students: data.students,
    semesterId: "2026-2",
    examRound: "round_4",
    scoreRows: data.mockExamScoreRows,
  });
const regular = project(base).data;
const alone = calc(regular)[0];
assert.equal(alone.rounds.length, 1);
assert.equal(alone.rounds[0].scorePercent, 75);
assert.equal(alone.level, "C");
assert.notEqual(alone.cutScores.A, 90);
assert.notEqual(alone.cutScores.C, 70);
const raw = {
  id: "mock1",
  source: "canonical",
  raw: {
    studentUid: "uid1",
    semesterId: "2026-2",
    category: "exam_prep",
    examRound: "round_1",
    submittedAtIso: "2026-11-10T03:00:00Z",
    percent: 100,
    total: 4,
    maxPoints: 20,
    cutScoreQuestions: questions.map((q) => ({ ...q, id: q.number })),
  },
};
const mock = {
  students: [{ uid: "uid1", name: "가상학생", classId: "3-1", number: "1" }],
  mockExamScoreRows: [raw],
};
const combined = project({ ...base, mock }).data;
const joined = calc(combined)[0];
assert.equal(combined.students[0].uid, "uid1");
assert.equal(joined.rounds.length, 2);
assert.equal(joined.scorePercent, 87.5);
assert.equal(joined.level, "B");
for (const badMock of [
  { ...mock, students: [{ ...mock.students[0], name: "다른학생" }] },
  {
    ...mock,
    students: [mock.students[0], { ...mock.students[0], uid: "duplicate" }],
  },
  {
    ...mock,
    mockExamScoreRows: [{ ...raw, raw: { ...raw.raw, semesterId: "2025-2" } }],
  },
  {
    ...mock,
    mockExamScoreRows: [
      { ...raw, raw: { ...raw.raw, submittedAtIso: "2026-11-15T03:00:00Z" } },
    ],
  },
  {
    ...mock,
    mockExamScoreRows: [{ ...raw, raw: { ...raw.raw, cutScoreQuestions: [] } }],
  },
]) {
  const result = calc(project({ ...base, mock: badMock }).data)[0];
  assert.equal(result.rounds.length, 1);
  assert.equal(result.level, alone.level);
}
assert.notEqual(
  project({ ...base, students: [{ ...student, uid: "wrong-uid" }], mock }).data
    .students[0].uid,
  "uid1",
);
const resolveCodes = (q) => ({
  codes: q.achievementStandardCodes || [],
  source: "manual",
});
const attempts = adaptAchievementAttempts({
  semesterId: base.semesterId,
  students: combined.students,
  questions: combined.questions,
  rawRows: combined.rawRows,
  resolveCodes,
});
const analysis = buildAchievementAnalysis({
  semesterId: base.semesterId,
  students: combined.students,
  questions: combined.questions,
  attempts,
  resolveCodes,
  examRound: "round_4",
  scoreRows: combined.mockExamScoreRows,
});
assert.equal(analysis.attempts.length, 1);
assert.equal(analysis.cumulativeScores[0].level, "B");
assert.equal(analysis.standards[0].actual.percent, 75);
assert.equal(JSON.stringify(student), JSON.stringify(base.students[0]));
console.log(
  "PASS regular-only estimated cuts, equal-assessment cumulative levels, real achievement adapter, UID/name/identity ambiguity, foreign semester, future results, missing frozen papers, and no source mutation.",
);
