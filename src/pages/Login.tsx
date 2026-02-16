import React, { useEffect } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
    const { currentUser, userData, config, interfaceConfig, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && currentUser && userData) {
            if (userData.role === 'teacher') {
                navigate('/teacher/dashboard');
            } else {
                navigate('/student/dashboard');
            }
        }
    }, [currentUser, userData, loading, navigate]);

    const handleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                // New user - default to student
                await setDoc(userRef, {
                    email: user.email,
                    name: user.displayName,
                    photoURL: user.photoURL,
                    role: 'student',
                    createdAt: serverTimestamp(),
                    lastLogin: serverTimestamp()
                });
            } else {
                await setDoc(userRef, {
                    lastLogin: serverTimestamp()
                }, { merge: true });
            }
        } catch (error) {
            console.error("Login failed", error);
            alert("로그인에 실패했습니다.");
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
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
                    <div className="space-y-4">
                        <button
                            onClick={handleLogin}
                            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 font-bold py-3 px-4 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition transform active:scale-95 shadow-sm"
                        >
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                            <span>Google 계정으로 시작하기</span>
                        </button>
                    </div>

                    <div className="mt-8 text-center">
                        <p className="text-xs text-gray-400">
                            &copy; {config?.year || '2026'} Westory. All rights reserved.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
