import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import ts from "typescript";

const require = createRequire(import.meta.url);
const {
  questionPresentation,
} = require("../functions/productionGateway/assessmentLearning.js");
const { canonicalDetail } = require("../functions/studentQuizHistory.js");
async function load(relative) {
  const { outputFiles } = await build({
    entryPoints: [relative],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  );
}
const { historyReviewQuestion } = await load(
  "src/pages/student/mypage/historyReviewData.ts",
);
const { buildQuizRelearningItems } = await load(
  "src/pages/student/quiz/quizPracticeData.ts",
);
const { normalizeQuizSubmissionDoc, getQuizSubmissionDeadlineMs } = await load(
  "src/lib/quizSubmissions.ts",
);

// Execute the actual runner start, answer, resume and submit functions together.
// This catches reordering in their call sites, not just in a standalone helper.
const source = readFileSync("src/pages/student/quiz/QuizRunner.tsx", "utf8");
const ast = ts.createSourceFile(
  "QuizRunner.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = [
  "questionsForAttempt",
  "mapCanonicalAttemptToSubmission",
  "parseOrderAnswer",
  "parseMatchingAnswer",
  "parseMatchingPairs",
  "shuffleItems",
  "buildOrderOptionMap",
  "restoreSubmissionState",
  "startQuiz",
  "handleAnswer",
  "finalizeQuizAttempt",
];
const declarations = new Map();
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    names.includes(node.name.getText(ast))
  ) {
    declarations.set(node.name.getText(ast), `const ${node.getText(ast)};`);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
for (const name of names)
  assert.ok(declarations.has(name), `${name} remains part of the tested flow`);
const executable = ts.transpileModule(
  [
    ...declarations.values(),
    `globalThis.runner = { ${names.join(", ")} };`,
  ].join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const snapshots = [
  {
    id: "30",
    type: "choice",
    question: "세 번째 ID의 실제 첫 문제",
    options: ["보기 B", "보기 A"],
    choiceOptionImages: ["image-b", "image-a"],
    answer: "보기 A",
    explanation: "첫 문제의 해설",
  },
  {
    id: "10",
    type: "order",
    question: "첫 번째 ID의 실제 둘째 문제",
    options: ["나", "가", "다"],
    answer: "가||나||다",
  },
  {
    id: "20",
    type: "matching",
    question: "두 번째 ID의 실제 셋째 문제",
    answer: "왕 A=>사건 B||왕 B=>사건 A",
    matchingPairs: [
      { left: "왕 A", right: "사건 B" },
      { left: "왕 B", right: "사건 A" },
    ],
  },
];
const answers = {
  30: "보기 B",
  10: "나||가||다",
  20: "왕 A=>사건 A||왕 B=>사건 B",
};
const identify = (questions, values) =>
  questions.map((q) => ({
    id: String(q.id),
    question: q.question,
    answer: values[String(q.id)],
  }));
let scenarios = 0;
for (const unitId of ["unit-a", "exam_prep"]) {
  for (const questionOrder of ["created", "unit", "random"]) {
    for (const random of [0, 0.35, 0.8]) {
      const attempt = {
        attemptId: "synthetic-attempt",
        definitionId: "synthetic-definition",
        semesterId: "2026-2",
        status: "STARTED",
        revision: 1,
        questionIds: snapshots.map((q) => q.id),
        // Transport order need not match questionIds; IDs control the presentation.
        questionPresentation: questionPresentation([...snapshots].reverse()),
        answers: {},
        currentItemId: "30",
        startedAtIso: "2026-10-26T01:00:00Z",
        deadlineAtIso: "2026-10-26T01:10:00Z",
        lastSavedAtIso: "2026-10-26T01:00:00Z",
        resumed: false,
        learningSnapshot: [],
      };
      let submittedInput;
      const result = {
        ...attempt,
        assessmentKind: "QUIZ",
        studentUid: "synthetic-student",
        percent: 0,
        questionSnapshots: [...snapshots].reverse(),
        answerChecks: snapshots.map((q) => ({ id: q.id, correct: false })),
        resultRef: "semester_assessment_results/synthetic-attempt",
      };
      const noop = () => {};
      const context = {
        Date,
        Map,
        Object,
        Math: Object.assign(Object.create(Math), { random: () => random }),
        ORDER_DELIMITER: "||",
        MATCHING_PAIR_DELIMITER: "=>",
        unitId,
        category: "formative",
        fallbackStudentUid: "synthetic-student",
        fallbackStudentEmail: "",
        userData: {},
        currentUser: null,
        title: "합성 평가",
        examRound: "",
        activeSubmission: null,
        quizConfig: { questionCount: 3, questionOrder },
        assessmentDefinitionId: attempt.definitionId,
        timeoutHandledRef: { current: false },
        finishSubmittingRef: { current: false },
        canonicalAttemptRef: { current: attempt },
        persistSaveTailRef: { current: Promise.resolve() },
        pendingSubmitAnalyticsRef: { current: undefined },
        resolveStudentIdentity: async () => {},
        getResolvedStudentUid: () => "synthetic-student",
        normalizeStudentText: (value) => String(value || ""),
        buildGradeClassLabel: () => "",
        normalizeQuizSubmissionDoc,
        getQuizSubmissionDeadlineMs,
        buildQuizRelearningItems,
        startAssessmentAttempt: async () => structuredClone(attempt),
        getAssessmentState: async () => ({
          attempt: structuredClone(attempt),
          serverNowIso: attempt.startedAtIso,
        }),
        submitAssessmentAttempt: async (input) => {
          submittedInput = input;
          return result;
        },
        emitSessionActivity: noop,
        beginTelemetry: noop,
        observe: noop,
        readTelemetry: () => undefined,
        schedulePersistQuizProgress: noop,
        showToast: (value) => {
          throw new Error(JSON.stringify(value));
        },
        console,
      };
      for (const key of [
        "selectedQuestions",
        "answers",
        "currentIndex",
        "hintUsedCount",
        "revealedHints",
        "orderOptionMap",
        "activeSubmission",
        "serverTimeOffsetMs",
        "quizDeadlineMs",
        "timeLeft",
        "startingQuiz",
        "canonicalAttempt",
        "resumeNotice",
        "view",
        "score",
        "reviewItems",
        "resultCounts",
        "finalizedResultId",
      ]) {
        context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
          context[key] =
            typeof value === "function" ? value(context[key]) : value;
        };
      }
      runInNewContext(executable, context);
      await context.runner.startQuiz();
      assert.deepEqual(
        plain(identify(context.selectedQuestions, {})),
        identify(snapshots, {}).map(plain),
        `${unitId}/${questionOrder}: actual start must keep server IDs and question text`,
      );
      assert.deepEqual(
        plain(context.selectedQuestions[0].options),
        snapshots[0].options,
      );
      assert.deepEqual(
        plain(context.selectedQuestions[0].choiceOptionImages),
        snapshots[0].choiceOptionImages,
      );
      assert.ok(
        context.selectedQuestions.every((q) => q.answer === ""),
        "Start never exposes grading answers",
      );
      assert.deepEqual(
        plain(context.orderOptionMap[10]).sort(),
        snapshots[1].options.slice().sort(),
      );
      assert.deepEqual(plain(context.orderOptionMap[20]).sort(), [
        "사건 A",
        "사건 B",
      ]);
      if (random === 0)
        assert.notDeepEqual(
          plain(context.orderOptionMap[10]),
          ["가", "나", "다"],
          "Order answer choices still shuffle independently of question numbers",
        );

      for (let index = 0; index < snapshots.length; index++) {
        context.currentIndex = index;
        context.runner.handleAnswer(answers[snapshots[index].id]);
      }
      assert.deepEqual(
        plain(context.answers),
        answers,
        "Actual input handler keys each answer by displayed question ID",
      );
      const original = plain(
        identify(context.selectedQuestions, context.answers),
      );
      const resumed = {
        ...attempt,
        status: "IN_PROGRESS",
        answers: plain(context.answers),
        currentItemId: "10",
      };
      context.runner.restoreSubmissionState(
        context.runner.mapCanonicalAttemptToSubmission(resumed),
        context.runner.questionsForAttempt(resumed),
        attempt.startedAtIso,
      );
      assert.deepEqual(
        plain(identify(context.selectedQuestions, context.answers)),
        original,
        "Reload restores identical question numbers, text and answers",
      );
      assert.equal(
        String(context.selectedQuestions[context.currentIndex].id),
        "10",
        "Current server item restores the same question, not a shuffled index",
      );

      await context.runner.finalizeQuizAttempt();
      assert.equal(submittedInput.attemptId, attempt.attemptId);
      assert.deepEqual(plain(submittedInput.answers), answers);
      const history = canonicalDetail(
        attempt.attemptId,
        result,
        submittedInput.answers,
      )
        .details.map(historyReviewQuestion)
        .map((item) => item.snapshot);
      assert.deepEqual(
        history.map((q) => ({
          id: q.id,
          question: q.question,
          answer: q.submittedAnswer,
        })),
        original,
        "MyPage preserves the actual start/resume/submit question identity and answer at every number",
      );
      assert.deepEqual(
        plain(
          context.reviewItems.map((q) => ({
            id: q.id,
            question: q.question,
            answer: q.submittedAnswer,
          })),
        ),
        original,
        "Immediate wrong-answer practice and MyPage use the same submitted questions",
      );
      scenarios += 1;
    }
  }
}
console.log(
  `Quiz history identity: ${scenarios} start/resume/answer/submit/history scenarios passed.`,
);
