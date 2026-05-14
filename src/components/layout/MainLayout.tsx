import React, { useEffect } from 'react';
import { inferToastFromAlertMessage, useAppToast } from '../common/AppToastProvider';
import Header from '../common/Header';
import Footer from '../common/Footer';
import { PageLoading } from '../common/LoadingState';
import StudentHistoryDictionaryController from '../common/StudentHistoryDictionaryController';
import StudentRankPromotionController from '../common/StudentRankPromotionController';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { markLoginPerf, measureLoginPerf } from '../../lib/loginPerf';
import { readStorage } from '../../lib/safeStorage';
import { canAccessTeacherPath, canAccessTeacherPortal, getDefaultTeacherRoute } from '../../lib/permissions';

const ROLE_SESSION_KEY = 'westoryPortalRole';

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser, userData, loading } = useAuth();
    const { showToast } = useAppToast();
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

    useEffect(() => {
        if (loading || !currentUser) return;

        markLoginPerf('westory-main-layout-ready', {
            pathname: location.pathname,
        });
        measureLoginPerf(
            'westory-route-ready',
            'westory-login-first-route-decided',
            'westory-main-layout-ready',
        );
    }, [currentUser, loading, location.pathname]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const originalAlert = window.alert.bind(window);
        window.alert = (message?: unknown) => {
            const nextToast = inferToastFromAlertMessage(message);
            if (!nextToast) return;
            showToast(nextToast);
        };

        return () => {
            window.alert = originalAlert;
        };
    }, [showToast]);

    if (loading) return <PageLoading message="로그인 상태를 확인하는 중입니다." />;

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            <Header />
            <StudentRankPromotionController />
            <StudentHistoryDictionaryController />
            <main className="flex-1 w-full min-h-0">
                {children}
            </main>
            <Footer />
        </div>
    );
};

export default MainLayout;
