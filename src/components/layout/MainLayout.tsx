import React, { useEffect } from 'react';
import Header from '../common/Header';
import Footer from '../common/Footer';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';

const TEACHER_EMAIL = 'westoria28@gmail.com';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser, userData, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!loading && !currentUser) {
            navigate('/');
            return;
        }

        if (!loading && currentUser) {
            const inferredRole = userData?.role || (currentUser.email === TEACHER_EMAIL ? 'teacher' : 'student');
            if (location.pathname.startsWith('/teacher') && inferredRole !== 'teacher') {
                navigate('/student/dashboard', { replace: true });
            } else if (location.pathname.startsWith('/student') && inferredRole === 'teacher') {
                navigate('/teacher/dashboard', { replace: true });
            }
        }
    }, [currentUser, userData, loading, location.pathname, navigate]);

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            <Header />
            <main className="flex-1 w-full">
                {children}
            </main>
            <Footer />
        </div>
    );
};

export default MainLayout;
