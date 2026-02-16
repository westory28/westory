import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { MENUS } from '../../constants/menus';

const Header: React.FC = () => {
    const { currentUser, userData, config, logout } = useAuth();
    const location = useLocation();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    if (!currentUser || !userData) return null;

    const userType = userData.role;
    const menuItems = MENUS[userType] || [];
    const isTeacher = userType === 'teacher';

    const isActive = (url: string) => location.pathname.startsWith(url.split('?')[0]);

    const handleLogout = async () => {
        try {
            await logout();
            window.location.href = '/'; // Force reload/redirect
        } catch (error) {
            console.error("Logout failed", error);
        }
    };

    return (
        <header className="z-[60] bg-white border-b border-stone-200 shadow-sm sticky top-0">
            <div className="header-container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to={isTeacher ? '/teacher/dashboard' : '/student/dashboard'} className="text-2xl font-bold tracking-tighter">
                        <span className="text-blue-600">We</span><span className="text-stone-700">story</span>
                    </Link>

                    {/* Desktop Nav */}
                    <nav className="hidden md:flex items-center h-full ml-6 space-x-1">
                        {menuItems.map((item, idx) => (
                            <div key={idx} className="relative group h-full flex items-center">
                                {item.children ? (
                                    <>
                                        <Link to={item.url} className={`px-3 py-2 text-sm font-bold transition rounded-lg hover:bg-stone-50 flex items-center gap-1 ${isActive(item.url) ? 'text-blue-600' : 'text-stone-500 hover:text-stone-800'}`}>
                                            {item.name} <i className="fas fa-chevron-down text-[10px] ml-1 opacity-50 group-hover:opacity-100 transition"></i>
                                        </Link>
                                        <div className="absolute top-full left-0 w-48 pt-3 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition duration-200 transform translate-y-2 group-hover:translate-y-0 z-[100]">
                                            <div className="bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
                                                {item.children.map((child, cIdx) => (
                                                    <Link key={cIdx} to={child.url} className="block px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-b border-gray-50 last:border-0 whitespace-nowrap">
                                                        {child.name}
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <Link to={item.url} className={`px-3 py-2 text-sm font-bold transition rounded-lg hover:bg-stone-50 ${isActive(item.url) ? 'text-blue-600' : 'text-stone-500 hover:text-stone-800'}`}>
                                        {item.name}
                                    </Link>
                                )}
                            </div>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-3">
                    {/* D-Day Container Placeholder */}
                    <div id="dday-container" className="hidden md:block"></div>

                    {config && (
                        <span className="hidden md:inline-block text-xs font-mono bg-gray-100 text-gray-500 px-2 py-1 rounded mr-2 border border-gray-200">
                            {config.year}-{config.semester}
                        </span>
                    )}

                    {isTeacher && (
                        <Link to="/teacher/settings" className="text-gray-400 hover:text-blue-600 cursor-pointer transition p-1 mr-2" title="관리자 설정">
                            <i className="fas fa-cog fa-lg"></i>
                        </Link>
                    )}

                    <div className="flex items-center gap-2 group cursor-pointer">
                        <span className="text-sm font-bold text-stone-700 whitespace-nowrap group-hover:text-blue-600 transition">
                            {userData.name} {isTeacher ? '교사' : '학생'}
                        </span>
                        {!isTeacher && (
                            <Link to="/student/mypage" className="text-gray-400 hover:text-blue-600 transition p-1 mr-2" title="마이페이지">
                                <i className="fas fa-user-circle fa-lg"></i>
                            </Link>
                        )}
                    </div>

                    <div className="flex items-center gap-1 md:gap-2 px-3 py-1 bg-stone-100 rounded-full border border-stone-200 ml-2">
                        <i className="fas fa-stopwatch text-stone-400 text-xs"></i>
                        <span className="font-mono font-bold text-stone-600 text-sm w-[42px] text-center">60:00</span>
                    </div>

                    <button onClick={handleLogout} className="text-stone-400 hover:text-stone-800 text-sm font-bold whitespace-nowrap ml-2">로그아웃</button>

                    <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-stone-500 hover:text-stone-800 p-2">
                        <i className="fas fa-bars fa-lg"></i>
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden border-t border-gray-100 bg-white">
                    {menuItems.map((item, idx) => (
                        <div key={idx}>
                            <Link to={item.url} className={`block px-4 py-3 text-sm font-bold border-b border-stone-50 ${isActive(item.url) ? 'text-blue-600 bg-blue-50' : 'text-stone-600 hover:bg-stone-50'}`} onClick={() => setMobileMenuOpen(false)}>
                                <div className="flex items-center gap-2">
                                    {/* Icon rendering needs SVG path logic or explicit usage */}
                                    <i className="fas fa-circle text-[6px] opacity-40"></i> {item.name}
                                </div>
                            </Link>
                            {item.children && (
                                <div className="bg-gray-50 border-b border-gray-100 pb-2">
                                    {item.children.map((child, cIdx) => (
                                        <Link key={cIdx} to={child.url} className="block pl-10 pr-4 py-2 text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                                            <i className="fas fa-angle-right mr-2 text-xs opacity-50"></i>{child.name}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </header>
    );
};

export default Header;
