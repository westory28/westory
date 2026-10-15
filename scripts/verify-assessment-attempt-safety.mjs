import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const historyRunner = read(
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
);
const quizRunner = read("src/pages/student/quiz/QuizRunner.tsx");

assert(
  /VISIBILITY_CANCEL_DELAY_MS\s*=\s*3000/.test(historyRunner),
  "History classroom visibility cancellation must use a short delay to avoid transient browser visibility false positives.",
);
assert(
  /window\.setTimeout\([\s\S]*recordAttemptViolation\("VISIBILITY_HIDDEN"\)[\s\S]*VISIBILITY_CANCEL_DELAY_MS/.test(
    historyRunner,
  ),
  "History classroom must delay visibility-hidden cancellation instead of cancelling immediately.",
);
assert(
  /const handleForcedCancel[\s\S]*lockHistoryClassroomAttempt[\s\S]*await persistCanonicalProgress/.test(
    historyRunner,
  ) && !/saveResult\(\{\s*status:\s*"cancelled"/.test(historyRunner),
  "Confirmed exits must lock the canonical attempt while refresh preserves it; never fabricate cancelled results.",
);
assert(
  /const beginCanonicalAttempt[\s\S]*await startAssessmentAttempt/.test(
    historyRunner,
  ) &&
    !/startAssessmentAttempt/.test(
      historyRunner
        .split("const loadAssignment = async")[1]
        .split("const beginCanonicalAttempt")[0],
    ),
  "Reading the assignment must remain read-only; the student explicitly starts the server attempt.",
);
assert(
  !/attemptDeadlineMsRef\.current \+=|pausedMs/.test(historyRunner),
  "Offline recovery must not extend the authoritative assessment deadline.",
);
assert(
  /const handleBeforeUnload[\s\S]*persistAttemptProgress/.test(historyRunner),
  "History classroom browser reload must preserve the attempt; explicit confirmed exits still cancel above.",
);
assert(
  /setInterval\(emitSessionActivity, 60 \* 1000\)/.test(historyRunner),
  "History classroom must keep the app session alive while an attempt is open.",
);
assert(
  /setInterval\(emitSessionActivity, 60 \* 1000\)/.test(quizRunner),
  "Quiz runner must keep the app session alive while an attempt is open.",
);
assert(
  /if \(nextTimeLeft <= 0 && !timeoutHandledRef\.current\)/.test(quizRunner),
  "Quiz runner timeout submission must stay gated by the configured deadline.",
);

console.log("Assessment attempt safety checks passed.");
