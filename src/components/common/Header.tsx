import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MENUS } from '../../constants/menus';

const Header: React.FC = () => {
    const { currentUser, userData, config, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    if (!currentUser || !userData) return null;

    const isTeacher = userData.role === 'teacher';
    const menuItems = MENUS[isTeacher ? 'teacher' : 'student'] || [];
    const home = isTeacher ? '/teacher/dashboard' : '/student/dashboard';

    const isActive = (url: string) => location.pathname.startsWith(url.split('?')[0]);

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/', { replace: true });
        } catch (error) {
            console.error('Logout failed', error);
        }
    };

    return (
        <header>
            <div className="header-container">
                <div className="flex items-center gap-4 h-full">
                    <Link to={home} className="logo-text">
                        <span className="logo-we">We</span>
                        <span className="logo-story">story</span>
                    </Link>

                    <nav className="desktop-nav ml-4">
                        {menuItems.map((item, idx) => (
                            <Link key={`${item.url}-${idx}`} to={item.url} className={`nav-link ${isActive(item.url) ? 'active' : ''}`}>
                                {item.name}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="header-right">
                    {config && (
                        <span className="hidden md:inline-block text-xs font-mono bg-gray-100 text-gray-500 px-2 py-1 rounded border border-gray-200">
                            {config.year}-{config.semester}
                        </span>
                    )}

                    <span className="user-greeting">
                        {userData.name} {isTeacher ? '교사' : '학생'}
                    </span>

                    {!isTeacher && (
                        <Link to="/student/mypage" className="text-gray-400 hover:text-blue-600 transition" title="마이페이지">
                            <i className="fas fa-user-circle fa-lg"></i>
                        </Link>
                    )}

                    {isTeacher && (
                        <Link to="/teacher/settings" className="text-gray-400 hover:text-blue-600 transition" title="설정">
                            <i className="fas fa-cog fa-lg"></i>
                        </Link>
                    )}

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
                    <Link
                        key={`${item.url}-mobile-${idx}`}
                        to={item.url}
                        className={`mobile-link ${isActive(item.url) ? 'active' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        {item.name}
                    </Link>
                ))}
            </div>
        </header>
    );
};

export default Header;
