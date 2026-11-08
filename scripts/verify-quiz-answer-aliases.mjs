import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const server = require("../functions/quizAnswerMatching.js");
const bundle = await build({
  stdin: { contents: `export * from './src/lib/quizAnswerMatching';
    export * from './src/lib/assessmentAnswerLimits';
    export {isQuizPracticeAnswerCorrect} from './src/pages/student/quiz/quizPracticeData';`,
    resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs",
});
const client = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(client, client.exports, require);
const cases = [
  ["short", "명", "명, 명나라", true],
  ["short", "명나라", "명, 명나라", true],
  ["word", " 명 나 라 ", " 명 , 명나라, ", true],
  ["short", "명, 명나라", "명, 명나라", false],
  ["short", "청", "명, 명나라", false],
  ["short", "", " , , ", false],
  ["short", "   ", "명, ", false],
  ["choice", "ㄱ", "ㄱ, ㄴ", false],
  ["choice", "ㄱ,ㄴ", "ㄱ, ㄴ", true],
  ["ox", "O", "O", true],
  ["order", "가", "가,나||다", false],
  ["matching", "가=>명", "가=>명,청||나=>조선", false],
  [undefined, "명", "명, 명나라", false],
  [undefined, "명,명나라", "명, 명나라", true],
];
for (const [type, actual, expected, result] of cases) {
  assert.equal(server.isQuizAnswerCorrect(type, actual, expected), result);
  assert.equal(client.exports.isQuizAnswerCorrect(type, actual, expected), result);
  assert.equal(client.exports.isQuizPracticeAnswerCorrect(actual, expected, type), result);
}
assert(server.isValidShortAnswerKey(`${"가".repeat(20)}, ${"나".repeat(20)}`));
assert(!client.exports.exceedsShortAnswerLimit(`${"가".repeat(20)}, ${"나".repeat(20)}`));
assert(!server.isValidShortAnswerKey(`명,${"가".repeat(21)}`));
assert(client.exports.exceedsShortAnswerLimit(`명,${"가".repeat(21)}`));
assert(!server.isValidShortAnswerKey(" , , "));
assert.deepEqual(client.exports.getAcceptedQuizAnswers(" ,명, 명나라,,"), ["명", "명나라"]);
console.log(`PASS ${cases.length} server/browser/review answer cases; per-alternative limits and empty-key validation`);
