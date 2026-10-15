import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL(
        "../src/pages/student/mypage/assessmentRecords.ts",
        import.meta.url,
      ),
    ),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  normalizeMyAssessmentRecords: normalize,
  savedReviewQuestion: saved,
  buildAssessmentScoreDistribution: distribution,
  formatRecordedScore,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const scope = { uid: "student-a", semesterId: "2026-2" };
const row = (id, extra = {}) => ({
  id,
  uid: scope.uid,
  score: 40,
  timestamp: { seconds: 10 },
  ...extra,
});

assert.deepEqual(
  normalize(
    [
      row("a"),
      row("other", { uid: "student-b" }),
      row("past", { semesterId: "2026-1" }),
      row("foreign", { year: "2025", semester: "2" }),
      row("pending", { status: "IN_PROGRESS" }),
      row("conflict", { studentUid: "student-a", uid: "student-b" }),
    ],
    scope,
  ).map((r) => r.id),
  ["a"],
);
assert.equal(normalize([row("a")], { ...scope, uid: "" }).length, 0);
assert.equal(
  normalize([row("a"), row("b")], scope).length,
  2,
  "Equal scores/dates are two genuine attempts",
);
const duplicates = normalize(
  [
    row("legacy", { attemptId: "canonical", score: 0 }),
    row("canonical", {
      studentUid: scope.uid,
      attemptId: "canonical",
      semesterId: scope.semesterId,
      score: 80,
    }),
  ],
  scope,
);
assert.equal(duplicates.length, 1);
assert.equal(
  duplicates[0].score,
  80,
  "Canonical result wins over explicit legacy mirror",
);
assert.equal(
  normalize(
    [
      row("a"),
      row("b"),
      row("bridge", { attemptId: "a", legacyResultId: "b" }),
    ],
    scope,
  ).length,
  1,
  "Transitive explicit references are one attempt",
);
const scores = normalize(
  [
    row("zero", { score: 0 }),
    row("missing", { score: undefined }),
    row("null", { score: null }),
    row("string", { score: "90" }),
    row("invalid", { score: Infinity }),
  ],
  scope,
).map((r) => r.score);
assert.deepEqual(scores, [0, null, null, null, null]);
assert.equal(formatRecordedScore(0), "0점");
assert.equal(formatRecordedScore(null), "점수 없음");
assert.deepEqual(
  distribution([0, 19, 20, 40, 60, 80, 100, null]).map((band) => band.count),
  [2, 1, 1, 1, 2],
);
assert.deepEqual(
  normalize(
    [
      row("earlier", { timestamp: { seconds: 1 } }),
      row("latest", { timestamp: { seconds: 20 } }),
      row("unknown", { timestamp: null }),
    ],
    scope,
  ).map((r) => r.id),
  ["latest", "earlier", "unknown"],
);
const absent = saved({ id: "q", correct: false });
assert.equal(absent.questionAvailable, false);
assert.equal(absent.answerAvailable, false);
assert.equal(absent.userAnswerAvailable, false);
assert.equal(absent.correctKnown, true);
assert.equal(
  saved({ id: "q", u: "" }).userAnswerAvailable,
  true,
  "An empty recorded answer is a real nonresponse",
);
const snapshot = saved({
  id: "q",
  correct: true,
  u: "정답",
  questionSnapshot: {
    question: "당시 원문",
    options: ["정답", "다른 답"],
    answer: "정답",
    explanation: "당시 해설",
  },
});
assert.equal(snapshot.question, "당시 원문");
assert.deepEqual(snapshot.options, ["정답", "다른 답"]);
assert.equal(snapshot.answer, "정답");
assert.equal(saved({ q: "과거 지문", a: 0, exp: "과거 해설" }).answer, 0);
assert.equal(saved({ id: "q" }).correctKnown, false);
const page = await readFile(
  new URL("../src/pages/student/MyPage.tsx", import.meta.url),
  "utf8",
);
assert.ok(
  !page.includes('"quiz_questions"'),
  "Past reviews must not reconstruct from the mutable question bank",
);
assert.ok(
  page.includes('nextParams.set("attemptId", attempt.key)'),
  "A score entry opens its actual attempt",
);
assert.ok(
  !page.includes("꾸준히 노력하고 있어요") &&
    !page.includes("점수가 빨리 올라요"),
);
assert.ok(
  !page.includes("풀이 관측 기록") && !page.includes("readRecordedObservation"),
);
console.log("MyPage assessment records: 25 regression assertions passed.");
