import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(`${root}/${path}`, "utf8");

const [lessonSource, clientSource, safetySource, functionsSource, wisSource] =
  await Promise.all([
    read("src/pages/student/lesson/components/LessonContent.tsx"),
    read("src/lib/lessonCorePointReward.ts"),
    read("src/lib/legacyLessonRewardSafety.ts"),
    read("functions/index.js"),
    read("functions/wisEconomy.js"),
  ]);

assert.doesNotMatch(
  lessonSource,
  /claimPointActivityReward/,
  "the retired reward callable must stay disconnected",
);
assert.match(
  lessonSource,
  /recordLessonCorePointFind/,
  "each discovered core point must use the verified server command",
);
assert.match(
  lessonSource,
  /rewardResult\.settled[\s\S]*setCorePointRewardSettled\(true\)/,
  "the UI may settle only a server-confirmed reward result",
);
assert.match(
  clientSource,
  /westory:lesson-core-point-command:v1/,
  "the client must preserve a stable command ID across ambiguous retries",
);
assert.match(
  clientSource,
  /if \(!isAmbiguous\(error\)\)[\s\S]*forgetPending/,
  "ambiguous failures must preserve the retry handle",
);
assert.match(
  safetySource,
  /claimLessonCorePointReward/,
  "the presentation adapter must call the dedicated reward command",
);

for (const required of [
  "recordLessonCorePointFind",
  "claimLessonCorePointReward",
  "LESSON_CORE_POINT_NOT_CANONICAL",
  "LESSON_CORE_POINT_ACTIVE_ENROLLMENT_REQUIRED",
  "LESSON_CORE_POINT_COMMAND_ID_CONFLICT",
  "lesson-core-points-all",
  "archiveEnrollment.ENROLLMENT_SLOT_COLLECTION",
  "archiveEnrollment.buildEnrollmentSlotId",
  'enrollment.enrollmentStatus !== "ACTIVE"',
  "Number(pointer.revision || 0) !== Number(manifest.revision || 0)",
  "account.accountId !== accountId",
  "LESSON_CORE_POINT_RECENT_LEDGER_LIMIT = 100",
  "recentLedgerEntries:",
  "earnedTotal: nextEarnedTotal",
  "rankEarnedTotal: nextRankEarnedTotal",
  "adjustedTotal: nextAdjustedTotal",
  "commandGateway.RECEIPT_COLLECTION",
  "commandGateway.AUDIT_COLLECTION",
  "TEST_COMMIT_ABORT",
  "TEST_RESPONSE_LOSS",
]) {
  assert.ok(
    functionsSource.includes(required),
    `missing lesson reward safety contract: ${required}`,
  );
}
assert.doesNotMatch(
  functionsSource,
  /const enrollmentQuery = db[\s\S]*SEMESTER_ENROLLMENT_COLLECTION[\s\S]*\.where\("semesterId"/,
  "lesson commands must resolve the caller's active slot instead of scanning a semester enrollment query",
);
assert.doesNotMatch(
  functionsSource,
  /account\.enrollmentId !== activeEnrollment\.enrollmentId/,
  "a safe class move must not strand the student's deterministic semester Wis account",
);
assert.match(
  functionsSource,
  /transaction\.create\(ledgerRef,[\s\S]*transaction\.set\(\s*progressRootRef,[\s\S]*writeLessonCorePointCommandReceipt/,
  "ledger, completion marker, and receipt must share the command transaction",
);
assert.match(
  functionsSource,
  /const duplicate = ledgerSnapshot\.exists \|\| legacySettled/,
  "both W7 source ledger and migrated legacy settlement must fence duplicates",
);
assert.match(
  functionsSource,
  /LESSON_CORE_POINT_REWARD_AMOUNT = 500/,
  "the client must not control the reward amount",
);
assert.match(
  wisSource,
  /const STUDENT_COMMAND_TYPES = new Set\(\[WIS_COMMAND_TYPES\.PLACE_WIS_ORDER\]\)/,
  "students must still be unable to invoke arbitrary grantWis",
);
assert.match(
  functionsSource,
  /exports\.applyPointActivityReward[\s\S]*이전 위스 자동 지급 경로는 종료되었습니다/,
  "the retired generic reward callable must remain blocked",
);

console.log(
  "W10P lesson reward contract PASS: canonical evidence, active scope, stable receipts, one-source ledger, and retired-callable fence are present.",
);
