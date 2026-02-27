import React, { useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, User, signInWithPopup, signOut } from 'firebase/auth';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { UserData } from '../types';

const TEACHER_EMAIL = 'westoria28@gmail.com';
const ROLE_SESSION_KEY = 'westoryPortalRole';

interface SchoolOption {
    value: string;
    label: string;
}

interface StudentProfileForm {
    email: string;
    grade: string;
    className: string;
    number: string;
    name: string;
}

interface ConsentItem {
    id: string;
    title: string;
    text: string;
    required: boolean;
    order: number;
}

interface StudentOnboardingResult {
    name: string;
    grade: string;
    classValue: string;
    number: string;
    privacyAgreed: boolean;
    consentAgreedItems: string[];
    newlyAgreedPrivacy: boolean;
}

const defaultGradeOptions: SchoolOption[] = [
    { value: '1', label: '1학년' },
    { value: '2', label: '2학년' },
    { value: '3', label: '3학년' },
];

const defaultClassOptions: SchoolOption[] = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}반`,
}));

const getSavedRole = (): UserData['role'] | null => {
    const saved = sessionStorage.getItem(ROLE_SESSION_KEY) || localStorage.getItem(ROLE_SESSION_KEY);
    return saved === 'teacher' || saved === 'student' ? saved : null;
};

const normalizeSchoolField = (value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const digits = raw.match(/\d+/)?.[0] || '';
    if (!digits) return raw;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(parsed);
};

const pickStudentRosterProfile = async (email: string): Promise<Partial<UserData> | null> => {
    if (!email) return null;

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email), limit(20)));
        let best: Partial<UserData> | null = null;
        let bestScore = -1;

        snap.forEach((docSnap) => {
            const data = docSnap.data() as Partial<UserData>;
            if (data.role !== 'student') return;

            const grade = normalizeSchoolField(data.grade);
            const className = normalizeSchoolField(data.class);
            const number = normalizeSchoolField(data.number);
            const name = (data.name || '').trim();
            const score = (grade && className ? 100 : 0) + (name ? 10 : 0) + (number ? 1 : 0);

            if (score > bestScore) {
                bestScore = score;
                best = {
                    name,
                    grade,
                    class: className,
                    number,
                    customNameConfirmed: data.customNameConfirmed === true,
                    privacyAgreed: data.privacyAgreed === true,
                    consentAgreedItems: Array.isArray(data.consentAgreedItems) ? data.consentAgreedItems : [],
                };
            }
        });

        return best;
    } catch (error) {
        console.warn('Failed to read student roster profile', error);
        return null;
    }
};

const Login: React.FC = () => {
    const { currentUser, userData, interfaceConfig, loading } = useAuth();
    const navigate = useNavigate();

    const [authBusy, setAuthBusy] = useState(false);

    const [policyOpen, setPolicyOpen] = useState(false);
    const [policyTitle, setPolicyTitle] = useState('');
    const [policyHtml, setPolicyHtml] = useState('');
    const [policyLoading, setPolicyLoading] = useState(false);

    const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>(defaultGradeOptions);
    const [classOptions, setClassOptions] = useState<SchoolOption[]>(defaultClassOptions);

    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [profileForm, setProfileForm] = useState<StudentProfileForm>({
        email: '',
        grade: defaultGradeOptions[0].value,
        className: '',
        number: '',
        name: '',
    });
    const profileResolverRef = useRef<((value: StudentProfileForm | null) => void) | null>(null);

    const [consentModalOpen, setConsentModalOpen] = useState(false);
    const [consentItems, setConsentItems] = useState<ConsentItem[]>([]);
    const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>({});
    const [consentExpandedId, setConsentExpandedId] = useState<string | null>(null);
    const [consentReadReady, setConsentReadReady] = useState<Record<string, boolean>>({});
    const consentResolverRef = useRef<((value: string[] | null) => void) | null>(null);

    const preferredRole = getSavedRole();
    const isTeacherUser = (preferredRole || userData?.role) === 'teacher';

    const clearRoleCache = () => {
        sessionStorage.removeItem(ROLE_SESSION_KEY);
        localStorage.removeItem(ROLE_SESSION_KEY);
    };

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const schoolSnap = await getDoc(doc(db, 'site_settings', 'school_config'));
                if (!schoolSnap.exists()) return;

                const data = schoolSnap.data() as {
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                };

                if (Array.isArray(data.grades) && data.grades.length > 0) {
                    const nextGrades = data.grades
                        .map((item) => ({
                            value: normalizeSchoolField(item.value),
                            label: (item.label || '').trim(),
                        }))
                        .filter((item) => item.value && item.label);
                    if (nextGrades.length > 0) {
                        setGradeOptions(nextGrades);
                    }
                }

                if (Array.isArray(data.classes) && data.classes.length > 0) {
                    const nextClasses = data.classes
                        .map((item) => ({
                            value: normalizeSchoolField(item.value),
                            label: (item.label || '').trim(),
                        }))
                        .filter((item) => item.value && item.label);
                    if (nextClasses.length > 0) {
                        setClassOptions(nextClasses);
                    }
                }
            } catch (error) {
                console.warn('Failed to load school config', error);
            }
        };

        void loadSchoolConfig();
    }, []);

    useEffect(() => {
        return () => {
            if (profileResolverRef.current) {
                profileResolverRef.current(null);
                profileResolverRef.current = null;
            }
            if (consentResolverRef.current) {
                consentResolverRef.current(null);
                consentResolverRef.current = null;
            }
        };
    }, []);

    const openProfileModal = (initial: StudentProfileForm): Promise<StudentProfileForm | null> => {
        setProfileForm(initial);
        setProfileModalOpen(true);
        return new Promise((resolve) => {
            profileResolverRef.current = resolve;
        });
    };

    const closeProfileModal = (result: StudentProfileForm | null) => {
        setProfileModalOpen(false);
        const resolver = profileResolverRef.current;
        profileResolverRef.current = null;
        resolver?.(result);
    };

    const handleProfileSubmit = () => {
        const name = profileForm.name.trim().slice(0, 20);
        const grade = normalizeSchoolField(profileForm.grade);
        const classValue = normalizeSchoolField(profileForm.className);
        const number = normalizeSchoolField(profileForm.number);

        if (!name || !grade || !classValue || !number) {
            alert('이름, 학년, 반, 번호를 모두 입력해주세요.');
            return;
        }

        closeProfileModal({
            email: profileForm.email,
            name,
            grade,
            className: classValue,
            number,
        });
    };

    const handleProfileCancel = () => {
        closeProfileModal(null);
    };

    const loadConsentItems = async (): Promise<ConsentItem[]> => {
        try {
            const consentQuery = query(collection(db, 'site_settings', 'consent', 'items'), orderBy('order', 'asc'));
            const snap = await getDocs(consentQuery);
            const items: ConsentItem[] = [];
            snap.forEach((docSnap) => {
                const data = docSnap.data() as Partial<ConsentItem>;
                items.push({
                    id: docSnap.id,
                    title: (data.title || '').trim() || '동의 항목',
                    text: data.text || '',
                    required: data.required === true,
                    order: Number(data.order) || 0,
                });
            });
            return items;
        } catch (error) {
            console.warn('Failed to load consent items', error);
            return [];
        }
    };

    const openConsentModal = (items: ConsentItem[], preChecked: string[]): Promise<string[] | null> => {
        if (items.length === 0) {
            return Promise.resolve([]);
        }

        const checkedMap: Record<string, boolean> = {};
        const readMap: Record<string, boolean> = {};
        items.forEach((item) => {
            checkedMap[item.id] = preChecked.includes(item.id);
            readMap[item.id] = preChecked.includes(item.id);
        });

        setConsentItems(items);
        setConsentChecked(checkedMap);
        setConsentReadReady(readMap);
        const firstPending = items.find((item) => !checkedMap[item.id]);
        setConsentExpandedId(firstPending ? firstPending.id : items[0]?.id || null);
        setConsentModalOpen(true);

        return new Promise((resolve) => {
            consentResolverRef.current = resolve;
        });
    };

    const closeConsentModal = (result: string[] | null) => {
        setConsentModalOpen(false);
        setConsentExpandedId(null);
        setConsentReadReady({});
        const resolver = consentResolverRef.current;
        consentResolverRef.current = null;
        resolver?.(result);
    };

    const consentReady = consentItems
        .filter((item) => item.required)
        .every((item) => consentChecked[item.id]);
    const currentConsentStepIndex = Math.max(0, consentItems.findIndex((item) => !consentChecked[item.id]));

    const handleConsentConfirm = () => {
        if (!consentReady) {
            alert('필수 동의 항목에 체크해주세요.');
            return;
        }
        const agreedItems = consentItems.filter((item) => consentChecked[item.id]).map((item) => item.id);
        closeConsentModal(agreedItems);
    };

    const handleConsentCancel = () => {
        closeConsentModal(null);
    };

    const handleConsentScroll = (id: string, event: React.UIEvent<HTMLDivElement>) => {
        if (consentReadReady[id]) return;
        const el = event.currentTarget;
        const reachedBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
        if (reachedBottom) {
            setConsentReadReady((prev) => ({ ...prev, [id]: true }));
        }
    };

    useEffect(() => {
        if (!consentModalOpen || !consentExpandedId || consentReadReady[consentExpandedId]) return;
        const el = document.getElementById(`consent-scroll-${consentExpandedId}`) as HTMLDivElement | null;
        if (!el) return;
        // If content is shorter than the viewport, treat it as fully read.
        if (el.scrollHeight <= el.clientHeight + 2) {
            setConsentReadReady((prev) => ({ ...prev, [consentExpandedId]: true }));
        }
    }, [consentModalOpen, consentExpandedId, consentReadReady]);

    const handleConsentAgreeItem = (item: ConsentItem, index: number) => {
        if (!consentReadReady[item.id]) {
            alert('약관 내용을 끝까지 읽어주세요.');
            return;
        }

        setConsentChecked((prev) => ({ ...prev, [item.id]: true }));
        const nextItem = consentItems.slice(index + 1).find((x) => !consentChecked[x.id]);
        setConsentExpandedId(nextItem ? nextItem.id : null);
    };

    const completeStudentOnboarding = async (
        user: User,
        existing: Partial<UserData> | null,
        rosterProfile: Partial<UserData> | null,
    ): Promise<StudentOnboardingResult | null> => {
        let resolvedName = (existing?.name || '').trim() || (rosterProfile?.name || '').trim() || (user.displayName || '').trim();
        let gradeValue = normalizeSchoolField(existing?.grade) || normalizeSchoolField(rosterProfile?.grade);
        let classValue = normalizeSchoolField(existing?.class) || normalizeSchoolField(rosterProfile?.class);
        let numberValue = normalizeSchoolField(existing?.number) || normalizeSchoolField(rosterProfile?.number);
        const customNameConfirmed = existing?.customNameConfirmed === true;

        const needsProfileInput = !customNameConfirmed || !resolvedName || !gradeValue || !classValue || !numberValue;

        if (needsProfileInput) {
            const profile = await openProfileModal({
                email: user.email || '',
                name: resolvedName,
                grade: gradeValue || gradeOptions[0]?.value || '1',
                className: classValue,
                number: numberValue,
            });

            if (!profile) return null;

            resolvedName = profile.name.trim().slice(0, 20);
            gradeValue = normalizeSchoolField(profile.grade);
            classValue = normalizeSchoolField(profile.className);
            numberValue = normalizeSchoolField(profile.number);
        }

        if (!resolvedName || !gradeValue || !classValue || !numberValue) {
            alert('학생 정보 입력이 완료되지 않았습니다.');
            return null;
        }

        const existingConsentItems = Array.isArray(existing?.consentAgreedItems)
            ? existing.consentAgreedItems.filter((item): item is string => typeof item === 'string')
            : [];
        let privacyAgreed = existing?.privacyAgreed === true;
        let consentAgreedItems = existingConsentItems;

        if (!privacyAgreed) {
            const items = await loadConsentItems();
            const selected = await openConsentModal(items, existingConsentItems);
            if (selected === null) return null;
            privacyAgreed = true;
            consentAgreedItems = selected;
        }

        return {
            name: resolvedName,
            grade: gradeValue,
            classValue,
            number: numberValue,
            privacyAgreed,
            consentAgreedItems,
            newlyAgreedPrivacy: existing?.privacyAgreed !== true && privacyAgreed,
        };
    };

    const goToDashboard = async () => {
        if (!currentUser) return;
        if (isTeacherUser) {
            navigate('/teacher/dashboard');
            return;
        }

        if (authBusy) return;
        setAuthBusy(true);

        try {
            const userRef = doc(db, 'users', currentUser.uid);
            const userSnap = await getDoc(userRef);
            const existing = userSnap.exists() ? (userSnap.data() as Partial<UserData>) : null;
            const setup = await completeStudentOnboarding(currentUser, existing, null);
            if (!setup) {
                clearRoleCache();
                await signOut(auth);
                return;
            }

            const updatePayload: Record<string, unknown> = {
                uid: currentUser.uid,
                email: currentUser.email || '',
                photoURL: currentUser.photoURL || '',
                role: 'student',
                name: setup.name,
                customNameConfirmed: true,
                grade: setup.grade,
                class: setup.classValue,
                number: setup.number,
                privacyAgreed: setup.privacyAgreed,
                consentAgreedItems: setup.consentAgreedItems,
                lastLogin: serverTimestamp(),
            };

            if (setup.newlyAgreedPrivacy) {
                updatePayload.privacyAgreedAt = serverTimestamp();
            }

            if (!userSnap.exists()) {
                updatePayload.createdAt = serverTimestamp();
            }

            await setDoc(userRef, updatePayload, { merge: true });
            sessionStorage.setItem(ROLE_SESSION_KEY, 'student');
            localStorage.setItem(ROLE_SESSION_KEY, 'student');
            navigate('/student/dashboard');
        } catch (error) {
            console.error('Failed to continue student onboarding', error);
            alert('학생 정보 확인 중 오류가 발생했습니다.');
        } finally {
            setAuthBusy(false);
        }
    };

    const handleLogin = async (mode: 'student' | 'teacher') => {
        if (authBusy) return;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        setAuthBusy(true);

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const isTeacherEmail = user.email === TEACHER_EMAIL;

            if (mode === 'teacher' && !isTeacherEmail) {
                alert('관리자 로그인은 관리자 계정으로만 가능합니다.');
                clearRoleCache();
                await signOut(auth);
                return;
            }

            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            const existing = userSnap.exists() ? (userSnap.data() as Partial<UserData>) : null;
            const nextRole: UserData['role'] = mode === 'teacher' ? 'teacher' : 'student';

            const rosterProfile = nextRole === 'student' && isTeacherEmail
                ? await pickStudentRosterProfile(user.email || '')
                : null;

            let resolvedName = (existing?.name || '').trim() || (rosterProfile?.name || '').trim();
            let onboardingResult: StudentOnboardingResult | null = null;

            if (nextRole === 'student') {
                onboardingResult = await completeStudentOnboarding(user, existing, rosterProfile);
                if (!onboardingResult) {
                    clearRoleCache();
                    await signOut(auth);
                    return;
                }
                resolvedName = onboardingResult.name;
            } else if (!resolvedName) {
                resolvedName = (user.displayName || '교사').trim() || '교사';
            }

            const basePayload: Record<string, unknown> = {
                uid: user.uid,
                email: user.email || '',
                photoURL: user.photoURL || '',
                role: nextRole,
                lastLogin: serverTimestamp(),
            };

            if (resolvedName) {
                basePayload.name = resolvedName;
            }

            if (nextRole === 'student') {
                if (!onboardingResult) {
                    clearRoleCache();
                    await signOut(auth);
                    return;
                }
                basePayload.customNameConfirmed = true;
                basePayload.grade = onboardingResult.grade;
                basePayload.class = onboardingResult.classValue;
                basePayload.number = onboardingResult.number;
                basePayload.privacyAgreed = onboardingResult.privacyAgreed;
                basePayload.consentAgreedItems = onboardingResult.consentAgreedItems;
                if (onboardingResult.newlyAgreedPrivacy) {
                    basePayload.privacyAgreedAt = serverTimestamp();
                }
            }

            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    ...basePayload,
                    grade: nextRole === 'student' && onboardingResult ? onboardingResult.grade : '',
                    class: nextRole === 'student' && onboardingResult ? onboardingResult.classValue : '',
                    number: nextRole === 'student' && onboardingResult ? onboardingResult.number : '',
                    createdAt: serverTimestamp(),
                }, { merge: true });
            } else {
                await setDoc(userRef, basePayload, { merge: true });
            }

            sessionStorage.setItem(ROLE_SESSION_KEY, nextRole);
            localStorage.setItem(ROLE_SESSION_KEY, nextRole);
            navigate(nextRole === 'teacher' ? '/teacher/dashboard' : '/student/dashboard');
        } catch (error) {
            console.error('Login failed', error);
            alert('로그인에 실패했습니다.');
        } finally {
            setAuthBusy(false);
        }
    };

    const showPolicy = async (type: 'terms' | 'privacy') => {
        setPolicyOpen(true);
        setPolicyTitle(type === 'terms' ? '이용 약관' : '개인정보 처리 방침');
        setPolicyLoading(true);
        setPolicyHtml('');

        try {
            const snap = await getDoc(doc(db, 'site_settings', type));
            if (snap.exists() && snap.data().text) {
                setPolicyHtml((snap.data() as { text?: string }).text || '');
            } else {
                setPolicyHtml('<p class="text-center text-gray-400 py-8">등록된 내용이 없습니다.</p>');
            }
        } catch (error) {
            console.error('Policy load error:', error);
            setPolicyHtml('<p class="text-center text-red-400 py-8">내용을 불러오지 못했습니다.</p>');
        } finally {
            setPolicyLoading(false);
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    return (
        <div className="min-h-screen bg-gray-50 relative">
            <div className="min-h-screen md:h-screen flex flex-col items-center justify-center px-4 pb-24 md:pb-0">
                <div className="text-5xl mb-4 animate-bounce">{interfaceConfig?.mainEmoji || '\u{1F4DA}'}</div>
                <h1 className="text-6xl font-black tracking-tight mb-3">
                    <span className="text-blue-600">We</span><span className="text-amber-500">story</span>
                </h1>
                <p className="text-gray-500 text-xl font-medium mb-8">{interfaceConfig?.mainSubtitle || '우리가 써 내려가는 이야기'}</p>

                {currentUser ? (
                    <div className="flex flex-col items-center gap-3 w-full max-w-sm">
                        <p className="text-sm text-gray-500 break-all text-center px-2">{currentUser.email || '로그인 계정'}</p>
                        <button
                            onClick={goToDashboard}
                            disabled={authBusy}
                            className="w-full bg-blue-600 text-white border border-blue-600 px-6 py-3 rounded-full text-base font-bold shadow hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {authBusy ? '처리 중...' : '계속하기'}
                        </button>
                        <button
                            onClick={() => handleLogin('student')}
                            disabled={authBusy}
                            className="w-full bg-white border border-gray-300 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            학생 로그인 (계정 선택)
                        </button>
                        <button
                            onClick={async () => {
                                clearRoleCache();
                                await signOut(auth);
                            }}
                            disabled={authBusy}
                            className="w-full bg-white border border-gray-200 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            다른 계정으로 로그인
                        </button>
                    </div>
                ) : (
                    <div className="w-full max-w-sm flex flex-col gap-3">
                        <button
                            onClick={() => handleLogin('student')}
                            disabled={authBusy}
                            className="w-full bg-white border border-gray-200 px-8 py-4 rounded-full text-lg font-bold text-gray-700 shadow hover:bg-gray-50 transition flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" width={24} height={24} alt="Google" />
                            학생 로그인
                        </button>
                    </div>
                )}
            </div>

            <div className="absolute bottom-6 md:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs px-4 md:px-0 whitespace-nowrap">
                <button onClick={() => showPolicy('terms')} className="text-gray-400 hover:text-gray-600">이용 약관</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => showPolicy('privacy')} className="text-gray-400 hover:text-gray-600">개인정보 처리 방침</button>
            </div>

            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 md:hidden z-20">
                <button
                    onClick={() => handleLogin('teacher')}
                    className="text-gray-400 hover:text-gray-700 text-xs font-semibold px-2 py-1 rounded hover:bg-gray-200/60 transition whitespace-nowrap"
                >
                    <i className="fas fa-chalkboard-teacher mr-1"></i>
                    관리자 로그인
                </button>
            </div>

            <div className="fixed bottom-8 right-8 hidden lg:block z-30">
                <button
                    onClick={() => handleLogin('teacher')}
                    className="text-gray-400 hover:text-gray-700 text-xs font-semibold px-2 py-1 rounded hover:bg-gray-200/60 transition"
                >
                    <i className="fas fa-chalkboard-teacher mr-1"></i>
                    관리자 로그인
                </button>
            </div>

            {policyOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" onClick={() => setPolicyOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900">{policyTitle}</h2>
                            <button onClick={() => setPolicyOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl transition">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-700 leading-relaxed">
                            {policyLoading ? (
                                <p className="text-center text-gray-400 py-8">
                                    <i className="fas fa-spinner fa-spin mr-2"></i>불러오는 중...
                                </p>
                            ) : (
                                <div className="policy-rich-text" dangerouslySetInnerHTML={{ __html: policyHtml }} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {profileModalOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleProfileCancel}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 md:p-8 mx-4" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-5">
                            <h2 className="text-2xl font-bold text-gray-800">{'\u{1F44B} 반가워요!'}</h2>
                            <p className="text-sm text-gray-500 mt-1">최초 로그인 학생 정보를 입력해주세요.</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">이메일</label>
                                <input
                                    type="text"
                                    value={profileForm.email}
                                    readOnly
                                    className="w-full bg-gray-100 border border-gray-200 rounded-lg p-3 text-gray-500 text-sm font-mono"
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">학년</label>
                                    <select
                                        value={profileForm.grade}
                                        onChange={(e) => setProfileForm((prev) => ({ ...prev, grade: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    >
                                        {gradeOptions.map((grade) => (
                                            <option key={grade.value} value={grade.value}>{grade.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">반</label>
                                    <select
                                        value={profileForm.className}
                                        onChange={(e) => setProfileForm((prev) => ({ ...prev, className: e.target.value }))}
                                        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    >
                                        <option value="">선택</option>
                                        {classOptions.map((cls) => (
                                            <option key={cls.value} value={cls.value}>{cls.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">번호</label>
                                    <input
                                        type="number"
                                        value={profileForm.number}
                                        min={1}
                                        max={99}
                                        onChange={(e) => setProfileForm((prev) => ({ ...prev, number: e.target.value }))}
                                        placeholder="예: 15"
                                        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">이름</label>
                                <input
                                    type="text"
                                    value={profileForm.name}
                                    maxLength={20}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="본명 (예: 김철수)"
                                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex items-center justify-end gap-2">
                            <button
                                onClick={handleProfileCancel}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleProfileSubmit}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl transition shadow-lg"
                            >
                                입력 완료
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {consentModalOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={handleConsentCancel}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg md:max-w-4xl p-6 md:p-8 mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-5 shrink-0">
                            <div className="bg-blue-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">{'\u{1F6E1}\uFE0F'}</div>
                            <h2 className="text-2xl md:text-3xl font-bold text-gray-900">개인정보 활용 동의</h2>
                            <p className="text-gray-600 text-base mt-2 font-medium">서비스 이용을 위해 최초 1회 동의가 필요합니다.</p>
                        </div>

                        <div className="bg-gray-50 p-4 md:p-5 rounded-lg text-base text-gray-700 overflow-y-auto mb-5 border border-gray-200 leading-relaxed flex-1 min-h-0 space-y-4">
                            {consentItems.length === 0 && (
                                <p className="text-center text-gray-400 py-6">등록된 동의 항목이 없습니다.</p>
                            )}

                            {consentItems.map((item, idx) => {
                                const isExpanded = consentExpandedId === item.id;
                                const isChecked = !!consentChecked[item.id];
                                const locked = idx > currentConsentStepIndex && !isChecked;
                                return (
                                    <div key={item.id} className={idx > 0 ? 'border-t border-gray-200 pt-4' : ''}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (locked) return;
                                                setConsentExpandedId((prev) => (prev === item.id ? null : item.id));
                                            }}
                                            className="w-full text-left"
                                        >
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-purple-100 text-purple-700 font-extrabold text-sm px-2.5 py-1 rounded-full">{idx + 1}</span>
                                                <span className="font-bold text-gray-900 text-lg">{item.title || '동의 항목'}</span>
                                                {item.required ? (
                                                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">필수</span>
                                                ) : (
                                                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">선택</span>
                                                )}
                                                {isChecked && (
                                                    <span className="ml-auto text-xs md:text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                        동의 완료
                                                    </span>
                                                )}
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <>
                                                <div
                                                    id={`consent-scroll-${item.id}`}
                                                    onScroll={(e) => handleConsentScroll(item.id, e)}
                                                    className="bg-white p-4 md:p-5 rounded-lg text-[15px] md:text-base text-gray-700 border border-gray-200 max-h-56 md:max-h-64 overflow-y-auto mb-3 leading-7"
                                                >
                                                    <div className="policy-rich-text" dangerouslySetInnerHTML={{ __html: item.text || '' }} />
                                                </div>
                                                <div className="flex items-center justify-between gap-3 mb-1">
                                                    <span className={`text-xs md:text-sm font-semibold ${consentReadReady[item.id] ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                        {consentReadReady[item.id] ? '읽기 확인됨' : '끝까지 스크롤하면 동의 버튼이 활성화됩니다.'}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleConsentAgreeItem(item, idx)}
                                                        disabled={isChecked || !consentReadReady[item.id]}
                                                        className="shrink-0 px-4 md:px-5 py-2 rounded-lg text-sm md:text-base font-bold bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                                                    >
                                                        {isChecked ? '동의 완료' : `${item.required ? '필수' : '선택'} 동의`}
                                                    </button>
                                                </div>
                                            </>
                                        )}

                                        {!isExpanded && !isChecked && locked && (
                                            <p className="text-xs md:text-sm text-gray-400 mt-1">이전 항목 동의 후 열 수 있습니다.</p>
                                        )}
                                        {!isExpanded && !isChecked && !locked && (
                                            <p className="text-xs md:text-sm text-gray-500 mt-1">클릭하여 내용을 확인하고 동의하세요.</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="shrink-0 flex items-center justify-end gap-2">
                            <button
                                onClick={handleConsentCancel}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleConsentConfirm}
                                disabled={!consentReady}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-xl transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                                동의하고 시작하기
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <style>{`
                .policy-rich-text {
                    color: #374151;
                    line-height: 1.8;
                }
                .policy-rich-text p {
                    margin: 0.35rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text ul {
                    list-style: disc;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text ol {
                    list-style: decimal;
                    padding-left: 1.4rem;
                    margin: 0.45rem 0;
                }
                .policy-rich-text li {
                    margin: 0.25rem 0;
                    white-space: pre-wrap;
                }
                .policy-rich-text li[data-list='bullet'] {
                    list-style-type: disc;
                }
                .policy-rich-text li[data-list='ordered'] {
                    list-style-type: decimal;
                }
                .policy-rich-text .ql-indent-1 { padding-left: 2em; }
                .policy-rich-text .ql-indent-2 { padding-left: 4em; }
                .policy-rich-text .ql-indent-3 { padding-left: 6em; }
            `}</style>
        </div>
    );
};

export default Login;

