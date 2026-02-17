import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { cloneDefaultMenus, sanitizeMenuConfig, type MenuConfig, type PortalType } from '../../../constants/menus';

type InterfaceTab = 'landing' | 'sitemap';

const DEFAULT_INTERFACE_CONFIG = {
    mainEmoji: '📚',
    mainSubtitle: '우리가 써 내려가는 이야기',
    ddayEnabled: false,
    ddayTitle: '',
    ddayDate: '',
    footerText: '',
};

const moveInArray = <T,>(items: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

const SettingsInterface: React.FC = () => {
    const [activeTab, setActiveTab] = useState<InterfaceTab>('landing');
    const [activePortal, setActivePortal] = useState<PortalType>('student');
    const [config, setConfig] = useState(DEFAULT_INTERFACE_CONFIG);
    const [menuConfig, setMenuConfig] = useState<MenuConfig>(() => cloneDefaultMenus());
    const [loading, setLoading] = useState(true);
    const [savingInterface, setSavingInterface] = useState(false);
    const [savingMenu, setSavingMenu] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [interfaceSnap, menuSnap] = await Promise.all([
                    getDoc(doc(db, 'site_settings', 'interface_config')),
                    getDoc(doc(db, 'site_settings', 'menu_config')),
                ]);

                if (interfaceSnap.exists()) {
                    const data = interfaceSnap.data();
                    setConfig({
                        mainEmoji: (data.mainEmoji || DEFAULT_INTERFACE_CONFIG.mainEmoji).trim(),
                        mainSubtitle: (data.mainSubtitle || DEFAULT_INTERFACE_CONFIG.mainSubtitle).trim(),
                        ddayEnabled: Boolean(data.ddayEnabled),
                        ddayTitle: data.ddayTitle || '',
                        ddayDate: data.ddayDate || '',
                        footerText: data.footerText || '',
                    });
                }

                if (menuSnap.exists()) {
                    setMenuConfig(sanitizeMenuConfig(menuSnap.data()));
                } else {
                    setMenuConfig(cloneDefaultMenus());
                }
            } catch (error) {
                console.error('Failed to load interface settings:', error);
                setMenuConfig(cloneDefaultMenus());
            } finally {
                setLoading(false);
            }
        };

        void loadSettings();
    }, []);

    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setConfig((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const updatePortalMenus = (portal: PortalType, updater: (menus: MenuConfig[PortalType]) => MenuConfig[PortalType]) => {
        setMenuConfig((prev) => ({
            ...prev,
            [portal]: updater(prev[portal]),
        }));
    };

    const updateParentName = (portal: PortalType, index: number, name: string) => {
        updatePortalMenus(portal, (menus) =>
            menus.map((item, idx) => (idx === index ? { ...item, name } : item)),
        );
    };

    const moveParent = (portal: PortalType, index: number, direction: -1 | 1) => {
        updatePortalMenus(portal, (menus) => moveInArray(menus, index, index + direction));
    };

    const deleteParent = (portal: PortalType, index: number) => {
        updatePortalMenus(portal, (menus) => menus.filter((_, idx) => idx !== index));
    };

    const updateChildName = (portal: PortalType, parentIndex: number, childIndex: number, name: string) => {
        updatePortalMenus(portal, (menus) =>
            menus.map((item, idx) => {
                if (idx !== parentIndex || !item.children) return item;
                return {
                    ...item,
                    children: item.children.map((child, cIdx) => (cIdx === childIndex ? { ...child, name } : child)),
                };
            }),
        );
    };

    const moveChild = (portal: PortalType, parentIndex: number, childIndex: number, direction: -1 | 1) => {
        updatePortalMenus(portal, (menus) =>
            menus.map((item, idx) => {
                if (idx !== parentIndex || !item.children) return item;
                return {
                    ...item,
                    children: moveInArray(item.children, childIndex, childIndex + direction),
                };
            }),
        );
    };

    const deleteChild = (portal: PortalType, parentIndex: number, childIndex: number) => {
        updatePortalMenus(portal, (menus) =>
            menus.map((item, idx) => {
                if (idx !== parentIndex || !item.children) return item;
                return {
                    ...item,
                    children: item.children.filter((_, cIdx) => cIdx !== childIndex),
                };
            }),
        );
    };

    const saveInterfaceConfig = async () => {
        if (config.ddayEnabled && (!config.ddayTitle.trim() || !config.ddayDate)) {
            alert('D-Day를 사용하려면 제목과 날짜를 입력해야 합니다.');
            return;
        }

        setSavingInterface(true);
        try {
            await setDoc(doc(db, 'site_settings', 'interface_config'), {
                ...config,
                mainEmoji: config.mainEmoji.trim() || DEFAULT_INTERFACE_CONFIG.mainEmoji,
                mainSubtitle: config.mainSubtitle.trim() || DEFAULT_INTERFACE_CONFIG.mainSubtitle,
                ddayTitle: config.ddayTitle.trim(),
                footerText: config.footerText.trim(),
                updatedAt: serverTimestamp(),
            });
            alert('인터페이스 설정이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save interface config:', error);
            alert(`저장 실패: ${error.message}`);
        } finally {
            setSavingInterface(false);
        }
    };

    const saveMenuConfig = async () => {
        setSavingMenu(true);
        try {
            const normalized = sanitizeMenuConfig(menuConfig);
            await setDoc(doc(db, 'site_settings', 'menu_config'), {
                ...normalized,
                updatedAt: serverTimestamp(),
            });
            setMenuConfig(normalized);
            alert('사이트맵 메뉴 설정이 저장되었습니다.');
        } catch (error: any) {
            console.error('Failed to save menu config:', error);
            alert(`저장 실패: ${error.message}`);
        } finally {
            setSavingMenu(false);
        }
    };

    if (loading) return <div className="text-center py-10">Loading...</div>;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 p-3">
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setActiveTab('landing')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'landing' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        메인 화면
                    </button>
                    <button
                        onClick={() => setActiveTab('sitemap')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === 'sitemap' ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                        사이트맵 메뉴
                    </button>
                </div>
            </div>

            <div className="p-6 lg:p-8">
                {activeTab === 'landing' && (
                    <div className="max-w-3xl space-y-8">
                        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                            <div className="border-b border-gray-100 pb-4 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">
                                    <i className="fas fa-home text-blue-500 mr-2"></i>메인 화면 설정
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">로그인(메인) 화면의 문구와 이모지를 설정합니다.</p>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">메인 이모지</label>
                                    <input
                                        type="text"
                                        name="mainEmoji"
                                        value={config.mainEmoji}
                                        onChange={handleConfigChange}
                                        placeholder="예: 📚"
                                        className="w-24 text-center text-2xl border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">이모지 1개를 입력하세요.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">서브 타이틀</label>
                                    <input
                                        type="text"
                                        name="mainSubtitle"
                                        value={config.mainSubtitle}
                                        onChange={handleConfigChange}
                                        placeholder="예: 우리가 써 내려가는 이야기"
                                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                            <div className="border-b border-gray-100 pb-4 mb-6">
                                <h3 className="text-lg font-bold text-gray-900">
                                    <i className="fas fa-copyright text-gray-500 mr-2"></i>푸터 설정
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">사이트 하단의 저작권 문구를 설정합니다.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">저작권 문구</label>
                                <input
                                    type="text"
                                    name="footerText"
                                    value={config.footerText}
                                    onChange={handleConfigChange}
                                    placeholder="예: Copyright © 2026 ..."
                                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                />
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm">
                            <div className="border-b border-gray-100 pb-4 mb-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900">
                                            <i className="fas fa-hourglass-half text-orange-500 mr-2"></i>D-Day 표시
                                        </h3>
                                        <p className="text-sm text-gray-500 mt-1">메인 화면에 D-Day 카운트를 표시합니다.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            name="ddayEnabled"
                                            checked={config.ddayEnabled}
                                            onChange={handleConfigChange}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                        <span className="ml-3 text-sm font-medium text-gray-900">사용</span>
                                    </label>
                                </div>
                            </div>

                            <div className={`space-y-6 transition-opacity duration-200 ${config.ddayEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">제목</label>
                                    <input
                                        type="text"
                                        name="ddayTitle"
                                        value={config.ddayTitle}
                                        onChange={handleConfigChange}
                                        placeholder="예: 수능, 중간고사"
                                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">목표 날짜</label>
                                    <input
                                        type="date"
                                        name="ddayDate"
                                        value={config.ddayDate}
                                        onChange={handleConfigChange}
                                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="text-right pb-2">
                            <button
                                onClick={() => void saveInterfaceConfig()}
                                disabled={savingInterface}
                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 px-10 rounded-xl shadow-lg transition transform active:scale-95 text-base"
                            >
                                <i className="fas fa-save mr-2"></i>{savingInterface ? '저장 중...' : '전체 저장'}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'sitemap' && (
                    <div className="space-y-6">
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setActivePortal('student')}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activePortal === 'student' ? 'bg-emerald-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                                학생 대시보드 메뉴
                            </button>
                            <button
                                onClick={() => setActivePortal('teacher')}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activePortal === 'teacher' ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                                교사 대시보드 메뉴
                            </button>
                        </div>

                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                            <i className="fas fa-sitemap mr-1"></i>
                            사이트맵 구조로 상위/하위 메뉴를 정리합니다. 이름 변경, 순서 이동, 삭제 후 저장을 눌러주세요.
                        </div>

                        <div className="space-y-4">
                            {menuConfig[activePortal].map((item, parentIndex) => (
                                <div key={`${activePortal}-${item.url}-${parentIndex}`} className="border border-gray-200 rounded-xl overflow-hidden">
                                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                                        <div className="flex flex-wrap items-center gap-2 mb-3">
                                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-700 text-white text-xs font-bold">
                                                {parentIndex + 1}
                                            </span>
                                            <span className="text-xs font-semibold text-gray-500">상위 메뉴</span>
                                            <button
                                                type="button"
                                                onClick={() => moveParent(activePortal, parentIndex, -1)}
                                                disabled={parentIndex === 0}
                                                className="ml-auto px-2.5 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 disabled:opacity-40"
                                            >
                                                위로
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveParent(activePortal, parentIndex, 1)}
                                                disabled={parentIndex === menuConfig[activePortal].length - 1}
                                                className="px-2.5 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 disabled:opacity-40"
                                            >
                                                아래로
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => deleteParent(activePortal, parentIndex)}
                                                className="px-2.5 py-1.5 text-xs rounded-md border border-red-200 text-red-500"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            value={item.name}
                                            onChange={(e) => updateParentName(activePortal, parentIndex, e.target.value)}
                                            className="w-full border border-gray-300 rounded-lg p-2.5 font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                        <p className="text-xs text-gray-500 mt-2 break-all">URL: {item.url}</p>
                                    </div>

                                    <div className="p-4 space-y-3 bg-white">
                                        {item.children && item.children.length > 0 ? (
                                            item.children.map((child, childIndex) => (
                                                <div key={`${child.url}-${childIndex}`} className="rounded-lg border border-gray-200 p-3">
                                                    <div className="flex flex-wrap items-center gap-2 mb-2">
                                                        <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                                                            하위 {childIndex + 1}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => moveChild(activePortal, parentIndex, childIndex, -1)}
                                                            disabled={childIndex === 0}
                                                            className="ml-auto px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600 disabled:opacity-40"
                                                        >
                                                            위로
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => moveChild(activePortal, parentIndex, childIndex, 1)}
                                                            disabled={childIndex === item.children!.length - 1}
                                                            className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600 disabled:opacity-40"
                                                        >
                                                            아래로
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => deleteChild(activePortal, parentIndex, childIndex)}
                                                            className="px-2 py-1 text-[11px] rounded border border-red-200 text-red-500"
                                                        >
                                                            삭제
                                                        </button>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={child.name}
                                                        onChange={(e) => updateChildName(activePortal, parentIndex, childIndex, e.target.value)}
                                                        className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                    <p className="text-[11px] text-gray-500 mt-2 break-all">URL: {child.url}</p>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-sm text-gray-400 py-2">하위 메뉴가 없습니다.</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="text-right">
                            <button
                                type="button"
                                onClick={() => void saveMenuConfig()}
                                disabled={savingMenu}
                                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition"
                            >
                                <i className="fas fa-save mr-2"></i>{savingMenu ? '저장 중...' : '사이트맵 저장'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsInterface;
