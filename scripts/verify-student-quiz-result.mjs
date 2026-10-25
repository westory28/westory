import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(
      new URL(
        "../src/pages/student/quiz/QuizLearningResult.tsx",
        import.meta.url,
      ),
    ),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["react", "react/jsx-runtime", "react-dom"],
});
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
});
const Result = module.exports.default;
const props = {
  assessmentTitle: "조선의 중앙 정치 제도 진단평가",
  unitTitle: "조선의 성립과 발전",
  score: 75,
  correctCount: 15,
  totalCount: 20,
  onReview() {},
  onRetry() {},
};
const render = (extra = {}) =>
  renderToStaticMarkup(React.createElement(Result, { ...props, ...extra }));
const rendered = render();
assert.match(rendered, /조선의 중앙 정치 제도 진단평가/);
assert.match(rendered, /조선의 성립과 발전/);
assert.match(rendered, /aria-label="점수 75점, 100점 만점"/);
assert.match(rendered, /stroke-dasharray="75 100"/);
assert.match(rendered, /정답 <strong>15문제<\/strong> \/ 총 20문제/);
assert.equal((rendered.match(/<button\b/g) || []).length, 2);
assert.match(rendered, /답안 및 해설 보기<\/button>/);
assert.match(rendered, /다시 풀기<\/button>/);
assert.doesNotMatch(
  rendered,
  /관찰|관측|풀이 시간|재방문|답 변경|위스|추천|평가 목록|<details|InfoHelp/,
);
assert.doesNotMatch(rendered, /student-quiz-result-comparison/);
const up = render({
  comparison: { previousScore: 60, delta: 15, direction: "up" },
});
assert.match(up, /이전 60점/);
assert.match(up, /15점 상승/);
const down = render({
  comparison: { previousScore: 90, delta: -15, direction: "down" },
});
assert.match(down, /이전 90점/);
assert.match(down, /15점 하락/);
const same = render({
  comparison: { previousScore: 75, delta: 0, direction: "same" },
});
assert.match(same, /이전과 같은 점수/);
const previousZero = render({
  comparison: { previousScore: 0, delta: 75, direction: "up" },
});
assert.match(previousZero, /이전 0점/);
const zero = render({ score: 0, correctCount: 0 });
assert.match(zero, /aria-label="점수 0점, 100점 만점"/);
assert.match(zero, /정답 <strong>0문제<\/strong> \/ 총 20문제/);
assert.equal(
  (zero.match(/<circle\b/g) || []).length,
  1,
  "Zero has no false colored arc",
);
const full = render({ score: 100, correctCount: 20 });
assert.match(full, /stroke-dasharray="100 100"/);
assert.match(full, /정답 <strong>20문제<\/strong> \/ 총 20문제/);
const review = render({
  reviewItems: [
    {
      id: "1",
      type: "ox",
      question: "복습 문항",
      answer: "O",
      submittedAnswer: "X",
      concepts: [],
    },
  ],
});
assert.match(review, /오답 1문제 복습하기/);
assert.match(review, /전체 답안 및 해설 보기/);
assert.match(review, /원문이 보관된 오답 1문제만/);
assert.doesNotMatch(
  review,
  /복습 문항/,
  "Practice is opened explicitly, not rendered upfront",
);
const runner = await readFile(
  new URL("../src/pages/student/quiz/QuizRunner.tsx", import.meta.url),
  "utf8",
);
assert.match(runner, /total: submitted\.answerChecks\.length/);
assert.match(
  runner,
  /submitted\.answerChecks\.filter\([\s\S]*?check\.correct === true/,
);
assert.match(runner, /assessmentState\.definition\.title/);
assert.match(runner, /analytics: pendingSubmitAnalyticsRef\.current/);
assert.match(runner, /notifyPointsUpdated\(\)/);
assert.match(runner, /assessmentState\.definition\.cooldownMinutes \* 60000/);
assert.doesNotMatch(runner, /setPointNotice|buildAssessmentLearningSummary/);
assert.match(runner, /void loadQuizScoreComparison/);
assert.match(runner, /if \(active\) setScoreComparison/);
assert.match(runner, /active = false/);
assert.match(runner, /collector\.markHintViewed/);
assert.match(runner, /aria-expanded=\{openHintQuestionId === question.id\}/);
console.log("Student quiz result: 33 regression assertions passed.");
