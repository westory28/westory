import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { SystemConfig, InterfaceConfig, UserData } from '../types';

const TEACHER_EMAIL = 'westoria28@gmail.com';

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

    useEffect(() => {
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

        loadConfig();
    }, []);

    useEffect(() => {
        let unsubscribe: () => void = () => undefined;
        const loadingGuard = window.setTimeout(() => {
            setLoading(false);
        }, 5000);

        try {
            unsubscribe = onAuthStateChanged(auth, async (user) => {
                setCurrentUser(user);
                if (user) {
                    try {
                        const userSnap = await getDoc(doc(db, 'users', user.uid));
                        if (userSnap.exists()) {
                            const raw = userSnap.data() as UserData;
                            const normalizedRole = user.email === TEACHER_EMAIL ? 'teacher' : raw.role;
                            setUserData({ ...raw, role: normalizedRole });
                        }
                    } catch (e) {
                        console.error("Failed to fetch user data", e);
                    }
                } else {
                    setUserData(null);
                }
                setLoading(false);
                window.clearTimeout(loadingGuard);
            });
        } catch (e) {
            console.error("Failed to initialize auth listener", e);
            setLoading(false);
            window.clearTimeout(loadingGuard);
        }

        return () => {
            window.clearTimeout(loadingGuard);
            unsubscribe();
        };
    }, []);

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
