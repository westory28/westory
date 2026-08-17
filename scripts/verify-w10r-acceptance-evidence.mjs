import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EVIDENCE_ROOT = resolve(
  "docs/evidence/w10r-ui-recovery/w10r-canonical-20260817",
);
const FIXTURE_ROOT = resolve("docs/evidence/w10-ui-ux/w10-w10r-20260817a");
const SOURCE_SHA = "7ddfd7202ba3e59eb9e9ded5d105dde4d604693b";
const DEPLOYMENT_ID = "dpl_DFvjkFTw4knYS3ZR34ixcdHqtTJM";
const STABLE_ALIAS =
  "https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const readText = (path) => readFileSync(resolve(path), "utf8");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const sourceFiles = {
  teacherDashboard: readText("src/pages/teacher/Dashboard.tsx"),
  studentList: readText("src/pages/teacher/StudentList.tsx"),
  manageQuiz: readText("src/pages/teacher/ManageQuiz.tsx"),
  quizBank: readText("src/pages/teacher/components/QuizBankTab.tsx"),
  cutover: readText("src/pages/teacher/SemesterCutoverCenterView.tsx"),
  studentDashboard: readText("src/pages/student/Dashboard.tsx"),
  pageHeader: readText("src/components/common/PageHeader.tsx"),
  header: readText("src/components/common/Header.tsx"),
  navigationDrawer: readText("src/components/shell/NavigationDrawer.tsx"),
  globalCss: readText("assets/css/style.css"),
  domainCss: readText("src/pages/w8Domains.css"),
};

const inspectJpeg = (jpeg, label) => {
  assert.ok(jpeg.length > 4, `${label} is too small.`);
  assert.equal(jpeg[0], 0xff, `${label} has no JPEG SOI marker.`);
  assert.equal(jpeg[1], 0xd8, `${label} has no JPEG SOI marker.`);
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset < jpeg.length) {
    assert.equal(jpeg[offset], 0xff, `${label} has an invalid JPEG marker.`);
    while (jpeg[offset] === 0xff) offset += 1;
    const marker = jpeg[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    assert.ok(offset + 2 <= jpeg.length, `${label} has a truncated segment.`);
    const length = jpeg.readUInt16BE(offset);
    assert.ok(length >= 2, `${label} has an invalid segment length.`);
    assert.ok(
      offset + length <= jpeg.length,
      `${label} has a truncated segment payload.`,
    );
    if (startOfFrameMarkers.has(marker)) {
      assert.ok(length >= 7, `${label} has an invalid frame header.`);
      return {
        width: jpeg.readUInt16BE(offset + 5),
        height: jpeg.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  assert.fail(`${label} has no JPEG frame header.`);
};

const luminance = (hex) => {
  const components = hex
    .slice(1)
    .match(/.{2}/gu)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  return (
    components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722
  );
};

const contrastRatio = (foreground, background) => {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

const acceptance = readJson(
  resolve(EVIDENCE_ROOT, "canonical-acceptance-results.json"),
);
const screenshotManifest = readJson(
  resolve(EVIDENCE_ROOT, "screenshot-manifest.json"),
);
const browserNavigation = readJson(
  resolve(EVIDENCE_ROOT, "browser-navigation-results.json"),
);
assert.equal(acceptance.schemaVersion, 1);
assert.equal(acceptance.phase, "W10R");
assert.equal(acceptance.status, "PASS");
assert.equal(acceptance.sourceCommitSha, SOURCE_SHA);
assert.equal(acceptance.deploymentId, DEPLOYMENT_ID);
assert.equal(acceptance.stableAlias, STABLE_ALIAS);
assert.equal(acceptance.productionAccess, 0);
assert.equal(acceptance.productionWrites, 0);
assert.ok(String(acceptance.evidenceScope?.limitation || "").length >= 30);
assert.equal(screenshotManifest.sourceCommitSha, SOURCE_SHA);
assert.equal(screenshotManifest.deploymentId, DEPLOYMENT_ID);
assert.equal(screenshotManifest.status, "PASS");
assert.equal(screenshotManifest.screenshots.length, 30);
assert.equal(screenshotManifest.captureMode, "authenticated-batch");
assert.ok(String(screenshotManifest.captureTimestampSemantics).length >= 20);
assert.equal(screenshotManifest.productionAccess, 0);
assert.equal(screenshotManifest.productionWrites, 0);
assert.equal(browserNavigation.sourceCommitSha, SOURCE_SHA);
assert.equal(browserNavigation.deploymentId, DEPLOYMENT_ID);
assert.equal(browserNavigation.status, "PASS");
assert.equal(browserNavigation.productionAccess, 0);
assert.equal(browserNavigation.productionWrites, 0);

const expectedScreens = new Map([
  ["teacher-dashboard", "/teacher/dashboard"],
  ["teacher-students", "/teacher/students"],
  ["teacher-quiz-bank", "/teacher/quiz?tab=bank"],
  ["teacher-cutover", "/teacher/settings/cutover"],
  ["student-today", "/student/dashboard"],
]);
const requiredStates = new Set([
  "normal",
  "empty",
  "loading",
  "error",
  "disabled",
  "permission",
  "long-korean",
  "dangerous-confirmation",
  "small-screen",
  "large-screen",
]);
assert.deepEqual(new Set(acceptance.requiredStateIds), requiredStates);
assert.equal(acceptance.screens.length, expectedScreens.size);
for (const screen of acceptance.screens) {
  assert.equal(expectedScreens.get(screen.id), screen.route, screen.id);
  assert.ok(["student", "teacher", "admin"].includes(screen.role));
  assert.equal(screen.screenshotCount, 6);
  assert.equal(screen.stateEvidence.length, requiredStates.size);
  assert.deepEqual(
    new Set(screen.stateEvidence.map((state) => state.id)),
    requiredStates,
  );
  for (const state of screen.stateEvidence) {
    assert.equal(state.status, "PASS", `${screen.id}:${state.id}`);
    assert.ok(String(state.method || "").trim(), `${screen.id}:${state.id}`);
    assert.ok(String(state.reference || "").trim(), `${screen.id}:${state.id}`);
    if (state.reference.endsWith(".png")) {
      assert.ok(
        screenshotManifest.screenshots.some(
          (screenshot) =>
            screenshot.screenId === screen.id &&
            screenshot.fileName === state.reference &&
            screenshot.status === "PASS" &&
            screenshot.overflowX === 0,
        ),
        `${screen.id}:${state.id} has no matching screenshot evidence.`,
      );
    }
  }
  const normalState = screen.stateEvidence.find(
    (state) => state.id === "normal",
  );
  assert.equal(normalState.method, "browser");
  assert.equal(normalState.reference, `screenshot-manifest.json#${screen.id}`);
  assert.equal(
    screenshotManifest.screenshots.filter(
      (screenshot) => screenshot.screenId === screen.id,
    ).length,
    6,
  );
}

const sourceAnchorContracts = new Map([
  [
    "src/pages/teacher/Dashboard.tsx#todaySchedule-EMPTY",
    [
      sourceFiles.teacherDashboard,
      /todaySchedule\.length === 0[\s\S]{0,120}?state="EMPTY"/u,
    ],
  ],
  [
    "src/pages/teacher/Dashboard.tsx#loading-StatePanel",
    [
      sourceFiles.teacherDashboard,
      /if \(loading\) return <StatePanel state="LOADING" \/>/u,
    ],
  ],
  [
    "src/pages/teacher/Dashboard.tsx#error-StatePanel",
    [
      sourceFiles.teacherDashboard,
      /if \(error && !state\)[\s\S]{0,220}?toW8StatePanelState\(error\)/u,
    ],
  ],
  [
    "src/pages/teacher/Dashboard.tsx#permission-aware-StatePanel",
    [sourceFiles.teacherDashboard, /state=\{toW8StatePanelState\(error\)\}/u],
  ],
  [
    "src/pages/teacher/StudentList.tsx#filteredStudents-empty",
    [
      sourceFiles.studentList,
      /filteredStudents\.length === 0[\s\S]{0,220}?아직 등록된 학생이 없습니다/u,
    ],
  ],
  [
    "src/pages/teacher/StudentList.tsx#loading-table-state",
    [
      sourceFiles.studentList,
      /\{loading \? \([\s\S]{0,220}?학생 명단을 불러오고 있습니다/u,
    ],
  ],
  [
    "src/pages/teacher/StudentList.tsx#read-error-classification",
    [
      sourceFiles.studentList,
      /const getStudentListReadError[\s\S]{0,1000}?네트워크 연결이 불안정해/u,
    ],
  ],
  [
    "src/pages/teacher/StudentList.tsx#readOnly-controls",
    [sourceFiles.studentList, /disabled=\{readOnly/u],
  ],
  [
    "src/pages/teacher/StudentList.tsx#read-error-permission",
    [
      sourceFiles.studentList,
      /permission-denied[\s\S]{0,240}?학생 명단을 볼 권한이 없습니다/u,
    ],
  ],
  [
    "src/pages/teacher/StudentList.tsx#handleDelete-confirmAction",
    [
      sourceFiles.studentList,
      /const confirmed = await confirmAction\(\{[\s\S]{0,180}?학생을 삭제할까요/u,
    ],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#filteredQuestions-empty-StatePanel",
    [
      sourceFiles.quizBank,
      /filteredQuestions\.length === 0[\s\S]{0,180}?state="EMPTY"/u,
    ],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#question-loading-StatePanel",
    [sourceFiles.quizBank, /\{loading \? \([\s\S]{0,120}?state="LOADING"/u],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#question-error-StatePanel",
    [
      sourceFiles.quizBank,
      /hasPrimaryDataError \? \([\s\S]{0,140}?"PERMISSION" : "ERROR"/u,
    ],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#analytics-filters-disabled",
    [sourceFiles.quizBank, /disabled=\{analyticsLoadStatus !== "ready"\}/u],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#question-permission-StatePanel",
    [
      sourceFiles.quizBank,
      /questionLoadStatus === "permission"[\s\S]{0,180}?문제 목록을 볼 권한이 없습니다/u,
    ],
  ],
  [
    "src/pages/teacher/components/QuizBankTab.tsx#closeEditModal-confirmAction",
    [
      sourceFiles.quizBank,
      /closeEditModal[\s\S]{0,180}?confirmAction\(\{[\s\S]{0,140}?문항 수정을 닫을까요/u,
    ],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#readiness-empty",
    [
      sourceFiles.cutover,
      /readiness\.length === 0[\s\S]{0,120}?아직 준비도 검증 결과가 없습니다/u,
    ],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#loading-StatePanel",
    [sourceFiles.cutover, /status === "LOADING"[\s\S]{0,140}?state="LOADING"/u],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#error-StatePanel",
    [sourceFiles.cutover, /status === "ERROR"[\s\S]{0,140}?state="ERROR"/u],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#action-allowed-lock",
    [sourceFiles.cutover, /disabled=\{!action\.allowed \|\| action\.locked\}/u],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#permission-StatePanel",
    [
      sourceFiles.cutover,
      /status === "PERMISSION"[\s\S]{0,140}?state="PERMISSION"/u,
    ],
  ],
  [
    "src/pages/teacher/SemesterCutoverCenterView.tsx#staging-read-only-action-lock",
    [sourceFiles.cutover, /disabled=\{!action\.allowed \|\| action\.locked\}/u],
  ],
  [
    "src/pages/student/Dashboard.tsx#learning-empty-StatePanel",
    [
      sourceFiles.studentDashboard,
      /upcomingLearning\.length === 0[\s\S]{0,120}?state="EMPTY"/u,
    ],
  ],
  [
    "src/pages/student/Dashboard.tsx#loading-StatePanel",
    [
      sourceFiles.studentDashboard,
      /if \(loading\) return <StatePanel state="LOADING" \/>/u,
    ],
  ],
  [
    "src/pages/student/Dashboard.tsx#error-StatePanel",
    [
      sourceFiles.studentDashboard,
      /if \(error && !state\)[\s\S]{0,200}?toW8StatePanelState\(error\)/u,
    ],
  ],
  [
    "src/pages/student/Dashboard.tsx#unavailable-learning-link",
    [
      sourceFiles.studentDashboard,
      /aria-disabled="true"[\s\S]{0,400}?현재 이용할 수 없습니다/u,
    ],
  ],
  [
    "src/pages/student/Dashboard.tsx#permission-aware-StatePanel",
    [sourceFiles.studentDashboard, /state=\{toW8StatePanelState\(error\)\}/u],
  ],
]);

for (const screen of acceptance.screens) {
  for (const state of screen.stateEvidence) {
    if (!state.reference.startsWith("src/")) continue;
    const contract = sourceAnchorContracts.get(state.reference);
    assert.ok(contract, `Unverified source anchor: ${state.reference}`);
    assert.match(
      contract[0],
      contract[1],
      `Source anchor drift: ${state.reference}`,
    );
  }
}
const teacherDisabledState = acceptance.screens
  .find((screen) => screen.id === "teacher-dashboard")
  .stateEvidence.find((state) => state.id === "disabled");
assert.equal(teacherDisabledState.method, "not-applicable-safe-absence");
assert.doesNotMatch(
  sourceFiles.teacherDashboard,
  /\bdisabled\b|aria-disabled/u,
);
assert.equal(
  acceptance.screens
    .find((screen) => screen.id === "teacher-cutover")
    .stateEvidence.find((state) => state.id === "permission").method,
  "source-and-access-gate",
);

const requiredAccessibilityChecks = new Set([
  "keyboard-navigation",
  "visible-focus",
  "heading-hierarchy",
  "form-labels",
  "icon-control-names",
  "touch-targets",
  "contrast",
  "zoom-200-reflow",
  "reduced-motion",
]);
assert.deepEqual(
  new Set(acceptance.accessibilityChecks.map((check) => check.id)),
  requiredAccessibilityChecks,
);
const expectedAccessibilityEvidence = new Map([
  [
    "keyboard-navigation",
    { method: "browser", reference: "browser-navigation-results.json" },
  ],
  [
    "visible-focus",
    {
      method: "browser-and-static",
      reference: "browser-navigation-results.json",
    },
  ],
  [
    "heading-hierarchy",
    {
      method: "source-contract",
      reference: "src/components/common/PageHeader.tsx#single-h1",
    },
  ],
  [
    "form-labels",
    {
      method: "source-contract",
      reference: "StudentList labels and QuizBank aria-label controls",
    },
  ],
  [
    "icon-control-names",
    {
      method: "source-contract",
      reference: "Header and NavigationDrawer icon control aria-labels",
    },
  ],
  [
    "touch-targets",
    {
      method: "source-gate",
      reference: "verify:w10-ui-quality#44px-minimum",
    },
  ],
  [
    "contrast",
    { method: "token-contrast-check", reference: "DESIGN.md#color-tokens" },
  ],
  [
    "zoom-200-reflow",
    {
      method: "screenshot-manifest-equivalent-reflow",
      reference: "all five screens at 768x1024, 390x844 and 320x800",
    },
  ],
  [
    "reduced-motion",
    {
      method: "source-gate",
      reference: "verify:w10-ui-quality#prefers-reduced-motion",
    },
  ],
]);
for (const check of acceptance.accessibilityChecks) {
  assert.equal(check.status, "PASS", check.id);
  assert.equal(
    check.method,
    expectedAccessibilityEvidence.get(check.id).method,
  );
  assert.equal(
    check.reference,
    expectedAccessibilityEvidence.get(check.id).reference,
  );
}

const keyboardScenario = browserNavigation.scenarios.find(
  (scenario) => scenario.id === "teacher.keyboard-dropdown-focus",
);
assert.ok(keyboardScenario);
assert.equal(keyboardScenario.status, "PASS");
assert.notEqual(keyboardScenario.focusTarget, "body");
assert.ok(
  browserNavigation.scenarios.every(
    (scenario) => scenario.focusTarget !== "body" && scenario.status === "PASS",
  ),
);
assert.match(sourceFiles.globalCss, /:focus-visible/u);
assert.match(sourceFiles.domainCss, /:focus-visible/u);

assert.equal((sourceFiles.pageHeader.match(/<h1\b/gu) || []).length, 1);
for (const source of [
  sourceFiles.teacherDashboard,
  sourceFiles.studentList,
  sourceFiles.manageQuiz,
  sourceFiles.quizBank,
  sourceFiles.cutover,
  sourceFiles.studentDashboard,
]) {
  assert.doesNotMatch(source, /<h1\b/u);
}
assert.match(
  sourceFiles.studentList,
  /<label className="student-roster__field/u,
);
assert.match(
  sourceFiles.studentList,
  /aria-label="현재 페이지 학생 전체 선택"/u,
);
for (const accessibleName of [
  "학급 선택",
  "대단원",
  "중단원",
  "소단원",
  "평가 유형",
  "문항 유형",
  "문항 검색",
]) {
  assert.ok(
    sourceFiles.quizBank.includes(`aria-label="${accessibleName}"`),
    `QuizBank is missing the ${accessibleName} accessible name.`,
  );
}
assert.match(sourceFiles.header, /aria-label=\{[\s\S]{0,100}?업무 메뉴 닫기/u);
assert.match(sourceFiles.header, /aria-label="로그아웃"/u);
assert.match(sourceFiles.navigationDrawer, /aria-label="메뉴 닫기"/u);
assert.match(sourceFiles.pageHeader, />\s*패치 메모\s*<\/button>/u);
assert.match(sourceFiles.globalCss, /--ws-control-height:\s*44px/u);
assert.match(sourceFiles.globalCss, /min-width:\s*44px/u);
assert.match(sourceFiles.globalCss, /min-height:\s*44px/u);
assert.match(sourceFiles.globalCss, /prefers-reduced-motion:\s*reduce/u);
assert.match(sourceFiles.domainCss, /prefers-reduced-motion:\s*reduce/u);
for (const screenId of expectedScreens.keys()) {
  for (const viewportWidth of [320, 390, 768]) {
    const screenshot = screenshotManifest.screenshots.find(
      (entry) =>
        entry.screenId === screenId && entry.viewport.width === viewportWidth,
    );
    assert.ok(
      screenshot,
      `${screenId} is missing ${viewportWidth}px reflow evidence.`,
    );
    assert.equal(screenshot.overflowX, 0);
    assert.equal(screenshot.status, "PASS");
  }
}
for (const check of acceptance.contrastChecks) {
  assert.match(check.foreground, /^#[a-f0-9]{6}$/u);
  assert.match(check.background, /^#[a-f0-9]{6}$/u);
  assert.ok(
    contrastRatio(check.foreground, check.background) >= check.minimumRatio,
    `${check.foreground} on ${check.background} misses ${check.minimumRatio}:1.`,
  );
}
assert.equal(acceptance.responsiveChecks.exactViewportScreenshots, 30);
assert.deepEqual(acceptance.responsiveChecks.viewports, [
  "320x800",
  "390x844",
  "768x1024",
  "1024x768",
  "1280x800",
  "1440x900",
]);
assert.equal(
  acceptance.responsiveChecks.additionalDesktopLayoutViewport,
  "1600x900",
);
assert.equal(acceptance.responsiveChecks.horizontalOverflowFailures, 0);
assert.equal(acceptance.responsiveChecks.clippedActionFailures, 0);
assert.equal(acceptance.responsiveChecks.fixedElementCollisionFailures, 0);

const comparisonPath = resolve(
  EVIDENCE_ROOT,
  "comparison/visual-comparison-results.json",
);
const comparison = readJson(comparisonPath);
assert.equal(comparison.schemaVersion, 1);
assert.equal(comparison.phase, "W10R");
assert.equal(comparison.status, "PASS");
assert.equal(comparison.screenId, "teacher-dashboard");
assert.equal(comparison.projectId, "westory-staging-177587430482");
assert.deepEqual(comparison.layoutViewport, {
  width: 1600,
  height: 900,
  dpr: 1,
});
assert.equal(comparison.productionAccess, 0);
assert.equal(comparison.productionWrites, 0);
const expectedComparisons = new Map([
  [
    "legacy-visual-baseline",
    {
      sha: "c735055608cdc06bd2b6324f92662f88149f6966",
      overflow: 0,
      loading: 0,
    },
  ],
  [
    "failed-w10",
    {
      sha: "925533fd1d1af5880ba246e58493d787c28bb352",
      overflow: 64,
      loading: 1,
    },
  ],
  ["recovered-w10r", { sha: SOURCE_SHA, overflow: 0, loading: 0 }],
]);
assert.equal(comparison.comparisons.length, expectedComparisons.size);
for (const entry of comparison.comparisons) {
  const expected = expectedComparisons.get(entry.stage);
  assert.ok(expected, entry.stage);
  assert.equal(entry.sourceCommitSha, expected.sha);
  assert.equal(entry.horizontalOverflow, expected.overflow);
  assert.equal(entry.loadingIndicatorCount, expected.loading);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(String(entry.observation || "").length >= 30);
  const imagePath = resolve(dirname(comparisonPath), entry.fileName);
  assert.equal(existsSync(imagePath), true, `Missing ${entry.fileName}.`);
  const jpeg = readFileSync(imagePath);
  assert.equal(sha256(jpeg), entry.sha256, `${entry.fileName} sha256 drift.`);
  assert.deepEqual(inspectJpeg(jpeg, entry.fileName), entry.actualPixelSize);
}

const cleanup = readJson(resolve(FIXTURE_ROOT, "cleanup-results.json"));
assert.equal(cleanup.suite, "w10-staging-fixture-cleanup");
assert.equal(cleanup.passed, true);
assert.equal(cleanup.projectId, "westory-staging-177587430482");
assert.equal(cleanup.testRunId, "w10-w10r-20260817a");
assert.equal(cleanup.deletedFixtureDocuments, 6);
assert.equal(cleanup.deletedAuthUsers, 2);
for (const field of [
  "residualAuthUsers",
  "residualFixtureDocuments",
  "residualSessions",
  "residualBusinessDocuments",
  "residualReceipts",
  "residualAudits",
  "residualTokens",
  "productionAccess",
  "productionWrites",
]) {
  assert.equal(cleanup[field], 0, `${field} must be zero.`);
}
for (const field of [
  "syntheticUsers",
  "syntheticBusinessDocuments",
  "commandReceipts",
  "audits",
  "sessions",
  "tokens",
  "storageFixtures",
  "emulatorProcesses",
  "occupiedRequiredPorts",
]) {
  assert.equal(
    cleanup.resourceInspection[field],
    0,
    `resourceInspection.${field} must be zero.`,
  );
}
assert.equal(cleanup.resourceInspection.appCheckDebugTokenPresent, false);
assert.equal(cleanup.resourceInspection.vercelBypassPresent, false);
assert.deepEqual(
  cleanup.resourceInspection.requiredPorts,
  [4400, 4500, 5001, 8080, 9099, 9150, 9199],
);

console.log(
  JSON.stringify({
    suite: "w10r-acceptance-evidence",
    passed: true,
    screens: expectedScreens.size,
    stateChecks: expectedScreens.size * requiredStates.size,
    accessibilityChecks: requiredAccessibilityChecks.size,
    comparisonStages: expectedComparisons.size,
    cleanupResiduals: 0,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
