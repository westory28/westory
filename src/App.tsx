import React, { Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import MainLayout from './components/layout/MainLayout';
const Login = lazy(() => import('./pages/Login'));
const StudentDashboard = lazy(() => import('./pages/student/Dashboard'));
const StudentNote = lazy(() => import('./pages/student/lesson/Note'));
const StudentQuizIndex = lazy(() => import('./pages/student/quiz/QuizIndex'));
const QuizRunner = lazy(() => import('./pages/student/quiz/QuizRunner'));
const StudentScoreDashboard = lazy(() => import('./pages/student/score/ScoreDashboard'));
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'));
const StudentList = lazy(() => import('./pages/teacher/StudentList'));
const ManageQuiz = lazy(() => import('./pages/teacher/ManageQuiz'));
const ManageExam = lazy(() => import('./pages/teacher/ManageExam'));
const Settings = lazy(() => import('./pages/teacher/Settings'));
const ManageSchedule = lazy(() => import('./pages/teacher/ManageSchedule'));
const ManageLesson = lazy(() => import('./pages/teacher/ManageLesson'));
const MyPage = lazy(() => import('./pages/student/MyPage'));
const StudentHistory = lazy(() => import('./pages/student/History'));
const Calendar = lazy(() => import('./pages/student/Calendar'));







const App: React.FC = () => {
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
                            <Route path="/student/quiz" element={
                                <MainLayout>
                                    <StudentQuizIndex />
                                </MainLayout>
                            } />
                            <Route path="/student/quiz/run" element={
                                <MainLayout>
                                    <QuizRunner />
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
