import { TeacherSemesterProvider } from "./contexts/TeacherSemesterContext";
import React, { Suspense } from "react";
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import MainLayout from "./components/layout/MainLayout";
import { AppToastProvider } from "./components/common/AppToastProvider";
import { AppDialogProvider } from "./components/common/AppDialogProvider";
import { StepUpReauthProvider } from "./components/auth/StepUpReauthProvider";
import ProtectedAccessGate from "./components/auth/ProtectedAccessGate";
import StudentMaintenanceGate from "./components/auth/StudentMaintenanceGate";
import StatePanel from "./components/common/StatePanel";
import { PageDataLoading } from "./components/common/LoadingState";
import { lazyWithRetry } from "./lib/lazyWithRetry";

const Login = lazyWithRetry(() => import("./pages/Login"), "login");
const Maintenance = lazyWithRetry(
  () => import("./pages/student/Maintenance"),
  "student-maintenance",
);

const StudentDashboard = lazyWithRetry(
  () => import("./pages/student/Dashboard"),
  "student-dashboard",
);
const StudentNote = lazyWithRetry(
  () => import("./pages/student/lesson/Note"),
  "student-note",
);
const StudentHistoryDictionary = lazyWithRetry(
  () => import("./pages/student/lesson/HistoryDictionary"),
  "student-history-dictionary",
);
const StudentMaps = lazyWithRetry(
  () => import("./pages/student/lesson/Maps"),
  "student-maps",
);
const StudentThinkCloud = lazyWithRetry(
  () => import("./pages/student/lesson/ThinkCloud"),
  "student-think-cloud",
);
const StudentQuizIndex = lazyWithRetry(
  () => import("./pages/student/quiz/QuizIndex"),
  "student-quiz-index",
);
const QuizRunner = lazyWithRetry(
  () => import("./pages/student/quiz/QuizRunner"),
  "quiz-runner",
);
const HistoryClassroomIndex = lazyWithRetry(
  () => import("./pages/student/history-classroom/HistoryClassroomIndex"),
  "history-classroom-index",
);
const HistoryClassroomRunner = lazyWithRetry(
  () => import("./pages/student/history-classroom/HistoryClassroomRunner"),
  "history-classroom-runner",
);
const StudentScoreDashboard = lazyWithRetry(
  () => import("./pages/student/score/ScoreDashboard"),
  "student-score-dashboard",
);
const StudentScoreReport = lazyWithRetry(
  () => import("./pages/student/score/ScoreReport"),
  "student-score-report",
);
const StudentPerformanceScoreView = lazyWithRetry(
  () => import("./pages/student/score/PerformanceScoreView"),
  "student-performance-score-view",
);
const StudentWrittenExamEssayScoreView = lazyWithRetry(
  () => import("./pages/student/score/WrittenExamEssayScoreView"),
  "student-written-exam-essay-score-view",
);
const TeacherDashboard = lazyWithRetry(
  () => import("./pages/teacher/Dashboard"),
  "teacher-dashboard",
);
const StudentList = lazyWithRetry(
  () => import("./pages/teacher/StudentList"),
  "student-list",
);
const ManageQuiz = lazyWithRetry(
  () => import("./pages/teacher/ManageQuiz"),
  "manage-quiz",
);
const ManageHistoryClassroom = lazyWithRetry(
  () => import("./pages/teacher/ManageHistoryClassroom"),
  "manage-history-classroom",
);
const ManageExam = lazyWithRetry(
  () => import("./pages/teacher/ManageExam"),
  "manage-exam",
);
const Settings = lazyWithRetry(
  () => import("./pages/teacher/Settings"),
  "settings",
);
const SemesterCutoverCenter = lazyWithRetry(
  () => import("./pages/teacher/SemesterCutoverCenter"),
  "semester-cutover-center",
);
const ManageLesson = lazyWithRetry(
  () => import("./pages/teacher/ManageLesson"),
  "manage-lesson",
);
const ManageHistoryDictionary = lazyWithRetry(
  () => import("./pages/teacher/ManageHistoryDictionary"),
  "manage-history-dictionary",
);
const ManageMaps = lazyWithRetry(
  () => import("./pages/teacher/ManageMaps"),
  "manage-maps",
);
const ManageSourceArchive = lazyWithRetry(
  () => import("./pages/teacher/ManageSourceArchive"),
  "manage-source-archive",
);
const ManageThinkCloud = lazyWithRetry(
  () => import("./pages/teacher/ManageThinkCloud"),
  "manage-think-cloud",
);
const MyPage = lazyWithRetry(() => import("./pages/student/MyPage"), "my-page");
const StudentArchiveOverview = lazyWithRetry(
  () => import("./pages/student/StudentArchiveOverview"),
  "student-archive-overview",
);
const StudentHistory = lazyWithRetry(
  () => import("./pages/student/History"),
  "student-history",
);
const Calendar = lazyWithRetry(
  () => import("./pages/student/Calendar"),
  "student-calendar",
);
const ManagePoints = lazyWithRetry(
  () => import("./pages/teacher/ManagePoints"),
  "manage-points",
);
const StudentPoints = lazyWithRetry(
  () => import("./pages/student/Points"),
  "student-points",
);
const DeveloperLog = lazyWithRetry(
  () => import("./pages/DeveloperLog"),
  "developer-log",
);

// Only the requested screen is prepared during authentication. Data reads still
// start behind the maintenance, session, role and semester gates below.
const initialRouteCode: Record<string, () => Promise<unknown>> = {
  "/": Login.preload,
  "/maintenance": Maintenance.preload,
  "/student/dashboard": StudentDashboard.preload,
  "/student/lesson/note": StudentNote.preload,
  "/student/lesson/history-dictionary": StudentHistoryDictionary.preload,
  "/student/lesson/maps": StudentMaps.preload,
  "/student/lesson/think-cloud": StudentThinkCloud.preload,
  "/student/quiz": StudentQuizIndex.preload,
  "/student/quiz/run": QuizRunner.preload,
  "/student/history-classroom": HistoryClassroomIndex.preload,
  "/student/history-classroom/run": HistoryClassroomRunner.preload,
  "/student/score": StudentScoreDashboard.preload,
  "/student/score/report": StudentScoreReport.preload,
  "/student/score/performance": StudentPerformanceScoreView.preload,
  "/student/score/written-exam": StudentWrittenExamEssayScoreView.preload,
  "/student/mypage": MyPage.preload,
  "/student/mypage/archive": StudentArchiveOverview.preload,
  "/student/history": StudentHistory.preload,
  "/student/points": StudentPoints.preload,
  "/student/calendar": Calendar.preload,
  "/teacher/dashboard": TeacherDashboard.preload,
  "/teacher/students": StudentList.preload,
  "/teacher/quiz": ManageQuiz.preload,
  "/teacher/quiz/history-classroom": ManageHistoryClassroom.preload,
  "/teacher/exam": ManageExam.preload,
  "/teacher/settings": Settings.preload,
  "/teacher/settings/cutover": () =>
    Promise.all([Settings.preload(), SemesterCutoverCenter.preload()]),
  "/teacher/points": ManagePoints.preload,
  "/teacher/lesson": ManageLesson.preload,
  "/teacher/lesson/history-dictionary": ManageHistoryDictionary.preload,
  "/teacher/lesson/maps": ManageMaps.preload,
  "/teacher/lesson/source-archive": ManageSourceArchive.preload,
  "/teacher/lesson/think-cloud": ManageThinkCloud.preload,
  "/developer-log": DeveloperLog.preload,
};

export const preloadInitialRouteCode = (hash: string) => {
  const pathname = hash.replace(/^#/, "").split("?")[0] || "/";
  const load = Object.prototype.hasOwnProperty.call(initialRouteCode, pathname)
    ? initialRouteCode[pathname]
    : pathname.startsWith("/developer-log/")
      ? DeveloperLog.preload
      : undefined;
  void load?.().catch(() => undefined);
};

const LegacyRouteRedirect: React.FC<{ to: string }> = ({ to }) => {
  const location = useLocation();
  const [pathname, query = ""] = to.split("?");
  const params = new URLSearchParams(query);
  const existing = new URLSearchParams(location.search);
  existing.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  const search = params.toString();
  return <Navigate to={`${pathname}${search ? `?${search}` : ""}`} replace />;
};

const RouteContentFallback: React.FC<{ message?: string }> = () => (
  <PageDataLoading />
);

const renderWithLayout = (children: React.ReactNode, message?: string) => (
  <ProtectedAccessGate>
    <AppDialogProvider>
      <MainLayout>
        <Suspense fallback={<RouteContentFallback message={message} />}>
          {children}
        </Suspense>
      </MainLayout>
    </AppDialogProvider>
  </ProtectedAccessGate>
);

const NotFound: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <main className="ws-access-state">
      <StatePanel
        state="EMPTY"
        title="요청한 화면을 찾지 못했습니다."
        description={`주소(${location.pathname})가 바뀌었거나 더 이상 제공하지 않는 화면입니다.`}
        action={{
          label: "첫 화면으로 이동",
          onClick: () => navigate("/", { replace: true }),
        }}
      />
    </main>
  );
};

const Router: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <HashRouter>
    <TeacherSemesterProvider>{children}</TeacherSemesterProvider>
  </HashRouter>
);

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <StepUpReauthProvider>
          <StudentMaintenanceGate>
            <AppToastProvider>
              <Suspense fallback={<RouteContentFallback />}>
                <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">
                  <Routes>
                    <Route path="/" element={<Login />} />
                    <Route path="/maintenance" element={<Maintenance />} />
                    <Route
                      path="/student/dashboard"
                      element={renderWithLayout(
                        <StudentDashboard />,
                        "학생 첫 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/lesson/note"
                      element={renderWithLayout(
                        <StudentNote />,
                        "수업 자료를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/lesson/history-dictionary"
                      element={renderWithLayout(
                        <StudentHistoryDictionary />,
                        "역사 사전을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/lesson/maps"
                      element={renderWithLayout(
                        <StudentMaps />,
                        "역사 지도를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/lesson/think-cloud"
                      element={renderWithLayout(
                        <StudentThinkCloud />,
                        "생각 구름을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/quiz"
                      element={renderWithLayout(
                        <StudentQuizIndex />,
                        "퀴즈 목록을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/quiz/history2"
                      element={<LegacyRouteRedirect to="/student/quiz" />}
                    />
                    <Route
                      path="/student/quiz/history2/*"
                      element={<LegacyRouteRedirect to="/student/quiz" />}
                    />
                    <Route
                      path="/student/quiz/run"
                      element={renderWithLayout(
                        <QuizRunner />,
                        "퀴즈를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/history-classroom"
                      element={renderWithLayout(
                        <HistoryClassroomIndex />,
                        "역사교실을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/history-classroom/run"
                      element={renderWithLayout(
                        <HistoryClassroomRunner />,
                        "역사교실 과제를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/score"
                      element={renderWithLayout(
                        <StudentScoreDashboard />,
                        "성적 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/score/report"
                      element={renderWithLayout(
                        <StudentScoreReport />,
                        "성적표를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/score/performance"
                      element={renderWithLayout(
                        <StudentPerformanceScoreView />,
                        "수행평가 점수를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/score/written-exam"
                      element={renderWithLayout(
                        <StudentWrittenExamEssayScoreView />,
                        "정기시험 점수를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/dashboard"
                      element={renderWithLayout(
                        <TeacherDashboard />,
                        "교사 첫 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/students"
                      element={renderWithLayout(
                        <StudentList />,
                        "학생 명부를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/quiz"
                      element={renderWithLayout(
                        <ManageQuiz />,
                        "퀴즈 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/quiz/history2"
                      element={<LegacyRouteRedirect to="/teacher/quiz" />}
                    />
                    <Route
                      path="/teacher/quiz/history2/*"
                      element={<LegacyRouteRedirect to="/teacher/quiz" />}
                    />
                    <Route
                      path="/teacher/quiz/history-classroom"
                      element={renderWithLayout(
                        <ManageHistoryClassroom />,
                        "역사교실 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/exam"
                      element={renderWithLayout(
                        <ManageExam />,
                        "평가 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/settings/cutover"
                      element={renderWithLayout(
                        <Settings>
                          <SemesterCutoverCenter />
                        </Settings>,
                        "학기 전환 준비 상태를 불러오는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/settings"
                      element={renderWithLayout(
                        <Settings />,
                        "설정 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/points"
                      element={renderWithLayout(
                        <ManagePoints />,
                        "위스 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/lesson"
                      element={renderWithLayout(
                        <ManageLesson />,
                        "수업자료 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/lesson/history-dictionary"
                      element={renderWithLayout(
                        <ManageHistoryDictionary />,
                        "역사 사전 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/lesson/maps"
                      element={renderWithLayout(
                        <ManageMaps />,
                        "역사 지도 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/lesson/source-archive"
                      element={renderWithLayout(
                        <ManageSourceArchive />,
                        "사료 보관함을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/teacher/lesson/think-cloud"
                      element={renderWithLayout(
                        <ManageThinkCloud />,
                        "생각 구름 관리 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/mypage"
                      element={renderWithLayout(
                        <MyPage />,
                        "마이페이지를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/mypage/archive"
                      element={renderWithLayout(
                        <StudentArchiveOverview />,
                        "지난 학기 안내를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/history"
                      element={renderWithLayout(
                        <StudentHistory />,
                        "학습 기록을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/points"
                      element={renderWithLayout(
                        <StudentPoints />,
                        "위스 화면을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/student/calendar"
                      element={renderWithLayout(
                        <Calendar />,
                        "일정을 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/developer-log"
                      element={renderWithLayout(
                        <DeveloperLog />,
                        "개발자 일지를 준비하는 중입니다.",
                      )}
                    />
                    <Route
                      path="/developer-log/:postId"
                      element={renderWithLayout(
                        <DeveloperLog />,
                        "개발자 일지를 준비하는 중입니다.",
                      )}
                    />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </div>
              </Suspense>
            </AppToastProvider>
          </StudentMaintenanceGate>
        </StepUpReauthProvider>
      </Router>
    </AuthProvider>
  );
};

export default App;
