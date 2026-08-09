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
  /window\.setTimeout\([\s\S]*handleForcedCancel\("visibility-hidden"\)[\s\S]*VISIBILITY_CANCEL_DELAY_MS/.test(
    historyRunner,
  ),
  "History classroom must delay visibility-hidden cancellation instead of cancelling immediately.",
);
assert(
  /saveResult\(\{\s*status:\s*"cancelled"/.test(historyRunner),
  "History classroom must still reset/cancel the attempt on confirmed page exits.",
);
assert(
  /(attempt-started|attempt-active|attempt-left)/.test(historyRunner),
  "History classroom must keep retry locks for actual attempt start/exit paths.",
);
assert(
  /const handleBeforeUnload[\s\S]*writeCooldownLock/.test(historyRunner),
  "History classroom beforeunload path must lock/reset instead of silently preserving the attempt.",
);
assert(
  !/setInterval\(emitSessionActivity, 60 \* 1000\)/.test(historyRunner),
  "History classroom must not bypass idle expiry with an automatic session heartbeat.",
);
assert(
  !/setInterval\(emitSessionActivity, 60 \* 1000\)/.test(quizRunner),
  "Quiz runner must not bypass idle expiry with an automatic session heartbeat.",
);
assert(
  /const savedAttempt = readJsonObject\([\s\S]*getAttemptProgressKey\(loaded\.id, userData\.uid\)[\s\S]*const hasRecoverableAttempt/.test(
    historyRunner,
  ),
  "History classroom must inspect a saved attempt before enforcing the local retry cooldown.",
);
assert(
  /!isRotationResume &&[\s\S]*!hasRecoverableAttempt/.test(historyRunner),
  "History classroom must allow a saved attempt to resume after reauthentication.",
);
assert(
  /if \(nextTimeLeft <= 0 && !timeoutHandledRef\.current\)/.test(quizRunner),
  "Quiz runner timeout submission must stay gated by the configured deadline.",
);

console.log("Assessment attempt safety checks passed.");
