import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import StudentDashboard from './pages/student/Dashboard';
import TeacherDashboard from './pages/teacher/Dashboard';

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
                        <Route path="/teacher/dashboard" element={
                            <MainLayout>
                                <TeacherDashboard />
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
