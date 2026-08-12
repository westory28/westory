import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const analysis = analyzeClientBoundary({ rootDir: process.cwd() });
assert.deepEqual(analysis.forbidden, []);
assert.deepEqual(analysis.unknown, []);

const integrationFiles = new Set([
  "src/App.tsx",
  "src/constants/routeMetadata.ts",
  "src/components/shell/AppShell.tsx",
  "src/components/layout/MainLayout.tsx",
  "src/components/common/AppDialogProvider.tsx",
  "src/components/common/Footer.tsx",
  "src/components/common/FormField.tsx",
  "src/components/common/ModalSurface.tsx",
  "src/components/common/PageHeader.tsx",
  "src/components/common/PublicServiceLinks.tsx",
  "src/components/common/ResponsiveDataContainer.tsx",
  "src/components/common/StatePanel.tsx",
  "src/components/common/WestoryBrand.tsx",
  "src/components/auth/ProtectedAccessBoundary.tsx",
  "src/components/auth/StudentMaintenanceGate.tsx",
]);
const presentationFiles = new Set([
  "assets/css/style.css",
  "src/components/common/Footer.tsx",
  "src/components/common/FormField.tsx",
  "src/components/common/Header.tsx",
  "src/components/common/ModalSurface.tsx",
  "src/components/common/PageHeader.tsx",
  "src/components/common/PublicServiceLinks.tsx",
  "src/components/common/ResponsiveDataContainer.tsx",
  "src/components/common/StatePanel.tsx",
  "src/components/common/WestoryBrand.tsx",
  "src/pages/Login.tsx",
  "src/pages/student/Calendar.tsx",
  "src/pages/student/Dashboard.tsx",
  "src/pages/student/History.tsx",
  "src/pages/student/Maintenance.tsx",
  "src/pages/student/MyPage.tsx",
  "src/pages/student/StudentArchiveOverview.tsx",
  "src/pages/student/W8StudentHub.tsx",
  "src/pages/student/WisEconomyStudentView.tsx",
  "src/pages/student/history-classroom/HistoryClassroomIndex.tsx",
  "src/pages/student/lesson/Maps.tsx",
  "src/pages/student/lesson/ThinkCloud.tsx",
  "src/pages/student/lesson/components/LessonContent.tsx",
  "src/pages/student/score/PerformanceScoreView.tsx",
  "src/pages/student/score/ScoreReport.tsx",
  "src/pages/teacher/Dashboard.tsx",
  "src/pages/teacher/ManageHistoryClassroom.tsx",
  "src/pages/teacher/ManageHistoryDictionary.tsx",
  "src/pages/teacher/ManageLesson.tsx",
  "src/pages/teacher/ManageMaps.tsx",
  "src/pages/teacher/ManageSchedule.tsx",
  "src/pages/teacher/ManageSourceArchive.tsx",
  "src/pages/teacher/ManageThinkCloud.tsx",
  "src/pages/teacher/Settings.tsx",
  "src/pages/teacher/StudentList.tsx",
  "src/pages/teacher/W8TeacherHub.tsx",
  "src/pages/teacher/WisEconomyManager.tsx",
  "src/pages/teacher/components/TeacherLessonPresentation.tsx",
  "src/pages/w8Domains.css",
  "src/pages/wisEconomy.css",
]);
for (const path of presentationFiles) {
  assert.equal(
    existsSync(resolve(path)),
    true,
    `W10 presentation source is missing: ${path}`,
  );
}
const integrationMutations = analysis.observations.filter(
  (item) =>
    integrationFiles.has(item.file) &&
    !["QUERY_CALLABLE", "AUTH"].includes(item.boundary),
);
assert.deepEqual(
  integrationMutations,
  [],
  "W10 shell, route, state, and dialog integration must remain mutation-free.",
);

for (const path of integrationFiles) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|uploadString|deleteObject)\s*\(/u,
    `${path} contains a direct persistent mutation.`,
  );
}

const app = read("src/App.tsx");
assert.match(app, /<StudentMaintenanceGate>[\s\S]*?<StepUpReauthProvider>/u);
assert.match(
  app,
  /<ProtectedAccessGate>[\s\S]*?<AppDialogProvider>[\s\S]*?<MainLayout>/u,
);

console.log(
  JSON.stringify({
    suite: "w10-query-purity",
    passed: true,
    integrationFiles: integrationFiles.size,
    presentationFiles: presentationFiles.size,
    integrationDirectWrites: 0,
    integrationImplicitWrites: 0,
    unknown: analysis.unknown.length,
    previousBoundaryGroups: analysis.observations.length,
    productionAccess: 0,
  }),
);
