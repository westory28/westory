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
  external: ["react", "react/jsx-runtime"],
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
const rendered = renderToStaticMarkup(React.createElement(Result, props));
assert.match(rendered, /조선의 중앙 정치 제도 진단평가/);
assert.match(rendered, /조선의 성립과 발전/);
assert.match(rendered, />75<span[^>]*>점<\/span>/);
assert.match(rendered, /정답 15문항, 전체 20문항/);
assert.match(rendered, />15\/20<\/p>/);
assert.equal((rendered.match(/<button\b/g) || []).length, 2);
assert.match(rendered, /답안 및 해설 보기<\/button>/);
assert.match(rendered, /다시 풀기<\/button>/);
assert.doesNotMatch(
  rendered,
  /관찰|관측|풀이 시간|재방문|답 변경|위스|추천|평가 목록|<details|InfoHelp/,
);
const zero = renderToStaticMarkup(
  React.createElement(Result, { ...props, score: 0, correctCount: 0 }),
);
assert.match(zero, />0<span[^>]*>점<\/span>/);
assert.match(zero, />0\/20<\/p>/);
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
console.log("Student quiz result: 18 regression assertions passed.");
