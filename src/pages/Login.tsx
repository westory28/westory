import React, { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

const TEACHER_EMAIL = 'westoria28@gmail.com';

const Login: React.FC = () => {
    const { currentUser, userData, config, interfaceConfig, loading } = useAuth();
    const navigate = useNavigate();
    const [loginMode, setLoginMode] = useState<'student' | 'teacher'>('student');

    useEffect(() => {
        if (loading || !currentUser) return;

        if (currentUser.email === TEACHER_EMAIL) {
            navigate(loginMode === 'teacher' ? '/teacher/dashboard' : '/student/dashboard');
            return;
        }

        if (userData?.role === 'teacher') {
            navigate('/teacher/dashboard');
            return;
        }

        if (userData?.role === 'student') {
            navigate('/student/dashboard');
        }
    }, [loading, currentUser, userData, loginMode, navigate]);

    const handleLogin = async (mode: 'student' | 'teacher') => {
        setLoginMode(mode);
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const isTeacher = user.email === TEACHER_EMAIL;

            if (mode === 'teacher' && !isTeacher) {
                alert('관리자 계정이 아닙니다.');
                await signOut(auth);
                return;
            }

            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    email: user.email,
                    name: user.displayName,
                    photoURL: user.photoURL,
                    role: isTeacher ? 'teacher' : 'student',
                    createdAt: serverTimestamp(),
                    lastLogin: serverTimestamp(),
                });
            } else {
                await setDoc(userRef, {
                    lastLogin: serverTimestamp(),
                }, { merge: true });
            }

            if (isTeacher && mode === 'teacher') navigate('/teacher/dashboard');
            else navigate('/student/dashboard');
        } catch (error) {
            console.error('Login failed', error);
            const code = (error as { code?: string })?.code || '';

            if (code === 'auth/unauthorized-domain') {
                alert('Firebase 인증 도메인에 localhost 또는 127.0.0.1이 등록되어야 합니다.');
                return;
            }
            if (code === 'auth/popup-blocked') {
                alert('브라우저에서 팝업이 차단되었습니다. 팝업 차단 해제 후 다시 시도해 주세요.');
                return;
            }
            if (code === 'auth/popup-closed-by-user') {
                alert('로그인 창이 닫혀 취소되었습니다. 다시 시도해 주세요.');
                return;
            }

            alert('로그인에 실패했습니다.');
        }
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4 relative">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden transform transition-all hover:scale-[1.01] duration-300">
                <div className="bg-blue-600 p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-500 to-indigo-600 opacity-90"></div>
                    <div className="relative z-10">
                        <div className="text-6xl mb-2 animate-bounce">{interfaceConfig?.mainEmoji || '📚'}</div>
                        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">Westory</h1>
                        <p className="text-blue-100 font-medium">{interfaceConfig?.mainSubtitle || '우리가 써 내려가는 이야기'}</p>
                    </div>
                </div>

                <div className="p-8">
                    <button
                        onClick={() => handleLogin('student')}
                        className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 font-bold py-3 px-4 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition transform active:scale-95 shadow-sm"
                    >
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                        <span>Google 계정으로 시작하기</span>
                    </button>

                    <div className="mt-8 text-center">
                        <p className="text-xs text-gray-400">
                            &copy; {config?.year || '2026'} Westory. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>

            <div className="mt-4">
                <button
                    onClick={() => handleLogin('teacher')}
                    className="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-100 transition"
                >
                    관리자 로그인
                </button>
            </div>
        </div>
    );
};

export default Login;
