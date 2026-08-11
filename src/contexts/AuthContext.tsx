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
import {
  STUDENT_MAINTENANCE_CONFIG_DOC_ID,
  normalizeStudentMaintenanceConfig,
  resolveStudentMaintenanceAccess,
  type StudentMaintenanceAccessStatus,
  type StudentMaintenanceConfig,
  type StudentMaintenanceConfigStatus,
  type UserProfileStatus,
} from "../lib/studentMaintenance";

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
  userProfileStatus: UserProfileStatus;
  studentMaintenanceConfig: StudentMaintenanceConfig | null;
  studentMaintenanceConfigStatus: StudentMaintenanceConfigStatus;
  studentMaintenanceAccessStatus: StudentMaintenanceAccessStatus;
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
  const [userProfileStatus, setUserProfileStatus] =
    useState<UserProfileStatus>("idle");
  const [studentMaintenanceConfig, setStudentMaintenanceConfig] =
    useState<StudentMaintenanceConfig | null>(null);
  const [studentMaintenanceConfigStatus, setStudentMaintenanceConfigStatus] =
    useState<StudentMaintenanceConfigStatus>("idle");
  const firstUserDocReadyRef = useRef<string | null>(null);
  const systemConfigLoadRef = useRef<Promise<void> | null>(null);
  const menuConfigLoadRef = useRef<Promise<void> | null>(null);

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
      systemConfigLoadRef.current = null;
      setConfig(null);
      setConfigReady(false);
      setConfigLoadedAt(0);
      return;
    }

    if (systemConfigLoadRef.current) {
      return systemConfigLoadRef.current;
    }

    const promise = (async () => {
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
      } finally {
        systemConfigLoadRef.current = null;
      }
    })();

    systemConfigLoadRef.current = promise;
    return promise;
  }, []);

  const loadAuthedMenuConfig = useCallback(async (user: User | null) => {
    if (!user) {
      menuConfigLoadRef.current = null;
      setMenuConfig(null);
      setMenuConfigReady(false);
      setMenuConfigLoadedAt(0);
      return;
    }

    if (menuConfigLoadRef.current) {
      return menuConfigLoadRef.current;
    }

    const promise = (async () => {
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
      } finally {
        menuConfigLoadRef.current = null;
      }
    })();

    menuConfigLoadRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    void loadPublicInterfaceConfig();
  }, [loadPublicInterfaceConfig]);

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    let unsubscribeUserDoc: (() => void) | null = null;
    let unsubscribeMaintenanceDoc: (() => void) | null = null;
    let maintenanceGuard: number | null = null;
    let profileGuard: number | null = null;
    const authGuard = window.setTimeout(() => {
      setLoading(false);
    }, 15000);

    void authPersistenceReady.catch((e) => {
      console.warn("Auth persistence init fallback", e);
    });

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        window.clearTimeout(authGuard);
        markLoginPerf("westory-auth-current-user-resolved", {
          hasUser: user ? "true" : "false",
        });
        measureLoginPerf(
          "westory-auth-init",
          "westory-app-load-start",
          "westory-auth-current-user-resolved",
        );
        setCurrentUser(user);
        setUserData(null);
        if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
          unsubscribeUserDoc = null;
        }
        if (unsubscribeMaintenanceDoc) {
          unsubscribeMaintenanceDoc();
          unsubscribeMaintenanceDoc = null;
        }
        if (maintenanceGuard !== null) {
          window.clearTimeout(maintenanceGuard);
          maintenanceGuard = null;
        }
        if (profileGuard !== null) {
          window.clearTimeout(profileGuard);
          profileGuard = null;
        }
        if (user) {
          setLoading(true);
          firstUserDocReadyRef.current = null;
          setUserProfileStatus("loading");
          setStudentMaintenanceConfig(null);
          setStudentMaintenanceConfigStatus("loading");
          setConfig(null);
          setConfigReady(false);
          setConfigLoadedAt(0);
          setMenuConfig(null);
          setMenuConfigReady(false);
          setMenuConfigLoadedAt(0);

          maintenanceGuard = window.setTimeout(() => {
            setStudentMaintenanceConfigStatus((status) =>
              status === "loading" ? "error" : status,
            );
          }, 15000);
          profileGuard = window.setTimeout(() => {
            setUserData(null);
            setUserProfileStatus("error");
            setLoading(false);
          }, 15000);

          unsubscribeMaintenanceDoc = onSnapshot(
            doc(db, "site_settings", STUDENT_MAINTENANCE_CONFIG_DOC_ID),
            { includeMetadataChanges: true },
            (maintenanceSnap) => {
              if (maintenanceSnap.metadata.fromCache) return;
              if (maintenanceGuard !== null) {
                window.clearTimeout(maintenanceGuard);
                maintenanceGuard = null;
              }
              try {
                setStudentMaintenanceConfig(
                  normalizeStudentMaintenanceConfig(
                    maintenanceSnap.exists()
                      ? (maintenanceSnap.data() as Record<string, unknown>)
                      : null,
                  ),
                );
                setStudentMaintenanceConfigStatus("ready");
              } catch (error) {
                console.error("Invalid maintenance config", error);
                setStudentMaintenanceConfig(null);
                setStudentMaintenanceConfigStatus("error");
              }
            },
            (e) => {
              console.error("Failed to subscribe maintenance config", e);
              if (maintenanceGuard !== null) {
                window.clearTimeout(maintenanceGuard);
                maintenanceGuard = null;
              }
              setStudentMaintenanceConfig(null);
              setStudentMaintenanceConfigStatus("error");
            },
          );

          const userRef = doc(db, "users", user.uid);
          unsubscribeUserDoc = onSnapshot(
            userRef,
            { includeMetadataChanges: true },
            (userSnap) => {
              if (userSnap.metadata.fromCache) return;
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
                  const hasKnownRole =
                    raw.role === "teacher" ||
                    raw.role === "staff" ||
                    raw.role === "student";
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
                  setUserProfileStatus(hasKnownRole ? "ready" : "malformed");
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
                  setUserProfileStatus("missing");
                }
                if (profileGuard !== null) {
                  window.clearTimeout(profileGuard);
                  profileGuard = null;
                }
                setLoading(false);
              } catch (e) {
                console.error("Failed to sync user data", e);
                setUserData(null);
                setUserProfileStatus("error");
                setLoading(false);
                if (profileGuard !== null) {
                  window.clearTimeout(profileGuard);
                  profileGuard = null;
                }
              }
            },
            (e) => {
              console.error("Failed to subscribe user data", e);
              setUserData(null);
              setUserProfileStatus("error");
              setLoading(false);
              if (profileGuard !== null) {
                window.clearTimeout(profileGuard);
                profileGuard = null;
              }
            },
          );
        } else {
          firstUserDocReadyRef.current = null;
          setUserData(null);
          setUserProfileStatus("idle");
          setStudentMaintenanceConfig(null);
          setStudentMaintenanceConfigStatus("idle");
          setConfig(null);
          setConfigReady(false);
          setConfigLoadedAt(0);
          setMenuConfig(null);
          setMenuConfigReady(false);
          setMenuConfigLoadedAt(0);
          setLoading(false);
        }
      },
      (e) => {
        console.error("Failed to initialize auth listener", e);
        setLoading(false);
        window.clearTimeout(authGuard);
      },
    );

    return () => {
      window.clearTimeout(authGuard);
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
      if (unsubscribeMaintenanceDoc) {
        unsubscribeMaintenanceDoc();
      }
      if (maintenanceGuard !== null) {
        window.clearTimeout(maintenanceGuard);
      }
      if (profileGuard !== null) {
        window.clearTimeout(profileGuard);
      }
      unsubscribe();
    };
  }, []);

  const studentMaintenanceAccessStatus = resolveStudentMaintenanceAccess({
    currentUser,
    userData,
    profileStatus: userProfileStatus,
    config: studentMaintenanceConfig,
    configStatus: studentMaintenanceConfigStatus,
  });

  useEffect(() => {
    if (currentUser && studentMaintenanceAccessStatus !== "allowed") {
      systemConfigLoadRef.current = null;
      menuConfigLoadRef.current = null;
      if (config !== null) setConfig(null);
      if (configReady) setConfigReady(false);
      if (configLoadedAt !== 0) setConfigLoadedAt(0);
      if (menuConfig !== null) setMenuConfig(null);
      if (menuConfigReady) setMenuConfigReady(false);
      if (menuConfigLoadedAt !== 0) setMenuConfigLoadedAt(0);
    }
    if (
      !loading &&
      currentUser &&
      studentMaintenanceAccessStatus === "allowed" &&
      !configReady
    ) {
      void loadAuthedSystemConfig(currentUser);
    }
    if (
      !loading &&
      currentUser &&
      studentMaintenanceAccessStatus === "allowed" &&
      !menuConfigReady
    ) {
      void loadAuthedMenuConfig(currentUser);
    }
    if (!interfaceConfig) {
      void loadPublicInterfaceConfig();
    }
  }, [
    configReady,
    config,
    configLoadedAt,
    currentUser,
    interfaceConfig,
    loadAuthedMenuConfig,
    loadAuthedSystemConfig,
    loadPublicInterfaceConfig,
    loading,
    menuConfig,
    menuConfigLoadedAt,
    menuConfigReady,
    studentMaintenanceAccessStatus,
  ]);

  useEffect(
    () =>
      subscribeSystemConfigUpdated(() => {
        if (auth.currentUser && studentMaintenanceAccessStatus === "allowed") {
          invalidateSiteSettingDocCache("config");
          void loadAuthedSystemConfig(auth.currentUser);
        }
      }),
    [loadAuthedSystemConfig, studentMaintenanceAccessStatus],
  );

  useEffect(
    () =>
      subscribeMenuConfigUpdated(() => {
        if (auth.currentUser && studentMaintenanceAccessStatus === "allowed") {
          invalidateSiteSettingDocCache("menu_config");
          void loadAuthedMenuConfig(auth.currentUser);
        }
      }),
    [loadAuthedMenuConfig, studentMaintenanceAccessStatus],
  );

  const logout = async () => {
    await signOut(auth);
  };

  const refreshConfig = useCallback(async () => {
    invalidateSiteSettingDocCache("config");
    systemConfigLoadRef.current = null;
    await loadAuthedSystemConfig(currentUser);
  }, [currentUser, loadAuthedSystemConfig]);

  const refreshMenuConfig = useCallback(async () => {
    invalidateSiteSettingDocCache("menu_config");
    menuConfigLoadRef.current = null;
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
    userProfileStatus,
    studentMaintenanceConfig,
    studentMaintenanceConfigStatus,
    studentMaintenanceAccessStatus,
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
