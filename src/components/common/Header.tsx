import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { MENUS, cloneDefaultMenus, sanitizeMenuConfig, type MenuConfig } from '../../constants/menus';
import { db } from '../../lib/firebase';

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
    const { currentUser, userData, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
    const [remainingSeconds, setRemainingSeconds] = useState(SESSION_DURATION_SECONDS);
    const [menuConfig, setMenuConfig] = useState<MenuConfig>(() => cloneDefaultMenus());
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
    const menuItems = menuConfig[portal] || MENUS[portal] || [];
    const home = `/${portal}/dashboard`;
    const profileTarget = isTeacherPortal ? '/teacher/settings' : '/student/mypage';
    const profileLabel = `${displayName} ${isTeacherPortal ? '교사' : '학생'}`;
    const studentProfileIcon = userData?.profileIcon || '🧑‍🎓';

    const isActive = (url: string) => {
        const [targetPath, targetQuery] = url.split('?');
        if (!location.pathname.startsWith(targetPath)) return false;
        if (!targetQuery) return true;

        const currentParams = new URLSearchParams(location.search);
        const targetParams = new URLSearchParams(targetQuery);
        for (const [key, value] of targetParams.entries()) {
            if (currentParams.get(key) !== value) return false;
        }
        return true;
    };

    const getChildMatchScore = (url: string, siblings: Array<{ url: string }>) => {
        const [path, query] = url.split('?');
        const pathMatches = location.pathname === path || location.pathname.startsWith(`${path}/`);
        if (!pathMatches) return -1;

        const queryParams = new URLSearchParams(query || '');
        const currentParams = new URLSearchParams(location.search);
        for (const [key, value] of queryParams.entries()) {
            if (currentParams.get(key) !== value) return -1;
        }

        const hasQuerySiblingOnSamePath = siblings.some((sibling) => {
            const [siblingPath, siblingQuery] = sibling.url.split('?');
            return siblingPath === path && !!siblingQuery;
        });
        const noQueryPenalty = !query && hasQuerySiblingOnSamePath && location.search.length > 0 ? -500 : 0;

        return path.length * 10 + queryParams.size * 100 + noQueryPenalty;
    };

    const isChildActive = (childUrl: string, siblings: Array<{ url: string }>) => {
        const targetScore = getChildMatchScore(childUrl, siblings);
        if (targetScore < 0) return false;

        const bestScore = siblings.reduce((max, sibling) => {
            return Math.max(max, getChildMatchScore(sibling.url, siblings));
        }, -1);

        return targetScore === bestScore;
    };

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
        const loadMenuConfig = async () => {
            try {
                const menuSnap = await getDoc(doc(db, 'site_settings', 'menu_config'));
                if (menuSnap.exists()) {
                    setMenuConfig(sanitizeMenuConfig(menuSnap.data()));
                    return;
                }
            } catch (error) {
                console.error('Failed to load menu config:', error);
            }

            setMenuConfig(cloneDefaultMenus());
        };

        void loadMenuConfig();
    }, []);

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

                    <nav className={`desktop-nav ml-4 ${!isTeacherPortal ? 'student-desktop-nav' : ''}`}>
                        {menuItems.map((item, idx) => {
                            const hasChildren = !!item.children?.length;
                            const active = isActive(item.url) || !!item.children?.some((child) => isChildActive(child.url, item.children || []));

                            if (!hasChildren) {
                                return (
                                    <Link key={`${item.url}-${idx}`} to={item.url} className={`nav-link ${active ? 'active' : ''} ${!isTeacherPortal ? 'student-nav-link' : ''}`}>
                                        {item.name}
                                    </Link>
                                );
                            }

                            return (
                                <div key={`${item.url}-${idx}`} className="relative group h-full flex items-center">
                                    <Link to={item.url} className={`nav-link ${active ? 'active' : ''} ${!isTeacherPortal ? 'student-nav-link' : ''} flex items-center gap-1`}>
                                        {item.name}
                                        <i className="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                                    </Link>
                                    <div className="absolute top-[calc(100%-8px)] left-0 w-[10.5rem] pt-0 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition duration-150 transform translate-y-0 z-[100]">
                                        <div className="bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
                                            {item.children?.map((child, childIdx) => (
                                                <Link
                                                    key={`${child.url}-${childIdx}`}
                                                    to={child.url}
                                                    className={`block px-2.5 py-3 text-[13px] border-b border-gray-50 last:border-0 whitespace-nowrap font-bold ${isChildActive(child.url, item.children || []) ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}`}
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
                    {isTeacherPortal && (
                        <Link to="/teacher/settings" className="text-gray-400 hover:text-blue-600 transition" title="설정">
                            <i className="fas fa-cog fa-lg"></i>
                        </Link>
                    )}

                    <Link to={profileTarget} className="user-greeting header-user-link inline-flex items-center hover:text-blue-600 transition cursor-pointer" title={isTeacherPortal ? '관리자 페이지' : '마이페이지'}>
                        {!isTeacherPortal && (
                            <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-[14px] leading-none">
                                {studentProfileIcon}
                            </span>
                        )}
                        {profileLabel}
                    </Link>

                    <span className={`lg:hidden inline-flex items-center justify-center font-mono font-bold text-xs min-w-[46px] px-2 py-1 rounded-md border border-stone-300 bg-stone-100 ${remainingSeconds < 300 ? 'text-red-500 border-red-300 bg-red-50' : 'text-stone-600'}`}>
                        {formatCountdown(remainingSeconds)}
                    </span>

                    <div className="hidden lg:flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200">
                        <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
                        <span className={`font-mono font-bold text-sm w-[42px] text-center ${remainingSeconds < 300 ? 'text-red-500' : 'text-stone-600'}`}>
                            {formatCountdown(remainingSeconds)}
                        </span>
                        <button onClick={extendSession} className="text-stone-400 hover:text-blue-600 transition p-1" title="시간 연장">
                            <i className="fas fa-redo-alt text-xs"></i>
                        </button>
                    </div>


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

            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 top-16 z-40 lg:hidden bg-transparent"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-hidden="true"
                ></div>
            )}

            <div id="mobile-menu" className={mobileMenuOpen ? 'open' : ''}>
                {menuItems.map((item, idx) => (
                    <div key={`${item.url}-mobile-${idx}`}>
                        <Link
                            to={item.url}
                            className={`mobile-link ${isActive(item.url) || !!item.children?.some((child) => isChildActive(child.url, item.children || [])) ? 'active' : ''}`}
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
                                        className={`block pl-12 pr-4 py-1.5 text-sm rounded-r-full mr-2 font-bold ${isChildActive(child.url, item.children || []) ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'}`}
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
