import React, { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
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
                };
            }
        });

        return best;
    } catch (error) {
        console.warn('Failed to read student roster profile', error);
        return null;
    }
};

const promptStudentName = (initialValue = ''): string | null => {
    let defaultValue = initialValue;
    while (true) {
        const input = window.prompt('학생 이름을 입력해주세요.', defaultValue);
        if (input === null) return null;
        const trimmed = input.trim();
        if (trimmed) return trimmed.slice(0, 20);
        alert('이름을 입력해주세요.');
        defaultValue = '';
    }
};

const Login: React.FC = () => {
    const { currentUser, userData, interfaceConfig, loading } = useAuth();
    const navigate = useNavigate();

    const [policyOpen, setPolicyOpen] = useState(false);
    const [policyTitle, setPolicyTitle] = useState('');
    const [policyHtml, setPolicyHtml] = useState('');
    const [policyLoading, setPolicyLoading] = useState(false);

    const preferredRole = getSavedRole();
    const isTeacherUser = (preferredRole || userData?.role) === 'teacher';

    const goToDashboard = () => {
        navigate(isTeacherUser ? '/teacher/dashboard' : '/student/dashboard');
    };

    const clearRoleCache = () => {
        sessionStorage.removeItem(ROLE_SESSION_KEY);
        localStorage.removeItem(ROLE_SESSION_KEY);
    };

    const handleLogin = async (mode: 'student' | 'teacher') => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

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

            const existingName = (existing?.name || '').trim() || (rosterProfile?.name || '').trim();
            const customNameConfirmed = existing?.customNameConfirmed === true;
            const gradeValue = normalizeSchoolField(existing?.grade) || normalizeSchoolField(rosterProfile?.grade);
            const classValue = normalizeSchoolField(existing?.class) || normalizeSchoolField(rosterProfile?.class);
            const numberValue = normalizeSchoolField(existing?.number) || normalizeSchoolField(rosterProfile?.number);

            let resolvedName = existingName;

            if (nextRole === 'student' && (!resolvedName || !customNameConfirmed)) {
                const entered = promptStudentName(existingName || user.displayName || '');
                if (!entered) {
                    clearRoleCache();
                    await signOut(auth);
                    return;
                }
                resolvedName = entered;
            }

            if (nextRole === 'teacher' && !resolvedName) {
                resolvedName = (user.displayName || '교사').trim() || '교사';
            }

            const basePayload: Record<string, unknown> = {
                email: user.email || '',
                photoURL: user.photoURL || '',
                role: nextRole,
                lastLogin: serverTimestamp(),
            };

            if (resolvedName) {
                basePayload.name = resolvedName;
            }

            if (nextRole === 'student') {
                basePayload.customNameConfirmed = true;
                basePayload.grade = gradeValue;
                basePayload.class = classValue;
                basePayload.number = numberValue;
            }

            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    ...basePayload,
                    grade: nextRole === 'student' ? gradeValue : '',
                    class: nextRole === 'student' ? classValue : '',
                    number: nextRole === 'student' ? numberValue : '',
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
                <div className="text-5xl mb-4 animate-bounce">{interfaceConfig?.mainEmoji || '📚'}</div>
                <h1 className="text-6xl font-black tracking-tight mb-3">
                    <span className="text-blue-600">We</span><span className="text-amber-500">story</span>
                </h1>
                <p className="text-gray-500 text-xl font-medium mb-8">{interfaceConfig?.mainSubtitle || '우리가 써 내려가는 이야기'}</p>

                {currentUser ? (
                    <div className="flex flex-col items-center gap-3 w-full max-w-sm">
                        <p className="text-sm text-gray-500 break-all text-center px-2">{currentUser.email || '로그인 계정'}</p>
                        <button
                            onClick={goToDashboard}
                            className="w-full bg-blue-600 text-white border border-blue-600 px-6 py-3 rounded-full text-base font-bold shadow hover:bg-blue-700 transition"
                        >
                            계속하기
                        </button>
                        <button
                            onClick={() => handleLogin('student')}
                            className="w-full bg-white border border-gray-300 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition"
                        >
                            학생 로그인 (계정 선택)
                        </button>
                        <button
                            onClick={() => handleLogin('teacher')}
                            className="w-full bg-white border border-gray-300 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition"
                        >
                            관리자 로그인 (계정 선택)
                        </button>
                        <button
                            onClick={async () => {
                                clearRoleCache();
                                await signOut(auth);
                            }}
                            className="w-full bg-white border border-gray-200 px-6 py-3 rounded-full text-sm font-bold text-gray-700 shadow hover:bg-gray-50 transition"
                        >
                            다른 계정으로 로그인
                        </button>
                    </div>
                ) : (
                    <div className="w-full max-w-sm flex flex-col gap-3">
                        <button
                            onClick={() => handleLogin('student')}
                            className="w-full bg-white border border-gray-200 px-8 py-4 rounded-full text-lg font-bold text-gray-700 shadow hover:bg-gray-50 transition flex items-center justify-center gap-3"
                        >
                            <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" width={24} height={24} alt="Google" />
                            학생 로그인
                        </button>
                        <button
                            onClick={() => handleLogin('teacher')}
                            className="w-full bg-white border border-gray-300 px-8 py-4 rounded-full text-lg font-bold text-gray-700 shadow hover:bg-gray-50 transition flex items-center justify-center gap-3"
                        >
                            <i className="fas fa-chalkboard-teacher"></i>
                            관리자 로그인
                        </button>
                    </div>
                )}
            </div>

            <div className="absolute bottom-6 md:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs px-4 md:px-0 whitespace-nowrap">
                <button onClick={() => showPolicy('terms')} className="text-gray-400 hover:text-gray-600">이용 약관</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => showPolicy('privacy')} className="text-gray-400 hover:text-gray-600">개인정보 처리 방침</button>
            </div>

            <div className="fixed bottom-8 right-8 hidden lg:block z-30">
                <button
                    onClick={() => handleLogin('teacher')}
                    className="text-gray-500 hover:text-gray-800 text-sm font-bold px-3 py-2 rounded hover:bg-gray-200/60 transition"
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
                                <div dangerouslySetInnerHTML={{ __html: policyHtml }} />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Login;
