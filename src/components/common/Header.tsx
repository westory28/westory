import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { MENUS, cloneDefaultMenus, sanitizeMenuConfig, type MenuConfig } from '../../constants/menus';
import { db } from '../../lib/firebase';
import { readLocalOnly, readStorage, removeStorage, writeLocalOnly } from '../../lib/safeStorage';
import {
    canAccessTeacherPortal,
    canManageSettings,
    canReadLessonManagement,
    canReadQuizManagement,
    canReadStudentList,
    getDefaultTeacherRoute,
} from '../../lib/permissions';

const SESSION_DURATION_SECONDS = 60 * 60;
const SESSION_EXPIRY_KEY = 'sessionExpiry';
const ROLE_SESSION_KEY = 'westoryPortalRole';

const formatCountdown = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
};

const resolveMenuTarget = (url: string, portal: 'student' | 'teacher') => {
    const normalized = (url || '').trim();
    if (!normalized) return normalized;
    const canonicalRoot = portal === 'teacher' ? '/teacher/quiz' : '/student/quiz';
    if (portal === 'student' && normalized === '/student/quiz') {
        return '/student/quiz?menu=history2';
    }
    return /(^|\/)quiz\/history2(\/|$)|(^|\/)history2(\/|$)/.test(normalized)
        ? `${canonicalRoot}?menu=history2`
        : normalized;
};

const resolveChildMenuTarget = (
    parentUrl: string,
    childName: string,
    childUrl: string,
    portal: 'student' | 'teacher',
) => {
    const normalizedName = (childName || '').trim().toLowerCase();
    const normalizedParent = (parentUrl || '').trim();
    const canonicalRoot = portal === 'teacher' ? '/teacher/quiz' : '/student/quiz';
    if (normalizedName === '역사2' && normalizedParent.startsWith(canonicalRoot)) {
        return `${canonicalRoot}?menu=history2`;
    }
    return resolveMenuTarget(childUrl, portal);
};

const getResolvedChildUrls = (
    parentUrl: string,
    children: Array<{ name: string; url: string }>,
    portal: 'student' | 'teacher',
) => children.map((child) => ({
    ...child,
    resolvedUrl: resolveChildMenuTarget(parentUrl, child.name, child.url, portal),
}));

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
    const savedRole = readStorage(ROLE_SESSION_KEY);
    const sessionRole = savedRole === 'teacher' || savedRole === 'student' ? savedRole : null;
    const isTeacherUser = canAccessTeacherPortal(userData, currentUser?.email || '');
    const displayName = (userData?.name || '').trim() || '이름 미설정';

    const portal: 'teacher' | 'student' = location.pathname.startsWith('/teacher')
        ? 'teacher'
        : location.pathname.startsWith('/student')
            ? 'student'
            : (isTeacherUser ? 'teacher' : 'student');

    const isTeacherPortal = portal === 'teacher';
    const baseMenuItems = menuConfig[portal] || MENUS[portal] || [];
    const menuItems = portal === 'teacher'
        ? baseMenuItems.filter((item) => {
            if (item.url === '/teacher/lesson') return canReadLessonManagement(userData, currentUser?.email || '');
            if (item.url === '/teacher/quiz') return canReadQuizManagement(userData, currentUser?.email || '');
            if (item.url === '/teacher/students') return canReadStudentList(userData, currentUser?.email || '');
            if (item.url === '/teacher/exam') return false;
            return false;
        })
        : baseMenuItems;
    const getVisibleChildren = (item: { children?: Array<{ hidden?: boolean; url: string; name: string }> }) => {
        if (!item.children?.length) return [];
        const visible = isTeacherPortal ? item.children : item.children.filter((child) => child.hidden !== true);
        if (!isTeacherPortal) return visible;
        return visible.filter((child) => {
            if (child.url === '/teacher/quiz/history-classroom') return false;
            return true;
        });
    };
    const home = isTeacherPortal ? getDefaultTeacherRoute(userData, currentUser?.email || '') : `/${portal}/dashboard`;
    const profileTarget = isTeacherPortal
        ? (canManageSettings(userData, currentUser?.email || '') ? '/teacher/settings' : home)
        : '/student/mypage';
    const profileLabel = `${displayName} ${isTeacherPortal ? '교사' : '학생'}`;
    const studentProfileIcon = userData?.profileIcon || '🧑‍🎓';
    const resolveTarget = (url: string) => resolveMenuTarget(url, portal);
    const desktopSubmenuParentUrls = new Set(['/student/lesson/note', '/teacher/lesson']);

    const isActive = (url: string) => {
        const [targetPath, targetQuery] = resolveTarget(url).split('?');
        if (!location.pathname.startsWith(targetPath)) return false;
        if (!targetQuery) return true;

        const currentParams = new URLSearchParams(location.search);
        const targetParams = new URLSearchParams(targetQuery);
        for (const [key, value] of targetParams.entries()) {
            if (currentParams.get(key) !== value) return false;
        }
        return true;
    };

    const getChildMatchScore = (resolvedUrl: string, siblings: Array<{ resolvedUrl: string }>) => {
        const [path, query] = resolvedUrl.split('?');
        const pathMatches = location.pathname === path || location.pathname.startsWith(`${path}/`);
        if (!pathMatches) return -1;

        const queryParams = new URLSearchParams(query || '');
        const currentParams = new URLSearchParams(location.search);
        for (const [key, value] of queryParams.entries()) {
            if (currentParams.get(key) !== value) return -1;
        }

        const hasQuerySiblingOnSamePath = siblings.some((sibling) => {
            const [siblingPath, siblingQuery] = sibling.resolvedUrl.split('?');
            return siblingPath === path && !!siblingQuery;
        });
        const noQueryPenalty = !query && hasQuerySiblingOnSamePath && location.search.length > 0 ? -500 : 0;

        return path.length * 10 + queryParams.size * 100 + noQueryPenalty;
    };

    const isChildActive = (resolvedUrl: string, siblings: Array<{ resolvedUrl: string }>) => {
        const targetScore = getChildMatchScore(resolvedUrl, siblings);
        if (targetScore < 0) return false;

        const bestScore = siblings.reduce((max, sibling) => {
            return Math.max(max, getChildMatchScore(sibling.resolvedUrl, siblings));
        }, -1);

        return targetScore === bestScore;
    };

    const activeDesktopSubmenu = menuItems
        .map((item) => {
            const visibleChildren = getVisibleChildren(item);
            const resolvedChildren = getResolvedChildUrls(item.url, visibleChildren, portal);
            const active = isActive(item.url) || resolvedChildren.some((child) => isChildActive(child.resolvedUrl, resolvedChildren));
            return {
                item,
                resolvedChildren,
                active,
            };
        })
        .find(({ item, resolvedChildren, active }) => (
            active &&
            resolvedChildren.length > 0 &&
            desktopSubmenuParentUrls.has(item.url)
        ));

    const performLogout = async (isTimeout: boolean) => {
        try {
            removeStorage(SESSION_EXPIRY_KEY);
            removeStorage(ROLE_SESSION_KEY);
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
        writeLocalOnly(SESSION_EXPIRY_KEY, String(expiry));
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
        const saved = Number(readLocalOnly(SESSION_EXPIRY_KEY));
        const nextExpiry = Number.isFinite(saved) && saved > now
            ? saved
            : now + SESSION_DURATION_SECONDS * 1000;
        writeLocalOnly(SESSION_EXPIRY_KEY, String(nextExpiry));
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

    useEffect(() => {
        if (!currentUser) return;

        const handleActivityClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('[data-session-ignore="true"]')) return;
            extendSession();
        };

        document.addEventListener('click', handleActivityClick, true);
        return () => document.removeEventListener('click', handleActivityClick, true);
    }, [currentUser]);

    if (!isReady) return null;

    return (
        <header>
            <div className="header-container">
                <div className="flex items-center gap-4 h-full">
                    <Link to={home} className="logo-text" data-session-ignore="true">
                        <span className="logo-we">We</span>
                        <span className="logo-story">story</span>
                    </Link>

                    <nav className={`desktop-nav ml-4 ${!isTeacherPortal ? 'student-desktop-nav' : ''}`}>
                        {menuItems.map((item, idx) => {
                            const visibleChildren = getVisibleChildren(item);
                            const resolvedChildren = getResolvedChildUrls(item.url, visibleChildren, portal);
                            const hasChildren = visibleChildren.length > 0;
                            const active = isActive(item.url) || resolvedChildren.some((child) => isChildActive(child.resolvedUrl, resolvedChildren));

                            if (!hasChildren) {
                                const itemTarget = resolveTarget(item.url);
                                return (
                                    <Link key={`${item.url}-${idx}`} to={itemTarget} data-session-ignore="true" className={`nav-link ${active ? 'active' : ''} ${!isTeacherPortal ? 'student-nav-link' : ''}`}>
                                        {item.name}
                                    </Link>
                                );
                            }

                            const itemTarget = resolveTarget(item.url);
                            return (
                                <div key={`${item.url}-${idx}`} className="relative group h-full flex items-center">
                                    <Link to={itemTarget} data-session-ignore="true" className={`nav-link ${active ? 'active' : ''} ${!isTeacherPortal ? 'student-nav-link' : ''} flex items-center gap-1`}>
                                        {item.name}
                                        <i className="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                                    </Link>
                                    <div className="absolute top-[calc(100%-8px)] left-0 w-[10.5rem] pt-0 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition duration-150 transform translate-y-0 z-[100]">
                                        <div className="bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
                                            {resolvedChildren.map((child, childIdx) => {
                                                const childTarget = child.resolvedUrl;
                                                return (
                                                <Link
                                                    key={`${child.url}-${childIdx}`}
                                                    to={childTarget}
                                                    data-session-ignore="true"
                                                    className={`block px-2.5 py-3 text-[13px] border-b border-gray-50 last:border-0 whitespace-nowrap font-bold ${isChildActive(child.resolvedUrl, resolvedChildren) ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}`}
                                                >
                                                    {child.name}
                                                </Link>
                                            )})}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </nav>
                </div>

                <div className="header-right">
                    {isTeacherPortal && canManageSettings(userData, currentUser?.email || '') && (
                        <Link to="/teacher/settings" data-session-ignore="true" className="text-gray-400 hover:text-blue-600 transition" title="설정">
                            <i className="fas fa-cog fa-lg"></i>
                        </Link>
                    )}

                    <Link to={profileTarget} data-session-ignore="true" className="user-greeting header-user-link inline-flex items-center hover:text-blue-600 transition cursor-pointer" title={isTeacherPortal ? '관리자 페이지' : '마이페이지'}>
                        {!isTeacherPortal && (
                            <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-[14px] leading-none">
                                {studentProfileIcon}
                            </span>
                        )}
                        {profileLabel}
                    </Link>

                    <button
                        type="button"
                        onClick={extendSession}
                        title="시간 연장"
                        data-session-ignore="true"
                        className={`lg:hidden inline-flex items-center justify-center font-mono font-bold text-xs min-w-[46px] px-2 py-1 rounded-md border border-stone-300 bg-stone-100 transition ${remainingSeconds < 300 ? 'text-red-500 border-red-300 bg-red-50' : 'text-stone-600'} hover:text-blue-600`}
                    >
                        {formatCountdown(remainingSeconds)}
                    </button>

                    <div className="hidden lg:flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200">
                        <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
                        <span className={`font-mono font-bold text-sm w-[42px] text-center ${remainingSeconds < 300 ? 'text-red-500' : 'text-stone-600'}`}>
                            {formatCountdown(remainingSeconds)}
                        </span>
                        <button onClick={extendSession} data-session-ignore="true" className="text-stone-400 hover:text-blue-600 transition p-1" title="시간 연장">
                            <i className="fas fa-redo-alt text-xs"></i>
                        </button>
                    </div>


                    <button onClick={handleLogout} data-session-ignore="true" className="btn-logout">
                        로그아웃
                    </button>

                    <button
                        onClick={() => setMobileMenuOpen((prev) => !prev)}
                        data-session-ignore="true"
                        className="mobile-menu-btn"
                        aria-label="모바일 메뉴 열기"
                    >
                        <i className="fas fa-bars"></i>
                    </button>
                </div>
            </div>

            {activeDesktopSubmenu && (
                <div className="hidden lg:block border-t border-gray-200 bg-white/95 backdrop-blur">
                    <div className="mx-auto flex w-full max-w-7xl items-center gap-1 px-6">
                        {activeDesktopSubmenu.resolvedChildren.map((child, childIdx) => {
                            const childTarget = child.resolvedUrl;
                            const active = isChildActive(child.resolvedUrl, activeDesktopSubmenu.resolvedChildren);

                            return (
                                <Link
                                    key={`${child.url}-desktop-submenu-${childIdx}`}
                                    to={childTarget}
                                    data-session-ignore="true"
                                    className={`inline-flex min-h-[46px] items-center border-b-2 px-5 text-sm font-bold transition ${
                                        active
                                            ? 'border-blue-500 text-blue-600'
                                            : 'border-transparent text-gray-600 hover:border-blue-200 hover:text-blue-600'
                                    }`}
                                >
                                    {child.name}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 top-16 z-40 lg:hidden bg-transparent"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-hidden="true"
                ></div>
            )}

            <div id="mobile-menu" className={mobileMenuOpen ? 'open' : ''}>
                {menuItems.map((item, idx) => {
                    const visibleChildren = getVisibleChildren(item);
                    const resolvedChildren = getResolvedChildUrls(item.url, visibleChildren, portal);
                    const itemTarget = resolveTarget(item.url);
                    return (
                    <div key={`${item.url}-mobile-${idx}`}>
                        <Link
                            to={itemTarget}
                            data-session-ignore="true"
                            className={`mobile-link ${isActive(item.url) || resolvedChildren.some((child) => isChildActive(child.resolvedUrl, resolvedChildren)) ? 'active' : ''}`}
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {item.name}
                        </Link>
                        {visibleChildren.length > 0 && (
                            <div className="bg-gray-50 border-b border-gray-100 pb-1">
                                {resolvedChildren.map((child, childIdx) => {
                                    const childTarget = child.resolvedUrl;
                                    return (
                                    <Link
                                        key={`${child.url}-mobile-child-${childIdx}`}
                                        to={childTarget}
                                        data-session-ignore="true"
                                        className={`block pl-12 pr-4 py-1.5 text-sm rounded-r-full mr-2 font-bold ${isChildActive(child.resolvedUrl, resolvedChildren) ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'}`}
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        <i className="fas fa-angle-right mr-2 text-xs opacity-50"></i>
                                        {child.name}
                                    </Link>
                                )})}
                            </div>
                        )}
                    </div>
                )})}
            </div>
        </header>
    );
};

export default Header;
