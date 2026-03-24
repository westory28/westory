import React, { Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import MainLayout from './components/layout/MainLayout';
import { lazyWithRetry } from './lib/lazyWithRetry';
import Login from './pages/Login';

const StudentDashboard = lazyWithRetry(() => import('./pages/student/Dashboard'), 'student-dashboard');
const StudentNote = lazyWithRetry(() => import('./pages/student/lesson/Note'), 'student-note');
const StudentMaps = lazyWithRetry(() => import('./pages/student/lesson/Maps'), 'student-maps');
const StudentThinkCloud = lazyWithRetry(() => import('./pages/student/lesson/ThinkCloud'), 'student-think-cloud');
const StudentQuizIndex = lazyWithRetry(() => import('./pages/student/quiz/QuizIndex'), 'student-quiz-index');
const QuizRunner = lazyWithRetry(() => import('./pages/student/quiz/QuizRunner'), 'quiz-runner');
const HistoryClassroomIndex = lazyWithRetry(() => import('./pages/student/history-classroom/HistoryClassroomIndex'), 'history-classroom-index');
const HistoryClassroomRunner = lazyWithRetry(() => import('./pages/student/history-classroom/HistoryClassroomRunner'), 'history-classroom-runner');
const StudentScoreDashboard = lazyWithRetry(() => import('./pages/student/score/ScoreDashboard'), 'student-score-dashboard');
const TeacherDashboard = lazyWithRetry(() => import('./pages/teacher/Dashboard'), 'teacher-dashboard');
const StudentList = lazyWithRetry(() => import('./pages/teacher/StudentList'), 'student-list');
const ManageQuiz = lazyWithRetry(() => import('./pages/teacher/ManageQuiz'), 'manage-quiz');
const ManageHistoryClassroom = lazyWithRetry(() => import('./pages/teacher/ManageHistoryClassroom'), 'manage-history-classroom');
const ManageExam = lazyWithRetry(() => import('./pages/teacher/ManageExam'), 'manage-exam');
const Settings = lazyWithRetry(() => import('./pages/teacher/Settings'), 'settings');
const ManageSchedule = lazyWithRetry(() => import('./pages/teacher/ManageSchedule'), 'manage-schedule');
const ManageLesson = lazyWithRetry(() => import('./pages/teacher/ManageLesson'), 'manage-lesson');
const ManageMaps = lazyWithRetry(() => import('./pages/teacher/ManageMaps'), 'manage-maps');
const ManageSourceArchive = lazyWithRetry(() => import('./pages/teacher/ManageSourceArchive'), 'manage-source-archive');
const ManageThinkCloud = lazyWithRetry(() => import('./pages/teacher/ManageThinkCloud'), 'manage-think-cloud');
const MyPage = lazyWithRetry(() => import('./pages/student/MyPage'), 'my-page');
const StudentHistory = lazyWithRetry(() => import('./pages/student/History'), 'student-history');
const Calendar = lazyWithRetry(() => import('./pages/student/Calendar'), 'student-calendar');
const ManagePoints = lazyWithRetry(() => import('./pages/teacher/ManagePoints'), 'manage-points');
const StudentPoints = lazyWithRetry(() => import('./pages/student/Points'), 'student-points');

const getBootRedirectHash = () => {
    if (typeof window === 'undefined') return '';
    if (window.location.hash) return '';

    const normalizedPath = window.location.pathname.replace(/\/+$/, '');
    const routeMatch = normalizedPath.match(/\/(student|teacher)(?:\/.*)?$/);
    if (!routeMatch) return '';

    const routePath = normalizedPath.slice(routeMatch.index || 0);
    if (!routePath || routePath === '/') return '';
    return `#${routePath}${window.location.search}`;
};

const LegacyRouteRedirect: React.FC<{ to: string }> = ({ to }) => {
    const location = useLocation();
    return <Navigate to={`${to}${location.search}`} replace />;
};

const RouteContentFallback: React.FC<{ message: string }> = ({ message }) => (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-sm font-semibold text-gray-500 shadow-sm">
            {message}
        </div>
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
        window.location.replace(`${window.location.origin}${window.location.pathname}${window.location.search}${bootRedirectHash}`);
        return null;
    }

    return (
        <AuthProvider>
            <Router>
                <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
                    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans">
                        <Routes>
                            <Route path="/" element={<Login />} />
                            <Route path="/student/dashboard" element={
                                renderWithLayout(<StudentDashboard />, '학생 첫 화면을 준비하는 중입니다.')
                            } />
                            <Route path="/student/lesson/note" element={
                                <MainLayout>
                                    <StudentNote />
                                </MainLayout>
                            } />
                            <Route path="/student/lesson/maps" element={
                                <MainLayout>
                                    <StudentMaps />
                                </MainLayout>
                            } />
                            <Route path="/student/lesson/think-cloud" element={
                                <MainLayout>
                                    <StudentThinkCloud />
                                </MainLayout>
                            } />
                            <Route path="/student/quiz" element={
                                <MainLayout>
                                    <StudentQuizIndex />
                                </MainLayout>
                            } />
                            <Route path="/student/quiz/history2" element={
                                <LegacyRouteRedirect to="/student/quiz" />
                            } />
                            <Route path="/student/quiz/history2/*" element={
                                <LegacyRouteRedirect to="/student/quiz" />
                            } />
                            <Route path="/student/quiz/run" element={
                                <MainLayout>
                                    <QuizRunner />
                                </MainLayout>
                            } />
                            <Route path="/student/history-classroom" element={
                                <MainLayout>
                                    <HistoryClassroomIndex />
                                </MainLayout>
                            } />
                            <Route path="/student/history-classroom/run" element={
                                <MainLayout>
                                    <HistoryClassroomRunner />
                                </MainLayout>
                            } />
                            <Route path="/student/score" element={
                                <MainLayout>
                                    <StudentScoreDashboard />
                                </MainLayout>
                            } />
                            <Route path="/teacher/dashboard" element={
                                <MainLayout>
                                    <TeacherDashboard />
                                </MainLayout>
                            } />
                            <Route path="/teacher/students" element={
                                <MainLayout>
                                    <StudentList />
                                </MainLayout>
                            } />
                            <Route path="/teacher/quiz" element={
                                <MainLayout>
                                    <ManageQuiz />
                                </MainLayout>
                            } />
                            <Route path="/teacher/quiz/history2" element={
                                <LegacyRouteRedirect to="/teacher/quiz" />
                            } />
                            <Route path="/teacher/quiz/history2/*" element={
                                <LegacyRouteRedirect to="/teacher/quiz" />
                            } />
                            <Route path="/teacher/quiz/history-classroom" element={
                                <MainLayout>
                                    <ManageHistoryClassroom />
                                </MainLayout>
                            } />
                            <Route path="/teacher/exam" element={
                                <MainLayout>
                                    <ManageExam />
                                </MainLayout>
                            } />
                            <Route path="/teacher/settings" element={
                                <MainLayout>
                                    <Settings />
                                </MainLayout>
                            } />
                            <Route path="/teacher/points" element={
                                <MainLayout>
                                    <ManagePoints />
                                </MainLayout>
                            } />
                            <Route path="/teacher/schedule" element={
                                <MainLayout>
                                    <ManageSchedule />
                                </MainLayout>
                            } />
                            <Route path="/teacher/lesson" element={
                                <MainLayout>
                                    <ManageLesson />
                                </MainLayout>
                            } />
                            <Route path="/teacher/lesson/maps" element={
                                <MainLayout>
                                    <ManageMaps />
                                </MainLayout>
                            } />
                            <Route path="/teacher/lesson/source-archive" element={
                                <MainLayout>
                                    <ManageSourceArchive />
                                </MainLayout>
                            } />
                            <Route path="/teacher/lesson/think-cloud" element={
                                <MainLayout>
                                    <ManageThinkCloud />
                                </MainLayout>
                            } />
                            <Route path="/student/mypage" element={
                                <MainLayout>
                                    <MyPage />
                                </MainLayout>
                            } />
                            <Route path="/student/history" element={
                                <MainLayout>
                                    <StudentHistory />
                                </MainLayout>
                            } />
                            <Route path="/student/points" element={
                                <MainLayout>
                                    <StudentPoints />
                                </MainLayout>
                            } />
                            <Route path="/student/calendar" element={
                                <MainLayout>
                                    <Calendar />
                                </MainLayout>
                            } />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </div>
                </Suspense>
            </Router>
        </AuthProvider>
    );
};

export default App;
