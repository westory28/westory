import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRESENTATION_BASELINE = "676869fa289d3e7ecef234cbb5cca65c60ec4597";

const frozenPresentationFiles = [
  "src/components/common/Footer.tsx",
  "src/components/common/Header.tsx",
  "src/components/common/NotificationBell.tsx",
  "src/components/layout/MainLayout.tsx",
  "src/pages/Login.tsx",
  "src/pages/student/Calendar.tsx",
  "src/pages/student/Dashboard.tsx",
  "src/pages/student/History.tsx",
  "src/pages/student/Maintenance.tsx",
  "src/pages/student/MyPage.tsx",
  "src/pages/student/Points.tsx",
  "src/pages/student/components/CalendarSection.tsx",
  "src/pages/student/components/NoticeBoard.tsx",
  "src/pages/student/components/SearchModal.tsx",
  "src/pages/student/history-classroom/HistoryClassroomIndex.tsx",
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
  "src/pages/student/lesson/HistoryDictionary.tsx",
  "src/pages/student/lesson/Maps.tsx",
  "src/pages/student/lesson/Note.tsx",
  "src/pages/student/lesson/ThinkCloud.tsx",
  "src/pages/student/lesson/components/LessonContent.tsx",
  "src/pages/student/quiz/QuizRunner.tsx",
  "src/pages/student/score/PerformanceScoreView.tsx",
  "src/pages/student/score/ScoreDashboard.tsx",
  "src/pages/student/score/ScoreReport.tsx",
  "src/pages/student/score/WrittenExamEssayScoreView.tsx",
  "src/pages/teacher/Dashboard.tsx",
  "src/pages/teacher/ManageExam.tsx",
  "src/pages/teacher/ManageHistoryClassroom.tsx",
  "src/pages/teacher/ManageHistoryDictionary.tsx",
  "src/pages/teacher/ManageLesson.tsx",
  "src/pages/teacher/ManageMaps.tsx",
  "src/pages/teacher/ManagePoints.tsx",
  "src/pages/teacher/ManageQuiz.tsx",
  "src/pages/teacher/ManageSchedule.tsx",
  "src/pages/teacher/ManageSourceArchive.tsx",
  "src/pages/teacher/ManageThinkCloud.tsx",
  "src/pages/teacher/Settings.tsx",
  "src/pages/teacher/StudentList.tsx",
  "src/pages/teacher/components/ExamGradingPlan.tsx",
  "src/pages/teacher/components/ExamOmrConfig.tsx",
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
  "src/pages/teacher/components/SettingsAccess.tsx",
  "src/pages/teacher/components/SettingsGeneral.tsx",
  "src/pages/teacher/components/SettingsInterface.tsx",
  "src/pages/teacher/components/SettingsNotifications.tsx",
  "src/pages/teacher/components/SettingsPrivacy.tsx",
  "src/pages/teacher/components/SettingsSchool.tsx",
  "src/pages/teacher/components/WrittenExamEssayScoreManager.tsx",
];

const approvedSecurityStateClassExceptions = new Map([
  // 2026-09-10 user scope: remove saved ink/presentation launcher cards.
  // Only tokens lost with those controls are excepted; other pages stay frozen.
  [
    "src/pages/teacher/ManageLesson.tsx",
    new Set([
      "mt-4",
      "rounded-3xl",
      "uppercase",
      "tracking-[0.18em]",
      "text-slate-400",
      "fa-triangle-exclamation",
      "text-[11px]",
      "fa-check",
      "fa-clock",
      // Complete teacher presentation removal explicitly requested next.
      "z-[70]",
      "bg-slate-950/80",
      "backdrop-blur-sm",
      "h-full",
      "md:p-4",
      "rounded-2xl",
      "border-slate-700",
      "bg-slate-900/80",
      "text-slate-100",
    ]),
  ],
  [
    "src/components/common/NotificationBell.tsx",
    new Set([
      "inset-0",
      "z-[9999]",
      "bg-black",
      "bg-opacity-60",
      "backdrop-blur-sm",
      "mx-4",
      "max-h-[80vh]",
      "max-w-xl",
      "flex-col",
      "rounded-2xl",
      "border-gray-100",
      "p-5",
      "text-lg",
      "text-gray-900",
      "text-xl",
      "text-gray-400",
      "hover:text-gray-700",
      "p-6",
      "leading-relaxed",
      "text-gray-700",
      "policy-rich-text",
    ]),
  ],
  [
    "src/pages/student/components/CalendarSection.tsx",
    new Set(["student-calendar-shell__error-message"]),
  ],
]);

const normalize = (source) => source.replace(/\r\n?/gu, "\n");
const read = (path) => normalize(readFileSync(resolve(path), "utf8"));
const readBaseline = (path) =>
  normalize(
    execFileSync("git", ["show", `${PRESENTATION_BASELINE}:${path}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );

const extractStaticClassTokens = (source) => {
  const tokens = [];
  const attributePattern =
    /\bclassName\s*=\s*(?:\{\s*)?(["'`])([\s\S]*?)\1\s*\}?/gu;
  for (const match of source.matchAll(attributePattern)) {
    const staticValue = match[2].replace(/\$\{[\s\S]*?\}/gu, " ");
    for (const token of staticValue.split(/\s+/u)) {
      if (token && !/[{}$]/u.test(token)) tokens.push(token);
    }
  }
  return tokens;
};

const presentationResults = frozenPresentationFiles.map((path) => {
  const baselineTokens = [
    ...new Set(extractStaticClassTokens(readBaseline(path))),
  ];
  const currentSource = read(path);
  const approvedMissing = approvedSecurityStateClassExceptions.get(path);
  const missing = baselineTokens.filter(
    (token) => !currentSource.includes(token) && !approvedMissing?.has(token),
  );
  assert.deepEqual(
    missing,
    [],
    `${path} lost frozen Production class tokens: ${missing
      .slice(0, 12)
      .join(", ")}`,
  );
  return {
    path,
    baselineClassTokens: baselineTokens.length,
    retainedClassTokens: baselineTokens.length - missing.length,
  };
});

// User explicitly retired the complete teacher presentation surface.
assert.equal(
  existsSync(
    resolve("src/pages/teacher/components/TeacherLessonPresentation.tsx"),
  ),
  false,
);
assert.doesNotMatch(
  read("src/pages/teacher/ManageLesson.tsx"),
  /TeacherLessonPresentation|teacherPreviewOpen|onOpenTeacherPreview/u,
);
assert.doesNotMatch(
  read("src/pages/teacher/components/LessonEditorPanels.tsx"),
  /onOpenTeacherPreview|교사용 수업 화면/u,
);

const app = read("src/App.tsx");
const main = read("src/main.tsx");
const style = read("assets/css/style.css");
const tailwind = read("src/assets/tailwind.css");
const menus = read("src/constants/menus.ts");
const studentArchive = read("src/pages/student/StudentArchiveOverview.tsx");
const studentMyPage = read("src/pages/student/MyPage.tsx");
const schedule = read("src/pages/teacher/ManageSchedule.tsx");
const settings = read("src/pages/teacher/Settings.tsx");
const permissions = read("src/lib/permissions.ts");
const semesterCutoverServer = read("functions/semesterCutover.js");
const visualParityContract = JSON.parse(
  read("scripts/w10p-visual-parity-contract.json"),
);
const visualParityCapture = read("scripts/capture-w10p-visual-parity.mjs");
const visualParityVerifier = read("scripts/verify-w10p-visual-parity.mjs");
const manageExam = read("src/pages/teacher/ManageExam.tsx");
const performanceScoreManager = read(
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
);
const studentCalendar = read("src/pages/student/Calendar.tsx");
const studentScheduleAdapter = read("src/lib/legacyStudentScheduleAdapter.ts");
const studentThinkCloud = read("src/pages/student/lesson/ThinkCloud.tsx");
const teacherThinkCloud = read("src/pages/teacher/ManageThinkCloud.tsx");
const w8Domains = read("functions/w8Domains.js");
const lessonContent = read(
  "src/pages/student/lesson/components/LessonContent.tsx",
);
const performanceScore = read(
  "src/pages/student/score/PerformanceScoreView.tsx",
);
const writtenScore = read(
  "src/pages/student/score/WrittenExamEssayScoreView.tsx",
);

assert.doesNotMatch(app, /<AppShell\b|<NavigationDrawer\b/u);
assert.match(app, /import\("\.\/pages\/student\/Points"\)/u);
assert.match(app, /import\("\.\/pages\/teacher\/ManagePoints"\)/u);
assert.match(app, /import\("\.\/pages\/student\/lesson\/Note"\)/u);
assert.match(app, /import\("\.\/pages\/teacher\/ManageLesson"\)/u);
assert.match(
  main,
  /import "\.\/assets\/tailwind\.css";[\s\S]*?fontawesome-free\/css\/all\.min\.css[\s\S]*?assets\/css\/style\.css[\s\S]*?\.\/assets\/index\.css/u,
);
assert.match(
  tailwind,
  /^@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+KR:wght@400;500;700;800;900&display=swap"\);/u,
);
assert.match(style, /font-family:\s*'Noto Sans KR',\s*sans-serif/u);
assert.doesNotMatch(style, /\.ws-app-shell\b|\.ws-context-sidebar\b/u);

for (const label of [
  "학습",
  "평가",
  "점수",
  "위스",
  "마이페이지",
  "학습 자료 관리",
  "평가 관리",
  "점수 관리",
  "위스 관리",
  "학생 관리",
]) {
  assert.ok(
    menus.includes(`name: "${label}"`),
    `Frozen menu label missing: ${label}`,
  );
}

assert.doesNotMatch(studentMyPage, /StudentCurrentEnrollmentCard/u);
assert.match(studentArchive, /<StudentCurrentEnrollmentCard/u);
assert.match(schedule, /const canSyncHolidays = isAdminUser/u);
assert.match(
  schedule,
  /canSyncHolidays\s*&&\s*searchParams\.get\("adminTools"\) === "holidays"/u,
);
assert.match(
  settings,
  /import \{ ADMIN_EMAIL \} from "\.\.\/\.\.\/lib\/permissions";/u,
);
assert.match(
  settings,
  /const canOpenCutoverCenter =[\s\S]*?currentUser\?\.email[\s\S]*?=== ADMIN_EMAIL;/u,
);
assert.match(
  settings,
  /\{\(canOpenCutoverCenter \|\| activeTab === "archive-enrollment"\) && \(/u,
);
assert.doesNotMatch(settings, /westoria28@gmail\.com/u);
for (const fixtureAdminFence of [
  'import.meta.env.VITE_APP_ENV === "staging"',
  "import.meta.env.VITE_FIREBASE_PROJECT_ID === STAGING_PROJECT_ID",
  "normalizeEmail(email) === VISUAL_FIXTURE_ADMIN_EMAIL",
  "fixtureProfile?.uid === VISUAL_FIXTURE_ADMIN_UID",
  "fixtureProfile.fixtureOwner === VISUAL_FIXTURE_OWNER",
  "fixtureProfile.fixtureId === VISUAL_FIXTURE_ID",
]) {
  assert.ok(
    permissions.includes(fixtureAdminFence),
    `Visual fixture admin fence missing: ${fixtureAdminFence}`,
  );
}
assert.match(
  semesterCutoverServer,
  new RegExp(
    `const VISUAL_FIXTURE_PLAN_HASH\\s*=\\s*"${visualParityContract.fixturePlanHash}";`,
    "u",
  ),
  "The server fixture-admin read fence must bind the current visual fixture plan hash.",
);
assert.deepEqual(visualParityContract.deploymentVerification, {
  baseline: {
    inspectTarget: "preview",
    apiTarget: null,
    gitCommitRef: "HEAD",
  },
  candidate: {
    inspectTarget: "production",
    apiTarget: "production",
    gitCommitRef: visualParityContract.branch,
  },
});
for (const [path, source] of [
  ["scripts/capture-w10p-visual-parity.mjs", visualParityCapture],
  ["scripts/verify-w10p-visual-parity.mjs", visualParityVerifier],
]) {
  assert.match(
    source,
    /const canonicalizeBackupValue = \(value\) =>/u,
    `${path} must reproduce the fixture backup-value canonicalization contract.`,
  );
  assert.match(
    source,
    /documentHash:\s*sha256\(Buffer\.from\(canonicalBackupJson\(data\)\)\)/u,
    `${path} must derive access-probe canary hashes from backup canonicalization.`,
  );
  assert.match(
    source,
    /positiveControlDocumentHash:\s*sha256\(\s*Buffer\.from\(canonicalBackupJson\(preBackupPositiveControlData\)\)/u,
    `${path} must derive the pre-backup positive-control hash from backup canonicalization.`,
  );
  assert.match(
    source,
    /const verifyBackupHashKnownVectors = \(\) =>/u,
    `${path} must pin independent backup-hash regression vectors.`,
  );
  assert.match(
    source,
    /backupHashKnownVectorCount = verifyBackupHashKnownVectors\(\)/u,
    `${path} must execute the backup-hash regression vectors.`,
  );
}
assert.match(manageExam, /"evidence-performance"[\s\S]*?"evidence-written"/u);
assert.match(performanceScore, /searchParams\.get\("view"\) === "evidence"/u);
assert.match(writtenScore, /searchParams\.get\("view"\) === "evidence"/u);
assert.doesNotMatch(
  performanceScoreManager,
  /\bdeleteStudentData\b/u,
  "Score-row editing must never invoke the whole-account deletion callable",
);
assert.doesNotMatch(studentCalendar, /firebase\/firestore/u);
assert.match(studentScheduleAdapter, /domain:\s*"SCHEDULE"/u);
assert.match(studentScheduleAdapter, /audience:\s*"student"/u);
assert.match(
  studentThinkCloud,
  /<WordCloudView[\s\S]*?showSubmitters=\{!options\.anonymous\}/u,
);
assert.match(studentThinkCloud, /responseLoadState === "loading"/u);
assert.match(studentThinkCloud, /responseLoadState === "error"/u);
const responseProjectionStart = w8Domains.indexOf(
  "thinkCloudResponses = responseRows.map",
);
const responseProjectionEnd = w8Domains.indexOf(
  'if (query.audience === "teacher")',
  responseProjectionStart,
);
assert.ok(
  responseProjectionStart >= 0 &&
    responseProjectionEnd > responseProjectionStart,
  "Student ThinkCloud response projection boundary is missing",
);
const responseProjection = w8Domains.slice(
  responseProjectionStart,
  responseProjectionEnd,
);
assert.match(responseProjection, /textRaw/u);
assert.match(responseProjection, /textNormalized/u);
assert.match(responseProjection, /isOwn:\s*row\.data\?\.uid === uid/u);
assert.match(
  responseProjection,
  /if \(query\.audience !== "student"\) return \{ \.\.\.row\.data, id \};/u,
);
assert.match(responseProjection, /!anonymousStudent[\s\S]*?displayName/u);
assert.doesNotMatch(responseProjection, /\buid\s*:/u);
assert.match(studentThinkCloud, /sessionLoadState === "permission"/u);
assert.match(studentThinkCloud, /sessionLoadState === "error"/u);
assert.match(studentThinkCloud, /responseLoadState === "permission"/u);
assert.match(
  studentThinkCloud,
  /responseLoadState === "error"[\s\S]*?setResponseLoadAttempt/u,
);
assert.match(teacherThinkCloud, /sessionLoadState === "permission"/u);
assert.match(teacherThinkCloud, /sessionLoadState === "error"/u);
assert.doesNotMatch(lessonContent, /\bclaimPointActivityReward\b/u);

console.log(
  JSON.stringify({
    suite: "w10p-presentation-static-precheck",
    passed: true,
    evidenceScope: "STATIC_SOURCE_PRECHECK",
    visualParityStatus: "REQUIRED_SEPARATELY",
    visualParityVerifier: "scripts/verify-w10p-visual-parity.mjs",
    presentationBaseline: PRESENTATION_BASELINE,
    frozenFiles: presentationResults.length,
    retainedProductionClassTokens: presentationResults.reduce(
      (total, item) => total + item.retainedClassTokens,
      0,
    ),
    missingProductionClassTokens: 0,
    rejectedShellMounts: 0,
    productionAccessMeasurement: "NOT_MEASURED",
    productionWritesMeasurement: "NOT_MEASURED",
  }),
);
