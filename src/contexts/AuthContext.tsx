import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { SystemConfig, InterfaceConfig, UserData } from '../types';

interface AuthContextType {
    currentUser: User | null;
    userData: UserData | null;
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
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                try {
                    const userSnap = await getDoc(doc(db, 'users', user.uid));
                    if (userSnap.exists()) {
                        setUserData(userSnap.data() as UserData);
                    }
                } catch (e) {
                    console.error("Failed to fetch user data", e);
                }
            } else {
                setUserData(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const logout = async () => {
        await signOut(auth);
    };

    const value = {
        currentUser,
        userData,
        config,
        interfaceConfig,
        loading,
        logout
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
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
