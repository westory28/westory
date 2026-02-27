import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { SystemConfig, InterfaceConfig, UserData } from '../types';

interface AuthContextType {
    // Backward-compatible alias for legacy pages.
    user: User | null;
    currentUser: User | null;
    userData: UserData | null;
    // Backward-compatible alias for legacy pages.
    userConfig: SystemConfig | null;
    config: SystemConfig | null;
    interfaceConfig: InterfaceConfig | null;
    loading: boolean;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [config, setConfig] = useState<SystemConfig | null>(null);
    const [interfaceConfig, setInterfaceConfig] = useState<InterfaceConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const loadConfig = async () => {
        try {
            const configSnap = await getDoc(doc(db, 'site_settings', 'config'));
            const interfaceSnap = await getDoc(doc(db, 'site_settings', 'interface_config'));

            if (configSnap.exists()) {
                setConfig(configSnap.data() as SystemConfig);
            }
            if (interfaceSnap.exists()) {
                setInterfaceConfig(interfaceSnap.data() as InterfaceConfig);
            }
        } catch (e) {
            console.error("Failed to load configs", e);
        }
    };

    useEffect(() => {
        void loadConfig();
    }, []);

    useEffect(() => {
        let unsubscribe: () => void = () => undefined;
        let unsubscribeUserDoc: (() => void) | null = null;
        const loadingGuard = window.setTimeout(() => {
            setLoading(false);
        }, 5000);

        try {
            unsubscribe = onAuthStateChanged(auth, (user) => {
                setCurrentUser(user);
                if (unsubscribeUserDoc) {
                    unsubscribeUserDoc();
                    unsubscribeUserDoc = null;
                }
                if (user) {
                    const userRef = doc(db, 'users', user.uid);
                    unsubscribeUserDoc = onSnapshot(
                        userRef,
                        async (userSnap) => {
                            try {
                                const normalizedRole: UserData['role'] = 'student';
                                if (userSnap.exists()) {
                                    const raw = userSnap.data() as UserData;
                                    setUserData({
                                        ...raw,
                                        uid: user.uid,
                                        role: raw.role === 'teacher' ? 'teacher' : normalizedRole,
                                    });
                                } else {
                                    const bootstrapUser: UserData = {
                                        uid: user.uid,
                                        email: user.email || '',
                                        name: '',
                                        customNameConfirmed: false,
                                        role: normalizedRole,
                                        grade: '',
                                        class: '',
                                        number: '',
                                    };
                                    await setDoc(userRef, {
                                        ...bootstrapUser,
                                        createdAt: serverTimestamp(),
                                        lastLogin: serverTimestamp(),
                                    }, { merge: true });
                                    setUserData(bootstrapUser);
                                }
                            } catch (e) {
                                console.error("Failed to sync user data", e);
                            } finally {
                                setLoading(false);
                                window.clearTimeout(loadingGuard);
                            }
                        },
                        (e) => {
                            console.error("Failed to subscribe user data", e);
                            setLoading(false);
                            window.clearTimeout(loadingGuard);
                        }
                    );
                } else {
                    setUserData(null);
                    setLoading(false);
                    window.clearTimeout(loadingGuard);
                }
            });
        } catch (e) {
            console.error("Failed to initialize auth listener", e);
            setLoading(false);
            window.clearTimeout(loadingGuard);
        }

        return () => {
            window.clearTimeout(loadingGuard);
            if (unsubscribeUserDoc) {
                unsubscribeUserDoc();
            }
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!currentUser) return;
        if (config && interfaceConfig) return;
        void loadConfig();
    }, [currentUser, config, interfaceConfig]);

    const logout = async () => {
        await signOut(auth);
    };

    const value = {
        user: currentUser,
        currentUser,
        userData,
        userConfig: config,
        config,
        interfaceConfig,
        loading,
        logout
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
