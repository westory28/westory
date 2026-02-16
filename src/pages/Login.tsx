import React, { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

const TEACHER_EMAIL = 'westoria28@gmail.com';

const Login: React.FC = () => {
    const { currentUser, userData, interfaceConfig, loading } = useAuth();
    const navigate = useNavigate();
    const [loginMode, setLoginMode] = useState<'student' | 'teacher'>('student');
    const [policyOpen, setPolicyOpen] = useState(false);
    const [policyTitle, setPolicyTitle] = useState('');
    const [policyBody, setPolicyBody] = useState('불러오는 중...');

    useEffect(() => {
        if (loading || !currentUser) return;

        const isTeacher = currentUser.email === TEACHER_EMAIL || userData?.role === 'teacher';
        if (isTeacher && loginMode === 'teacher') navigate('/teacher/dashboard');
        else navigate('/student/dashboard');
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
                const prev = userSnap.data() as { role?: string };
                await setDoc(userRef, {
                    lastLogin: serverTimestamp(),
                    role: isTeacher ? 'teacher' : (prev.role || 'student'),
                }, { merge: true });
            }

            if (isTeacher && mode === 'teacher') navigate('/teacher/dashboard');
            else navigate('/student/dashboard');
        } catch (error) {
            console.error('Login failed', error);
            alert('로그인에 실패했습니다.');
        }
    };

    const showPolicy = async (type: 'terms' | 'privacy') => {
        setPolicyOpen(true);
        setPolicyTitle(type === 'terms' ? '이용 약관' : '개인정보 처리 방침');
        setPolicyBody('불러오는 중...');
        try {
            const snap = await getDoc(doc(db, 'site_settings', type));
            setPolicyBody(snap.exists() ? ((snap.data() as { text?: string }).text || '등록된 내용이 없습니다.') : '등록된 내용이 없습니다.');
        } catch (e) {
            console.error('Policy load error:', e);
            setPolicyBody('내용을 불러오지 못했습니다.');
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    return (
        <div className="min-h-screen bg-gray-50 relative">
            <div className="h-screen flex flex-col items-center justify-center px-4">
                <div className="text-5xl mb-4 animate-bounce">{interfaceConfig?.mainEmoji || '📚'}</div>
                <h1 className="text-6xl font-black tracking-tight mb-2">
                    <span className="text-blue-600">We</span><span className="text-amber-500">story</span>
                </h1>
                <p className="text-gray-500 text-xl font-medium mb-10">{interfaceConfig?.mainSubtitle || '우리가 써 내려가는 이야기'}</p>

                <button
                    onClick={() => handleLogin('student')}
                    className="bg-white border border-gray-200 px-10 py-4 rounded-full text-lg font-bold text-gray-700 shadow hover:bg-gray-50 transition flex items-center gap-3"
                >
                    <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" width={24} height={24} alt="Google" />
                    Google 계정으로 시작하기
                </button>
            </div>

            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs">
                <button onClick={() => showPolicy('terms')} className="text-gray-400 hover:text-gray-600">이용 약관</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => showPolicy('privacy')} className="text-gray-400 hover:text-gray-600">개인정보 처리 방침</button>
            </div>

            <div className="absolute bottom-8 right-8">
                <button onClick={() => handleLogin('teacher')} className="text-gray-400 hover:text-gray-700 text-xs font-semibold px-3 py-2 rounded hover:bg-gray-200/60 transition">
                    <i className="fas fa-chalkboard-teacher mr-1"></i>
                    관리자 로그인
                </button>
            </div>

            {policyOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4" onClick={() => setPolicyOpen(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="font-bold text-lg">{policyTitle}</h2>
                            <button onClick={() => setPolicyOpen(false)} className="text-gray-400 hover:text-gray-700"><i className="fas fa-times"></i></button>
                        </div>
                        <div className="p-5 text-sm text-gray-700 overflow-auto whitespace-pre-wrap">{policyBody}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Login;
