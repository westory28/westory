import React, { Suspense } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import MainLayout from "./components/layout/MainLayout";
import { AppToastProvider } from "./components/common/AppToastProvider";
import { InlineLoading, PageLoading } from "./components/common/LoadingState";
import { lazyWithRetry } from "./lib/lazyWithRetry";

const Login = lazyWithRetry(() => import("./pages/Login"), "login");

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
const ManageSchedule = lazyWithRetry(
  () => import("./pages/teacher/ManageSchedule"),
  "manage-schedule",
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

const getBootRedirectHash = () => {
  if (typeof window === "undefined") return "";
  if (window.location.hash) return "";

  const normalizedPath = window.location.pathname.replace(/\/+$/, "");
  const routeMatch = normalizedPath.match(/\/(student|teacher)(?:\/.*)?$/);
  if (!routeMatch) return "";

  const routePath = normalizedPath.slice(routeMatch.index || 0);
  if (!routePath || routePath === "/") return "";
  return `#${routePath}${window.location.search}`;
};

const LegacyRouteRedirect: React.FC<{ to: string }> = ({ to }) => {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
};

const RouteContentFallback: React.FC<{ message: string }> = ({ message }) => (
  <div className="mx-auto w-full max-w-7xl px-4 py-6">
    <InlineLoading message={message} />
  </div>
);

const renderWithLayout = (children: React.ReactNode, message: string) => (
  <MainLayout>
    <Suspense fallback={<RouteContentFallback message={message} />}>
      {children}
    </Suspense>
  </MainLayout>
);

const App: React.FC = () => {
  const bootRedirectHash = getBootRedirectHash();
  if (bootRedirectHash) {
    window.location.replace(
      `${window.location.origin}${window.location.pathname}${window.location.search}${bootRedirectHash}`,
    );
    return null;
  }

  return (
    <AuthProvider>
      <AppToastProvider>
        <Router>
          <Suspense
            fallback={<PageLoading message="화면을 준비하는 중입니다." />}
          >
            <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">
              <Routes>
                <Route path="/" element={<Login />} />
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
                  path="/teacher/schedule"
                  element={renderWithLayout(
                    <ManageSchedule />,
                    "일정 관리 화면을 준비하는 중입니다.",
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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Suspense>
        </Router>
      </AppToastProvider>
    </AuthProvider>
  );
};

export default App;
