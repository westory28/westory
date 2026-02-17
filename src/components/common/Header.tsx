import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MENUS } from '../../constants/menus';

const SESSION_DURATION_SECONDS = 60 * 60;
const SESSION_EXPIRY_KEY = 'sessionExpiry';
const ROLE_SESSION_KEY = 'westoryPortalRole';

const formatCountdown = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
};

const Header: React.FC = () => {
    const { currentUser, userData, config, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
    const [remainingSeconds, setRemainingSeconds] = useState(SESSION_DURATION_SECONDS);
    const timeoutHandledRef = useRef(false);

    const isReady = !!currentUser;
    const savedRole = sessionStorage.getItem(ROLE_SESSION_KEY) || localStorage.getItem(ROLE_SESSION_KEY);
    const sessionRole = savedRole === 'teacher' || savedRole === 'student' ? savedRole : null;
    const isTeacherUser = (sessionRole || userData?.role) === 'teacher';
    const displayName = (userData?.name || '').trim() || '이름 미설정';

    const portal: 'teacher' | 'student' = location.pathname.startsWith('/teacher')
        ? 'teacher'
        : location.pathname.startsWith('/student')
            ? 'student'
            : (isTeacherUser ? 'teacher' : 'student');

    const isTeacherPortal = portal === 'teacher';
    const menuItems = MENUS[portal] || [];
    const home = `/${portal}/dashboard`;
    const profileTarget = isTeacherPortal ? '/teacher/dashboard' : '/student/mypage';
    const profileLabel = `${displayName} ${isTeacherPortal ? '교사' : '학생'}`;

    const isActive = (url: string) => location.pathname.startsWith(url.split('?')[0]);

    const performLogout = async (isTimeout: boolean) => {
        try {
            localStorage.removeItem(SESSION_EXPIRY_KEY);
            sessionStorage.removeItem(ROLE_SESSION_KEY);
            localStorage.removeItem(ROLE_SESSION_KEY);
            if (isTimeout) {
                alert('세션이 만료되어 자동 로그아웃됩니다.');
            }
            await logout();
            navigate('/', { replace: true });
        } catch (error) {
            console.error('Logout failed', error);
        }
    };

    const handleLogout = async () => {
        await performLogout(false);
    };

    const extendSession = () => {
        const expiry = Date.now() + SESSION_DURATION_SECONDS * 1000;
        localStorage.setItem(SESSION_EXPIRY_KEY, String(expiry));
        setSessionExpiry(expiry);
        setRemainingSeconds(SESSION_DURATION_SECONDS);
        timeoutHandledRef.current = false;
    };

    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!currentUser) return;
        timeoutHandledRef.current = false;
        const now = Date.now();
        const saved = Number(localStorage.getItem(SESSION_EXPIRY_KEY));
        const nextExpiry = Number.isFinite(saved) && saved > now
            ? saved
            : now + SESSION_DURATION_SECONDS * 1000;
        localStorage.setItem(SESSION_EXPIRY_KEY, String(nextExpiry));
        setSessionExpiry(nextExpiry);
    }, [currentUser]);

    useEffect(() => {
        if (!sessionExpiry || !currentUser) return;

        const tick = () => {
            const diffMs = sessionExpiry - Date.now();
            if (diffMs <= 0) {
                setRemainingSeconds(0);
                if (!timeoutHandledRef.current) {
                    timeoutHandledRef.current = true;
                    void performLogout(true);
                }
                return;
            }
            setRemainingSeconds(Math.ceil(diffMs / 1000));
        };

        tick();
        const timerId = window.setInterval(tick, 1000);
        return () => window.clearInterval(timerId);
    }, [currentUser, sessionExpiry]);

    if (!isReady) return null;

    return (
        <header>
            <div className="header-container">
                <div className="flex items-center gap-4 h-full">
                    <Link to={home} className="logo-text">
                        <span className="logo-we">We</span>
                        <span className="logo-story">story</span>
                    </Link>

                    <nav className="desktop-nav ml-4">
                        {menuItems.map((item, idx) => {
                            const hasChildren = !!item.children?.length;
                            const active = isActive(item.url) || !!item.children?.some((child) => isActive(child.url));

                            if (!hasChildren) {
                                return (
                                    <Link key={`${item.url}-${idx}`} to={item.url} className={`nav-link ${active ? 'active' : ''}`}>
                                        {item.name}
                                    </Link>
                                );
                            }

                            return (
                                <div key={`${item.url}-${idx}`} className="relative group h-full flex items-center">
                                    <Link to={item.url} className={`nav-link ${active ? 'active' : ''} flex items-center gap-1`}>
                                        {item.name}
                                        <i className="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                                    </Link>
                                    <div className="absolute top-[calc(100%-8px)] left-0 w-[10.5rem] pt-0 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition duration-150 transform translate-y-0 z-[100]">
                                        <div className="bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
                                            {item.children?.map((child, childIdx) => (
                                                <Link
                                                    key={`${child.url}-${childIdx}`}
                                                    to={child.url}
                                                    className={`block px-2.5 py-3 text-[13px] border-b border-gray-50 last:border-0 whitespace-nowrap font-bold ${isActive(child.url) ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}`}
                                                >
                                                    {child.name}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </nav>
                </div>

                <div className="header-right">
                    {config && (
                        <span className="hidden lg:inline-block text-xs font-mono bg-gray-100 text-gray-500 px-2 py-1 rounded border border-gray-200">
                            {config.year}-{config.semester}
                        </span>
                    )}

                    <div className="hidden lg:flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200">
                        <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
                        <span className={`font-mono font-bold text-sm w-[42px] text-center ${remainingSeconds < 300 ? 'text-red-500' : 'text-stone-600'}`}>
                            {formatCountdown(remainingSeconds)}
                        </span>
                        <button onClick={extendSession} className="text-stone-400 hover:text-blue-600 transition p-1" title="시간 연장">
                            <i className="fas fa-redo-alt text-xs"></i>
                        </button>
                    </div>

                    {isTeacherPortal && (
                        <Link to="/teacher/settings" className="text-gray-400 hover:text-blue-600 transition" title="설정">
                            <i className="fas fa-cog fa-lg"></i>
                        </Link>
                    )}

                    {!isTeacherPortal && (
                        <Link to="/student/mypage" className="text-gray-500 hover:text-blue-600 transition p-1" title="마이페이지">
                            <i className="fas fa-user-circle text-lg"></i>
                        </Link>
                    )}

                    <Link to={profileTarget} className="user-greeting header-user-link inline-flex items-center hover:text-blue-600 transition" title={isTeacherPortal ? '관리자 페이지' : '마이페이지'}>
                        {profileLabel}
                    </Link>

                    <button onClick={handleLogout} className="btn-logout">
                        로그아웃
                    </button>

                    <button
                        onClick={() => setMobileMenuOpen((prev) => !prev)}
                        className="mobile-menu-btn"
                        aria-label="모바일 메뉴 열기"
                    >
                        <i className="fas fa-bars"></i>
                    </button>
                </div>
            </div>

            <div id="mobile-menu" className={mobileMenuOpen ? 'open' : ''}>
                {menuItems.map((item, idx) => (
                    <div key={`${item.url}-mobile-${idx}`}>
                        <Link
                            to={item.url}
                            className={`mobile-link ${isActive(item.url) ? 'active' : ''}`}
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {item.name}
                        </Link>
                        {!!item.children?.length && (
                            <div className="bg-gray-50 border-b border-gray-100 pb-1">
                                {item.children.map((child, childIdx) => (
                                    <Link
                                        key={`${child.url}-mobile-child-${childIdx}`}
                                        to={child.url}
                                        className={`block pl-12 pr-4 py-1.5 text-sm rounded-r-full mr-2 font-bold ${isActive(child.url) ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'}`}
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        <i className="fas fa-angle-right mr-2 text-xs opacity-50"></i>
                                        {child.name}
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </header>
    );
};

export default Header;
