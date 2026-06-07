import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { User, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, authPersistenceReady, db } from "../lib/firebase";
import { SystemConfig, InterfaceConfig, UserData } from "../types";
import {
  cloneDefaultMenus,
  sanitizeMenuConfig,
  type MenuConfig,
} from "../constants/menus";
import { normalizeStaffPermissions } from "../lib/permissions";
import { markLoginPerf, measureLoginPerf } from "../lib/loginPerf";
import {
  invalidateSiteSettingDocCache,
  readFreshSiteSettingDoc,
  readSiteSettingDoc,
} from "../lib/siteSettings";
import {
  subscribeMenuConfigUpdated,
  subscribeSystemConfigUpdated,
} from "../lib/appEvents";

interface AuthContextType {
  // Backward-compatible alias for legacy pages.
  user: User | null;
  currentUser: User | null;
  userData: UserData | null;
  // Backward-compatible alias for legacy pages.
  userConfig: SystemConfig | null;
  config: SystemConfig | null;
  configReady: boolean;
  menuConfig: MenuConfig | null;
  menuConfigReady: boolean;
  settingsLoadedAt: number;
  interfaceConfig: InterfaceConfig | null;
  loading: boolean;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  refreshMenuConfig: () => Promise<void>;
  refreshInterfaceConfig: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  year: "2026",
  semester: "1",
  showQuiz: true,
  showScore: true,
  showLesson: true,
};

const normalizeSystemConfig = (raw: SystemConfig | null): SystemConfig => {
  const year = String(raw?.year || "").trim();
  const semester = String(raw?.semester || "").trim();

  return {
    year: /^\d{4}$/.test(year) ? year : DEFAULT_SYSTEM_CONFIG.year,
    semester: semester === "2" ? "2" : DEFAULT_SYSTEM_CONFIG.semester,
    showQuiz: raw?.showQuiz !== false,
    showScore: raw?.showScore !== false,
    showLesson: raw?.showLesson !== false,
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [configLoadedAt, setConfigLoadedAt] = useState(0);
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const [menuConfigReady, setMenuConfigReady] = useState(false);
  const [menuConfigLoadedAt, setMenuConfigLoadedAt] = useState(0);
  const [interfaceConfig, setInterfaceConfig] =
    useState<InterfaceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const firstUserDocReadyRef = useRef<string | null>(null);

  const loadPublicInterfaceConfig = useCallback(async () => {
    try {
      const data =
        await readSiteSettingDoc<InterfaceConfig>("interface_config");
      setInterfaceConfig(data);
      markLoginPerf("westory-interface-config-ready");
    } catch (e) {
      console.error("Failed to load interface config", e);
    }
  }, []);

  const loadAuthedSystemConfig = useCallback(async (user: User | null) => {
    if (!user) {
      setConfig(null);
      setConfigReady(false);
      setConfigLoadedAt(0);
      return;
    }

    try {
      const data = await readFreshSiteSettingDoc<SystemConfig>("config");
      setConfig(normalizeSystemConfig(data));
      setConfigReady(true);
      setConfigLoadedAt(Date.now());
      markLoginPerf("westory-auth-config-ready");
    } catch (e) {
      console.error("Failed to load system config", e);
      setConfig(null);
      setConfigReady(true);
      setConfigLoadedAt(Date.now());
    }
  }, []);

  const loadAuthedMenuConfig = useCallback(async (user: User | null) => {
    if (!user) {
      setMenuConfig(null);
      setMenuConfigReady(false);
      setMenuConfigLoadedAt(0);
      return;
    }

    try {
      const data = await readFreshSiteSettingDoc<MenuConfig>("menu_config");
      setMenuConfig(data ? sanitizeMenuConfig(data) : cloneDefaultMenus());
      setMenuConfigReady(true);
      setMenuConfigLoadedAt(Date.now());
    } catch (e) {
      console.error("Failed to load menu config", e);
      setMenuConfig(null);
      setMenuConfigReady(true);
      setMenuConfigLoadedAt(Date.now());
    }
  }, []);

  useEffect(() => {
    void loadPublicInterfaceConfig();
  }, [loadPublicInterfaceConfig]);

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    let unsubscribeUserDoc: (() => void) | null = null;
    let visibilitySettingsReady: Promise<void> | null = null;
    const loadingGuard = window.setTimeout(() => {
      setLoading(false);
    }, 15000);

    void authPersistenceReady.catch((e) => {
      console.warn("Auth persistence init fallback", e);
    });

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        markLoginPerf("westory-auth-current-user-resolved", {
          hasUser: user ? "true" : "false",
        });
        measureLoginPerf(
          "westory-auth-init",
          "westory-app-load-start",
          "westory-auth-current-user-resolved",
        );
        setCurrentUser(user);
        if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
          unsubscribeUserDoc = null;
        }
        if (user) {
          firstUserDocReadyRef.current = null;
          setConfigReady(false);
          setMenuConfigReady(false);
          visibilitySettingsReady = Promise.all([
            loadAuthedSystemConfig(user),
            loadAuthedMenuConfig(user),
          ]).then(() => undefined);
          const userRef = doc(db, "users", user.uid);
          unsubscribeUserDoc = onSnapshot(
            userRef,
            async (userSnap) => {
              try {
                const normalizedRole: UserData["role"] = "student";
                if (firstUserDocReadyRef.current !== user.uid) {
                  firstUserDocReadyRef.current = user.uid;
                  markLoginPerf("westory-auth-user-doc-ready", {
                    exists: userSnap.exists() ? "true" : "false",
                  });
                  measureLoginPerf(
                    "westory-auth-user-doc-sync",
                    "westory-auth-current-user-resolved",
                    "westory-auth-user-doc-ready",
                  );
                }
                if (userSnap.exists()) {
                  const raw = userSnap.data() as UserData;
                  setUserData({
                    ...raw,
                    uid: user.uid,
                    role:
                      raw.role === "teacher"
                        ? "teacher"
                        : raw.role === "staff"
                          ? "staff"
                          : normalizedRole,
                    staffPermissions: normalizeStaffPermissions(
                      raw.staffPermissions,
                    ),
                    teacherPortalEnabled: raw.teacherPortalEnabled === true,
                  });
                } else {
                  const bootstrapUser: UserData = {
                    uid: user.uid,
                    email: user.email || "",
                    name: "",
                    customNameConfirmed: false,
                    role: normalizedRole,
                    staffPermissions: [],
                    teacherPortalEnabled: false,
                    grade: "",
                    class: "",
                    number: "",
                  };
                  setUserData(bootstrapUser);
                }
                await visibilitySettingsReady;
                setLoading(false);
                window.clearTimeout(loadingGuard);
              } catch (e) {
                console.error("Failed to sync user data", e);
                setLoading(false);
                window.clearTimeout(loadingGuard);
              }
            },
            (e) => {
              console.error("Failed to subscribe user data", e);
              setLoading(false);
              window.clearTimeout(loadingGuard);
            },
          );
        } else {
          firstUserDocReadyRef.current = null;
          setUserData(null);
          setConfig(null);
          setConfigReady(false);
          setConfigLoadedAt(0);
          setMenuConfig(null);
          setMenuConfigReady(false);
          setMenuConfigLoadedAt(0);
          visibilitySettingsReady = null;
          setLoading(false);
          window.clearTimeout(loadingGuard);
        }
      },
      (e) => {
        console.error("Failed to initialize auth listener", e);
        setLoading(false);
        window.clearTimeout(loadingGuard);
      },
    );

    return () => {
      window.clearTimeout(loadingGuard);
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
      unsubscribe();
    };
  }, [loadAuthedMenuConfig, loadAuthedSystemConfig]);

  useEffect(() => {
    if (!loading && currentUser && !configReady) {
      void loadAuthedSystemConfig(currentUser);
    }
    if (!loading && currentUser && !menuConfigReady) {
      void loadAuthedMenuConfig(currentUser);
    }
    if (!interfaceConfig) {
      void loadPublicInterfaceConfig();
    }
  }, [
    configReady,
    currentUser,
    interfaceConfig,
    loadAuthedMenuConfig,
    loadAuthedSystemConfig,
    loadPublicInterfaceConfig,
    menuConfigReady,
  ]);

  useEffect(
    () =>
      subscribeSystemConfigUpdated(() => {
        if (auth.currentUser) {
          invalidateSiteSettingDocCache("config");
          void loadAuthedSystemConfig(auth.currentUser);
        }
      }),
    [],
  );

  useEffect(
    () =>
      subscribeMenuConfigUpdated(() => {
        if (auth.currentUser) {
          invalidateSiteSettingDocCache("menu_config");
          void loadAuthedMenuConfig(auth.currentUser);
        }
      }),
    [],
  );

  const logout = async () => {
    await signOut(auth);
  };

  const refreshConfig = useCallback(async () => {
    invalidateSiteSettingDocCache("config");
    await loadAuthedSystemConfig(currentUser);
  }, [currentUser, loadAuthedSystemConfig]);

  const refreshMenuConfig = useCallback(async () => {
    invalidateSiteSettingDocCache("menu_config");
    await loadAuthedMenuConfig(currentUser);
  }, [currentUser, loadAuthedMenuConfig]);

  const refreshInterfaceConfig = useCallback(async () => {
    invalidateSiteSettingDocCache("interface_config");
    await loadPublicInterfaceConfig();
  }, [loadPublicInterfaceConfig]);

  const settingsLoadedAt =
    configReady && menuConfigReady
      ? Math.min(configLoadedAt || 0, menuConfigLoadedAt || 0)
      : 0;

  const value = {
    user: currentUser,
    currentUser,
    userData,
    userConfig: config,
    config,
    configReady,
    menuConfig,
    menuConfigReady,
    settingsLoadedAt,
    interfaceConfig,
    loading,
    logout,
    refreshConfig,
    refreshMenuConfig,
    refreshInterfaceConfig,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
