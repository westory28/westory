import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import StudentDashboard from './pages/student/Dashboard';
import StudentNote from './pages/student/lesson/Note';
import StudentQuizIndex from './pages/student/quiz/QuizIndex';
import QuizRunner from './pages/student/quiz/QuizRunner';
import StudentScoreDashboard from './pages/student/score/ScoreDashboard';
import TeacherDashboard from './pages/teacher/Dashboard';
import StudentList from './pages/teacher/StudentList';
import ManageQuiz from './pages/teacher/ManageQuiz';
import ManageExam from './pages/teacher/ManageExam';
import Settings from './pages/teacher/Settings';
import ManageSchedule from './pages/teacher/ManageSchedule';
import ManageLesson from './pages/teacher/ManageLesson';
import MyPage from './pages/student/MyPage';
import StudentHistory from './pages/student/History';
import Calendar from './pages/student/Calendar';







const App: React.FC = () => {
    return (
        <AuthProvider>
            <Router>
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

                        {/* Student Pages */}
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
                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </Router>
        </AuthProvider>
    );
};

export default App;
