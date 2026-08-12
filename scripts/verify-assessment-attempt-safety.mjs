import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const quiz = read("src/pages/student/quiz/QuizRunner.tsx");
const history = read(
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
);
const client = read("src/lib/assessmentLifecycle.ts");
const server = read("functions/assessmentLifecycle.js");
const index = read("functions/index.js");
const rules = read("firestore.rules");
const teacherAssessmentSources = [
  ["Quiz settings", read("src/pages/teacher/components/QuizSettingsModal.tsx")],
  ["Quiz editor", read("src/pages/teacher/components/QuizEditor.tsx")],
  ["Quiz bank", read("src/pages/teacher/components/QuizBankTab.tsx")],
  ["History Classroom manager", read("src/pages/teacher/ManageHistoryClassroom.tsx")],
];

for (const [label, source] of [
  ["Quiz", quiz],
  ["History Classroom", history],
]) {
  assert(
    !/\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(
      source,
    ),
    `${label} runner must not mutate Firestore directly.`,
  );
  assert(
    /getAssessmentState\s*\(/.test(source),
    `${label} preflight must use the query-only assessment resolver.`,
  );
  assert(
    /startAssessmentAttempt\s*\(/.test(source),
    `${label} must create an attempt only through the explicit start command.`,
  );
  assert(
    /saveAssessmentProgress\s*\(/.test(source),
    `${label} must save progress through the revision-fenced server callable.`,
  );
  assert(
    /submitAssessmentAttempt\s*\(/.test(source),
    `${label} must submit through the atomic command gateway path.`,
  );
  assert(
    !/submitHistoryClassroomResultViaFunction|quiz_results["'`\s)]*,\s*resultPayload/.test(
      source,
    ),
    `${label} retains a legacy split result writer.`,
  );
}

for (const [label, source] of teacherAssessmentSources) {
  assert(
    !/\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|serverTimestamp)\s*\(/.test(
      source,
    ),
    `${label} must not mutate assessment state directly.`,
  );
  assert(
    /executeWestoryCommand\s*\(/.test(source),
    `${label} must use the command gateway for teacher mutations.`,
  );
}
const historyManager = teacherAssessmentSources.find(
  ([label]) => label === "History Classroom manager",
)?.[1] || "";
assert(
  /legacyAssignmentIds\.has/.test(historyManager) &&
    /legacyMapIds\.has/.test(historyManager) &&
    /이전 자료\(읽기 전용\)/.test(historyManager),
  "Legacy History Classroom sources must remain visibly read-only.",
);
assert(
  /setLegacySource\(true\)/.test(history) &&
    /state="LEGACY"/.test(history) &&
    /readOnly/.test(history),
  "Student legacy History Classroom access must identify provenance and stay read-only.",
);

assert(
  /if \(!attemptStarted && !completed\)/.test(history) &&
    /beginOrResumeAttempt/.test(history),
  "History Classroom must render a write-free PREVIEW state before explicit start.",
);
assert(
  !/handleForcedCancel\("(?:visibility-hidden|pagehide)"\)/.test(history),
  "History Classroom visibility/pagehide cleanup must not cancel an attempt.",
);
assert(
  /const confirmPendingExit[\s\S]*await handleForcedCancel/.test(history) &&
    /handleForcedCancel[\s\S]*await saveAssessmentProgress[\s\S]*navigate\(/.test(history),
  "Route navigation must wait for the recoverable progress save path.",
);
assert(
  /addEventListener\("offline", markOffline\)/.test(history) &&
    /writeLocalOnly\([\s\S]*getAttemptProgressKey/.test(history) &&
    /pendingSubmitAfterOnline[\s\S]*submitAnswers/.test(history),
  "Offline progress must remain local and resume submission after reconnect.",
);
assert(
  !/setInterval\(emitSessionActivity,\s*60 \* 1000\)/.test(quiz) &&
    !/setInterval\(emitSessionActivity,\s*60 \* 1000\)/.test(history),
  "Assessment runners must not bypass idle expiry with a session heartbeat.",
);

for (const token of [
  "START_ASSESSMENT_ATTEMPT",
  "SUBMIT_ASSESSMENT_ATTEMPT",
  "RESET_ASSESSMENT_ATTEMPTS_BY_CLASS",
  "ASSESSMENT_ATTEMPT_REVISION_CONFLICT",
  "ASSESSMENT_ENROLLMENT_REQUIRED",
  "ASSESSMENT_SOURCE_STALE",
  "ASSESSMENT_COOLDOWN_ACTIVE",
  "selectAttemptQuestionIds",
  "deadlineAtIso",
  "transaction.create(immutableSubmissionPath",
  "transaction.create(immutableResultPath",
  "assessment_readiness",
  "UPSERT_QUIZ_QUESTION",
  "DELETE_QUIZ_QUESTION",
  "UPSERT_HISTORY_CLASSROOM_SOURCE",
  "DELETE_HISTORY_CLASSROOM_SOURCE",
  "UPDATE_MAP_RESOURCE_BLANKS",
  "assertAssessmentSemesterWritable",
  "assertAssessmentDefinitionSemesterWritable",
  "TEST_FAULT_INJECTION_FORBIDDEN",
]) {
  assert(server.includes(token), `Assessment server contract is missing ${token}.`);
}

assert(
  /executeStudentAssessmentCommand[\s\S]*getCommandStatus/.test(client),
  "Ambiguous student command responses must recover through receipt status.",
);

assert(
  (rules.match(/match \/quiz_questions\/\{docId\}[\s\S]*?allow create, update, delete: if false;/g) || []).length >= 2 &&
    (rules.match(/match \/history_classrooms\/\{docId\}[\s\S]*?allow create, update, delete: if false;/g) || []).length >= 2 &&
    (rules.match(/match \/assessment_config\/\{docId\}[\s\S]*?docId != 'settings'/g) || []).length >= 2 &&
    (rules.match(/match \/map_resources\/\{docId\}[\s\S]*?allow create, update, delete: if false;/g) || []).length >= 2,
  "Teacher assessment source writes must be fenced behind the command gateway.",
);
assert(
  /ASSESSMENT_LEGACY_SUBMISSION_RETIRED/.test(index) &&
    /ASSESSMENT_LEGACY_RESET_RETIRED/.test(index) &&
    /ASSESSMENT_RESULT_RECALCULATION_RETIRED/.test(index),
  "Legacy assessment mutation callables must fail closed.",
);

for (const collection of [
  "semester_assessment_definitions",
  "semester_assessment_attempts",
  "semester_assessment_submissions",
  "semester_assessment_results",
]) {
  assert(
    new RegExp(`match /${collection}/\\{docId\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`).test(
      rules,
    ),
    `${collection} must be server-only in Firestore Rules.`,
  );
}

assert(
  /match \/quiz_results\/\{resultId\}[\s\S]*?allow create, update, delete: if false;/.test(
    rules,
  ) &&
    /match \/quiz_submissions\/\{docId\}[\s\S]*?allow create, update, delete: if false;/.test(
      rules,
    ) &&
    /match \/history_classroom_results\/\{docId\}[\s\S]*?allow create, update, delete: if false;/.test(
      rules,
    ),
  "Legacy root/semester result and submission writes must be denied.",
);

console.log(
  JSON.stringify({
    suite: "assessment-attempt-safety",
    passed: true,
    checks: [
      "PREFLIGHT_QUERY_ONLY_BOTH_DOMAINS",
      "EXPLICIT_START_ONLY_BOTH_DOMAINS",
      "DIRECT_FIRESTORE_MUTATION_ZERO",
      "REVISION_FENCED_SAVE",
      "ATOMIC_RECEIPT_SUBMISSION_RESULT",
      "SERVER_DEADLINE_AND_ENROLLMENT_AUTHORITY",
      "SERVER_QUESTION_SELECTION_AUTHORITY",
      "TEACHER_ASSESSMENT_WRITES_GATEWAY_ONLY",
      "ARCHIVE_SOURCE_WRITE_FENCE",
      "LEGACY_PROVENANCE_VISIBLE_READ_ONLY",
      "LEGACY_CALLABLES_RETIRED",
      "OLD_BUNDLE_DIRECT_WRITE_DENIED",
      "VISIBILITY_PAGEHIDE_NO_CANCEL",
      "NAVIGATION_WAITS_FOR_RECOVERABLE_SAVE",
      "OFFLINE_LOCAL_PROGRESS_AND_RECONNECT_SUBMIT",
      "READINESS_REQUIRED",
    ],
    productionAccess: 0,
  }),
);
