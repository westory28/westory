import React, { Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import MainLayout from './components/layout/MainLayout';
const Login = lazy(() => import('./pages/Login'));
const StudentDashboard = lazy(() => import('./pages/student/Dashboard'));
const StudentNote = lazy(() => import('./pages/student/lesson/Note'));
const StudentMaps = lazy(() => import('./pages/student/lesson/Maps'));
const StudentThinkCloud = lazy(() => import('./pages/student/lesson/ThinkCloud'));
const StudentQuizIndex = lazy(() => import('./pages/student/quiz/QuizIndex'));
const QuizRunner = lazy(() => import('./pages/student/quiz/QuizRunner'));
const HistoryClassroomIndex = lazy(() => import('./pages/student/history-classroom/HistoryClassroomIndex'));
const HistoryClassroomRunner = lazy(() => import('./pages/student/history-classroom/HistoryClassroomRunner'));
const StudentScoreDashboard = lazy(() => import('./pages/student/score/ScoreDashboard'));
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'));
const StudentList = lazy(() => import('./pages/teacher/StudentList'));
const ManageQuiz = lazy(() => import('./pages/teacher/ManageQuiz'));
const ManageHistoryClassroom = lazy(() => import('./pages/teacher/ManageHistoryClassroom'));
const ManageExam = lazy(() => import('./pages/teacher/ManageExam'));
const Settings = lazy(() => import('./pages/teacher/Settings'));
const ManageSchedule = lazy(() => import('./pages/teacher/ManageSchedule'));
const ManageLesson = lazy(() => import('./pages/teacher/ManageLesson'));
const ManageMaps = lazy(() => import('./pages/teacher/ManageMaps'));
const ManageThinkCloud = lazy(() => import('./pages/teacher/ManageThinkCloud'));
const MyPage = lazy(() => import('./pages/student/MyPage'));
const StudentHistory = lazy(() => import('./pages/student/History'));
const Calendar = lazy(() => import('./pages/student/Calendar'));

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
                                <MainLayout>
                                    <StudentDashboard />
                                </MainLayout>
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
