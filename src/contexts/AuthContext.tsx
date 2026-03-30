import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, authPersistenceReady, db } from '../lib/firebase';
import { SystemConfig, InterfaceConfig, UserData } from '../types';
import { normalizeStaffPermissions } from '../lib/permissions';
import { markLoginPerf, measureLoginPerf } from '../lib/loginPerf';
import { readSiteSettingDoc } from '../lib/siteSettings';
import { subscribeSystemConfigUpdated } from '../lib/appEvents';

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
    refreshConfig: () => Promise<void>;
    refreshInterfaceConfig: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [config, setConfig] = useState<SystemConfig | null>(null);
    const [interfaceConfig, setInterfaceConfig] = useState<InterfaceConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const firstUserDocReadyRef = useRef<string | null>(null);

    const loadPublicInterfaceConfig = async () => {
        try {
            const data = await readSiteSettingDoc<InterfaceConfig>('interface_config');
            setInterfaceConfig(data);
            markLoginPerf('westory-interface-config-ready');
        } catch (e) {
            console.error("Failed to load interface config", e);
        }
    };

    const loadAuthedSystemConfig = async (user: User | null = currentUser) => {
        if (!user) {
            setConfig(null);
            return;
        }

        try {
            const data = await readSiteSettingDoc<SystemConfig>('config');
            setConfig(data);
            markLoginPerf('westory-auth-config-ready');
        } catch (e) {
            console.error("Failed to load system config", e);
        }
    };

    useEffect(() => {
        void loadPublicInterfaceConfig();
    }, []);

    useEffect(() => {
        let unsubscribe: () => void = () => undefined;
        let unsubscribeUserDoc: (() => void) | null = null;
        const loadingGuard = window.setTimeout(() => {
            setLoading(false);
        }, 15000);

        void authPersistenceReady.catch((e) => {
            console.warn("Auth persistence init fallback", e);
        });

        unsubscribe = onAuthStateChanged(auth, (user) => {
            markLoginPerf('westory-auth-current-user-resolved', {
                hasUser: user ? 'true' : 'false',
            });
            measureLoginPerf(
                'westory-auth-init',
                'westory-app-load-start',
                'westory-auth-current-user-resolved',
            );
            setCurrentUser(user);
            if (unsubscribeUserDoc) {
                unsubscribeUserDoc();
                unsubscribeUserDoc = null;
            }
            if (user) {
                firstUserDocReadyRef.current = null;
                void loadAuthedSystemConfig(user);
                setLoading(false);
                window.clearTimeout(loadingGuard);
                const userRef = doc(db, 'users', user.uid);
                unsubscribeUserDoc = onSnapshot(
                    userRef,
                    async (userSnap) => {
                        try {
                            const normalizedRole: UserData['role'] = 'student';
                            if (firstUserDocReadyRef.current !== user.uid) {
                                firstUserDocReadyRef.current = user.uid;
                                markLoginPerf('westory-auth-user-doc-ready', {
                                    exists: userSnap.exists() ? 'true' : 'false',
                                });
                                measureLoginPerf(
                                    'westory-auth-user-doc-sync',
                                    'westory-auth-current-user-resolved',
                                    'westory-auth-user-doc-ready',
                                );
                            }
                            if (userSnap.exists()) {
                                const raw = userSnap.data() as UserData;
                                setUserData({
                                    ...raw,
                                    uid: user.uid,
                                    role: raw.role === 'teacher'
                                        ? 'teacher'
                                        : raw.role === 'staff'
                                            ? 'staff'
                                            : normalizedRole,
                                    staffPermissions: normalizeStaffPermissions(raw.staffPermissions),
                                    teacherPortalEnabled: raw.teacherPortalEnabled === true,
                                });
                            } else {
                                const bootstrapUser: UserData = {
                                    uid: user.uid,
                                    email: user.email || '',
                                    name: '',
                                    customNameConfirmed: false,
                                    role: normalizedRole,
                                    staffPermissions: [],
                                    teacherPortalEnabled: false,
                                    grade: '',
                                    class: '',
                                    number: '',
                                };
                                setUserData(bootstrapUser);
                            }
                        } catch (e) {
                            console.error("Failed to sync user data", e);
                        }
                    },
                    (e) => {
                        console.error("Failed to subscribe user data", e);
                    }
                );
            } else {
                firstUserDocReadyRef.current = null;
                setUserData(null);
                setConfig(null);
                setLoading(false);
                window.clearTimeout(loadingGuard);
            }
        }, (e) => {
            console.error("Failed to initialize auth listener", e);
            setLoading(false);
            window.clearTimeout(loadingGuard);
        });

        return () => {
            window.clearTimeout(loadingGuard);
            if (unsubscribeUserDoc) {
                unsubscribeUserDoc();
            }
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (currentUser && !config) {
            void loadAuthedSystemConfig(currentUser);
        }
        if (!interfaceConfig) {
            void loadPublicInterfaceConfig();
        }
    }, [currentUser, config, interfaceConfig]);

    useEffect(() => subscribeSystemConfigUpdated(() => {
        if (auth.currentUser) {
            void loadAuthedSystemConfig(auth.currentUser);
        }
    }), []);

    const logout = async () => {
        await signOut(auth);
    };

    const refreshConfig = async () => {
        await loadAuthedSystemConfig(currentUser);
    };

    const refreshInterfaceConfig = async () => {
        await loadPublicInterfaceConfig();
    };

    const value = {
        user: currentUser,
        currentUser,
        userData,
        userConfig: config,
        config,
        interfaceConfig,
        loading,
        logout,
        refreshConfig,
        refreshInterfaceConfig,
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
