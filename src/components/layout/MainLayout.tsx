import React, { useEffect } from 'react';
import Header from '../common/Header';
import Footer from '../common/Footer';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { readStorage } from '../../lib/safeStorage';
import { canAccessTeacherPath, canAccessTeacherPortal, getDefaultTeacherRoute } from '../../lib/permissions';

const ROLE_SESSION_KEY = 'westoryPortalRole';

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
            const savedRole = readStorage(ROLE_SESSION_KEY);
            const sessionRole = savedRole === 'teacher' || savedRole === 'student' ? savedRole : null;
            const canUseTeacherPortal = canAccessTeacherPortal(userData, currentUser.email);
            if (location.pathname.startsWith('/teacher')) {
                if (!canUseTeacherPortal) {
                    navigate('/student/dashboard', { replace: true });
                    return;
                }

                if (!canAccessTeacherPath(location.pathname, userData, currentUser.email)) {
                    navigate(getDefaultTeacherRoute(userData, currentUser.email), { replace: true });
                }
            } else if (location.pathname.startsWith('/student') && sessionRole === 'teacher' && canUseTeacherPortal) {
                navigate(getDefaultTeacherRoute(userData, currentUser.email), { replace: true });
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
