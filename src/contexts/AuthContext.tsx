import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { User, onIdTokenChanged, signOut } from "firebase/auth";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { auth, authPersistenceReady, db } from "../lib/firebase";
import { SystemConfig, InterfaceConfig, UserData } from "../types";
import {
  cloneDefaultMenus,
  sanitizeMenuConfig,
  type MenuConfig,
} from "../constants/menus";
import {
  isAllowedWestoryEmail,
  normalizeStaffPermissions,
} from "../lib/permissions";
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
  closeApplicationSession,
  subscribeApplicationSessionAuthorityMode,
  synchronizeApplicationSession,
  type ApplicationSessionAuthorityMode,
} from "../lib/applicationSession";
import {
  clearSessionTiming,
  NORMAL_SESSION_DURATION_MS,
  writeSessionDeadline,
} from "../lib/sessionPolicy";
import {
  STUDENT_MAINTENANCE_CONFIG_DOC_ID,
  normalizeStudentMaintenanceConfig,
  readStudentMaintenanceBootstrap,
  resolveStudentMaintenanceAccess,
  type StudentMaintenanceAccessStatus,
  type StudentMaintenanceConfig,
} from "../lib/studentMaintenance";

export type AuthenticationStatus =
  | "UNKNOWN"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "MAINTENANCE"
  | "ANONYMOUS"
  | "SESSION_EXPIRED"
  | "ERROR";

export type LogoutReason = "manual" | "expired";

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
  authenticationStatus: AuthenticationStatus;
  authenticationError: string;
  applicationSessionAuthorityMode: ApplicationSessionAuthorityMode | null;
  studentMaintenanceConfig: StudentMaintenanceConfig | null;
  studentMaintenanceAccessStatus: StudentMaintenanceAccessStatus;
  loading: boolean;
  prepareForReauthentication: () => void;
  logout: (reason?: LogoutReason) => Promise<void>;
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
  const [authenticationStatus, setAuthenticationStatus] =
    useState<AuthenticationStatus>("UNKNOWN");
  const [authenticationError, setAuthenticationError] = useState("");
  const [applicationSessionAuthorityMode, setApplicationSessionAuthorityMode] =
    useState<ApplicationSessionAuthorityMode | null>(null);
  const [studentMaintenanceConfig, setStudentMaintenanceConfig] =
    useState<StudentMaintenanceConfig | null>(null);
  const [studentMaintenanceAccessStatus, setStudentMaintenanceAccessStatus] =
    useState<StudentMaintenanceAccessStatus>("anonymous");
  const firstUserDocReadyRef = useRef<string | null>(null);
  const systemConfigLoadRef = useRef<Promise<void> | null>(null);
  const menuConfigLoadRef = useRef<Promise<void> | null>(null);
  const authRevisionRef = useRef(0);
  const authenticatedUidRef = useRef<string | null>(null);
  const resolvedUserRef = useRef<User | null>(null);
  const logoutReasonRef = useRef<LogoutReason | null>(null);
  const authResolutionPendingRef = useRef(true);
  const stopUserDocSubscriptionRef = useRef<() => void>(() => undefined);
  const maintenanceProfileRef = useRef<UserData | null>(null);
  const maintenanceBlockedRef = useRef(false);

  const clearAuthenticatedState = useCallback(() => {
    firstUserDocReadyRef.current = null;
    systemConfigLoadRef.current = null;
    menuConfigLoadRef.current = null;
    resolvedUserRef.current = null;
    setApplicationSessionAuthorityMode(null);
    maintenanceProfileRef.current = null;
    maintenanceBlockedRef.current = false;
    setStudentMaintenanceConfig(null);
    setStudentMaintenanceAccessStatus("anonymous");
    setCurrentUser(null);
    setUserData(null);
    setConfig(null);
    setConfigReady(false);
    setConfigLoadedAt(0);
    setMenuConfig(null);
    setMenuConfigReady(false);
    setMenuConfigLoadedAt(0);
  }, []);

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
        if (auth.currentUser?.uid !== user.uid) return;
        setConfig(normalizeSystemConfig(data));
        setConfigReady(true);
        setConfigLoadedAt(Date.now());
        markLoginPerf("westory-auth-config-ready");
      } catch (e) {
        console.error("Failed to load system config", e);
        if (auth.currentUser?.uid !== user.uid) return;
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
        if (auth.currentUser?.uid !== user.uid) return;
        setMenuConfig(data ? sanitizeMenuConfig(data) : cloneDefaultMenus());
        setMenuConfigReady(true);
        setMenuConfigLoadedAt(Date.now());
      } catch (e) {
        console.error("Failed to load menu config", e);
        if (auth.currentUser?.uid !== user.uid) return;
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

  useEffect(
    () =>
      subscribeApplicationSessionAuthorityMode(
        setApplicationSessionAuthorityMode,
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    let unsubscribeUserDoc: (() => void) | null = null;
    let visibilitySettingsReady: Promise<void> | null = null;
    let resolutionGuard: number | null = null;

    const stopUserDocSubscription = () => {
      if (!unsubscribeUserDoc) return;
      unsubscribeUserDoc();
      unsubscribeUserDoc = null;
    };
    stopUserDocSubscriptionRef.current = stopUserDocSubscription;

    const clearResolutionGuard = () => {
      if (resolutionGuard === null) return;
      window.clearTimeout(resolutionGuard);
      resolutionGuard = null;
    };

    const scheduleResolutionGuard = () => {
      clearResolutionGuard();
      resolutionGuard = window.setTimeout(() => {
        if (!active || !authResolutionPendingRef.current) return;
        authRevisionRef.current += 1;
        clearAuthenticatedState();
        setAuthenticationError(
          "로그인 정보와 사용자 권한을 확인하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
        );
        setAuthenticationStatus("ERROR");
      }, 15000);
    };

    const verifyMaintenanceAccess = async (
      user: User,
      authRevision: number,
    ) => {
      setStudentMaintenanceAccessStatus("checking");
      const bootstrap = await readStudentMaintenanceBootstrap(user);
      if (
        !active ||
        authRevisionRef.current !== authRevision ||
        auth.currentUser?.uid !== user.uid
      ) {
        return false;
      }

      maintenanceProfileRef.current = bootstrap.profile;
      setStudentMaintenanceConfig(bootstrap.config);
      setStudentMaintenanceAccessStatus(bootstrap.accessStatus);
      if (bootstrap.profile) setUserData(bootstrap.profile);

      if (bootstrap.accessStatus === "allowed") {
        maintenanceBlockedRef.current = false;
        return true;
      }

      maintenanceBlockedRef.current = true;
      resolvedUserRef.current = user;
      setApplicationSessionAuthorityMode(null);
      setCurrentUser(user);
      setConfig(null);
      setConfigReady(false);
      setMenuConfig(null);
      setMenuConfigReady(false);
      authResolutionPendingRef.current = false;
      setAuthenticationError(
        bootstrap.accessStatus === "error"
          ? "점검 상태를 안전하게 확인하지 못했습니다."
          : "",
      );
      setAuthenticationStatus("MAINTENANCE");
      clearResolutionGuard();
      return false;
    };

    const subscribeUserDocument = async (user: User, authRevision: number) => {
      stopUserDocSubscription();
      const userRef = doc(db, "users", user.uid);
      const readUserDocumentFromServer = async () => {
        let lastError: unknown = null;
        const retryDelaysMs = [0, 50, 100, 200, 400, 800, 1600, 2000];
        for (const delayMs of retryDelaysMs) {
          if (
            !active ||
            authRevisionRef.current !== authRevision ||
            auth.currentUser?.uid !== user.uid
          ) {
            return null;
          }
          if (delayMs > 0) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, delayMs),
            );
          }
          try {
            return await getDocFromServer(userRef);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      };
      const applyUserDocument = async (
        userSnap: Awaited<ReturnType<typeof getDocFromServer>>,
      ) => {
        if (
          !active ||
          authRevisionRef.current !== authRevision ||
          auth.currentUser?.uid !== user.uid
        ) {
          return;
        }
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
              staffPermissions: normalizeStaffPermissions(raw.staffPermissions),
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
          void visibilitySettingsReady?.catch(() => undefined);
          logoutReasonRef.current = null;
          authResolutionPendingRef.current = false;
          clearResolutionGuard();
        } catch (e) {
          console.error("Failed to sync user data", e);
          clearAuthenticatedState();
          authResolutionPendingRef.current = false;
          setAuthenticationError("사용자 권한 정보를 확인하지 못했습니다.");
          setAuthenticationStatus("ERROR");
          clearResolutionGuard();
        }
      };
      const handleUserDocumentError = (e: unknown) => {
        if (!active || authRevisionRef.current !== authRevision) {
          return;
        }
        console.error("Failed to subscribe user data", e);
        clearAuthenticatedState();
        authResolutionPendingRef.current = false;
        setAuthenticationError("사용자 권한 정보를 확인하지 못했습니다.");
        setAuthenticationStatus("ERROR");
        clearResolutionGuard();
      };

      try {
        // A cached snapshot can arrive before Firestore has adopted the token
        // issued by a completed step-up reauthentication. Confirm the user
        // document against the server before protected children can remount.
        const userSnap = await readUserDocumentFromServer();
        if (!userSnap) return;
        await applyUserDocument(userSnap);
      } catch (e) {
        handleUserDocumentError(e);
        return;
      }

      if (
        !active ||
        authRevisionRef.current !== authRevision ||
        auth.currentUser?.uid !== user.uid
      ) {
        return;
      }
      unsubscribeUserDoc = onSnapshot(
        userRef,
        (userSnap) => {
          void applyUserDocument(userSnap);
        },
        handleUserDocumentError,
      );
    };

    setAuthenticationStatus("AUTHENTICATING");
    scheduleResolutionGuard();

    const startAuthListener = async () => {
      try {
        await authPersistenceReady;
      } catch (e) {
        console.warn("Auth persistence init fallback", e);
      }
      if (!active) return;

      unsubscribe = onIdTokenChanged(
        auth,
        async (user) => {
          markLoginPerf("westory-auth-current-user-resolved", {
            hasUser: user ? "true" : "false",
          });
          measureLoginPerf(
            "westory-auth-init",
            "westory-app-load-start",
            "westory-auth-current-user-resolved",
          );

          if (
            user &&
            resolvedUserRef.current?.uid === user.uid &&
            isAllowedWestoryEmail(user.email)
          ) {
            const refreshRevision = authRevisionRef.current + 1;
            authRevisionRef.current = refreshRevision;
            authResolutionPendingRef.current = true;
            scheduleResolutionGuard();
            try {
              const maintenanceAllowed = await verifyMaintenanceAccess(
                user,
                refreshRevision,
              );
              if (!maintenanceAllowed) return;
              const applicationSession = await synchronizeApplicationSession(
                user,
                {
                  expectedUid: user.uid,
                },
              );
              if (
                !active ||
                authRevisionRef.current !== refreshRevision ||
                auth.currentUser?.uid !== user.uid
              ) {
                return;
              }
              if (
                applicationSession.authorityMode === "ENFORCE" &&
                !writeSessionDeadline(applicationSession.generalExpiresAt, {
                  durationMs: NORMAL_SESSION_DURATION_MS,
                })
              ) {
                throw new Error("Invalid application session deadline");
              }
              if (applicationSession.authorityMode !== "ENFORCE") {
                clearSessionTiming();
              }
              resolvedUserRef.current = user;
              setApplicationSessionAuthorityMode(
                applicationSession.authorityMode,
              );
              setCurrentUser(user);
              setAuthenticationStatus("AUTHENTICATED");
              setAuthenticationError("");
              void subscribeUserDocument(user, refreshRevision);
            } catch (error) {
              if (
                !active ||
                authRevisionRef.current !== refreshRevision ||
                auth.currentUser?.uid !== user.uid
              ) {
                return;
              }
              console.error("Failed to refresh application session", error);
              clearAuthenticatedState();
              authResolutionPendingRef.current = false;
              setAuthenticationError(
                "로그인 세션을 갱신하지 못했습니다. 보호된 작업을 다시 시도해 주세요.",
              );
              setAuthenticationStatus("ERROR");
              clearResolutionGuard();
            }
            return;
          }

          const authRevision = authRevisionRef.current + 1;
          authRevisionRef.current = authRevision;
          authResolutionPendingRef.current = true;
          scheduleResolutionGuard();
          setAuthenticationError("");
          if (unsubscribeUserDoc) {
            unsubscribeUserDoc();
            unsubscribeUserDoc = null;
          }
          if (user) {
            setAuthenticationStatus("AUTHENTICATING");
            setUserData(null);
            firstUserDocReadyRef.current = null;
            setConfigReady(false);
            setMenuConfigReady(false);
            authenticatedUidRef.current = user.uid;

            if (!isAllowedWestoryEmail(user.email)) {
              authResolutionPendingRef.current = false;
              clearResolutionGuard();
              return;
            }

            try {
              const maintenanceAllowed = await verifyMaintenanceAccess(
                user,
                authRevision,
              );
              if (!maintenanceAllowed) return;
              const applicationSession = await synchronizeApplicationSession(
                user,
                {
                  expectedUid: user.uid,
                },
              );
              if (
                !active ||
                authRevisionRef.current !== authRevision ||
                auth.currentUser?.uid !== user.uid
              ) {
                return;
              }
              if (
                applicationSession.authorityMode === "ENFORCE" &&
                !writeSessionDeadline(applicationSession.generalExpiresAt, {
                  durationMs: NORMAL_SESSION_DURATION_MS,
                })
              ) {
                throw new Error("Invalid application session deadline");
              }
              if (applicationSession.authorityMode !== "ENFORCE") {
                clearSessionTiming();
              }
              resolvedUserRef.current = user;
              setApplicationSessionAuthorityMode(
                applicationSession.authorityMode,
              );
              setAuthenticationStatus("AUTHENTICATED");
              setCurrentUser(user);
            } catch (error) {
              if (!active || authRevisionRef.current !== authRevision) return;
              console.error("Failed to open application session", error);
              clearAuthenticatedState();
              authResolutionPendingRef.current = false;
              setAuthenticationError(
                "로그인 세션을 시작하지 못했습니다. 다시 로그인해 주세요.",
              );
              setAuthenticationStatus("SESSION_EXPIRED");
              clearResolutionGuard();
              await signOut(auth).catch(() => undefined);
              return;
            }

            visibilitySettingsReady = Promise.all([
              loadAuthedSystemConfig(user),
              loadAuthedMenuConfig(user),
            ]).then(() => undefined);
            void subscribeUserDocument(user, authRevision);
          } else {
            const logoutReason = logoutReasonRef.current;
            const wasAuthenticated = authenticatedUidRef.current !== null;
            clearAuthenticatedState();
            authenticatedUidRef.current = null;
            logoutReasonRef.current = null;
            visibilitySettingsReady = null;
            authResolutionPendingRef.current = false;
            setAuthenticationStatus(
              logoutReason === "expired" ||
                (wasAuthenticated && logoutReason !== "manual")
                ? "SESSION_EXPIRED"
                : "ANONYMOUS",
            );
            clearResolutionGuard();
          }
        },
        (e) => {
          if (!active) return;
          console.error("Failed to initialize auth listener", e);
          authRevisionRef.current += 1;
          clearAuthenticatedState();
          authResolutionPendingRef.current = false;
          setAuthenticationError("로그인 세션을 확인하지 못했습니다.");
          setAuthenticationStatus("ERROR");
          clearResolutionGuard();
        },
      );
    };

    void startAuthListener();

    return () => {
      active = false;
      clearResolutionGuard();
      stopUserDocSubscription();
      if (stopUserDocSubscriptionRef.current === stopUserDocSubscription) {
        stopUserDocSubscriptionRef.current = () => undefined;
      }
      unsubscribe();
    };
  }, [clearAuthenticatedState, loadAuthedMenuConfig, loadAuthedSystemConfig]);

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }
    let resumeGuard: number | null = null;

    const enterMaintenance = (
      accessStatus: "blocked" | "error",
      message = "",
    ) => {
      if (resumeGuard !== null) {
        window.clearTimeout(resumeGuard);
        resumeGuard = null;
      }
      maintenanceBlockedRef.current = true;
      authRevisionRef.current += 1;
      authResolutionPendingRef.current = false;
      stopUserDocSubscriptionRef.current();
      setApplicationSessionAuthorityMode(null);
      setConfig(null);
      setConfigReady(false);
      setMenuConfig(null);
      setMenuConfigReady(false);
      setStudentMaintenanceAccessStatus(accessStatus);
      setAuthenticationError(message);
      setAuthenticationStatus("MAINTENANCE");
    };

    const maintenanceRef = doc(
      db,
      "site_settings",
      STUDENT_MAINTENANCE_CONFIG_DOC_ID,
    );
    const unsubscribeMaintenance = onSnapshot(
      maintenanceRef,
      { includeMetadataChanges: true },
      (maintenanceSnap) => {
        if (maintenanceSnap.metadata.fromCache) return;
        try {
          const maintenanceConfig = normalizeStudentMaintenanceConfig(
            maintenanceSnap.exists()
              ? (maintenanceSnap.data() as Record<string, unknown>)
              : null,
          );
          const profile = userData || maintenanceProfileRef.current;
          const accessStatus = resolveStudentMaintenanceAccess({
            user: currentUser,
            config: maintenanceConfig,
            profile,
            profileStatus: profile ? "ready" : "missing",
          });
          setStudentMaintenanceConfig(maintenanceConfig);

          if (accessStatus !== "allowed") {
            enterMaintenance(accessStatus);
            return;
          }

          if (maintenanceBlockedRef.current) {
            maintenanceBlockedRef.current = false;
            setStudentMaintenanceAccessStatus("checking");
            setAuthenticationStatus("AUTHENTICATING");
            authResolutionPendingRef.current = true;
            resumeGuard = window.setTimeout(() => {
              enterMaintenance(
                "error",
                "점검 종료 후 로그인 상태를 다시 확인하지 못했습니다.",
              );
            }, 15000);
            void currentUser.getIdToken(true).catch((error) => {
              console.error("Failed to resume after maintenance", error);
              enterMaintenance(
                "error",
                "점검 종료 후 로그인 상태를 다시 확인하지 못했습니다.",
              );
            });
            return;
          }

          setStudentMaintenanceAccessStatus("allowed");
        } catch (error) {
          console.error("Invalid student maintenance configuration", error);
          setStudentMaintenanceConfig(null);
          enterMaintenance(
            "error",
            "점검 설정을 안전하게 확인하지 못했습니다.",
          );
        }
      },
      (error) => {
        console.error("Failed to subscribe student maintenance", error);
        setStudentMaintenanceConfig(null);
        enterMaintenance("error", "점검 상태를 안전하게 확인하지 못했습니다.");
      },
    );
    return () => {
      unsubscribeMaintenance();
      if (resumeGuard !== null) window.clearTimeout(resumeGuard);
    };
  }, [currentUser?.email, currentUser?.uid, userData?.role, userData?.uid]);

  const prepareForReauthentication = useCallback(() => {
    authRevisionRef.current += 1;
    authResolutionPendingRef.current = true;
    stopUserDocSubscriptionRef.current();
    firstUserDocReadyRef.current = null;
    setAuthenticationError("");
    setAuthenticationStatus("AUTHENTICATING");
    setUserData(null);
  }, []);

  useEffect(() => {
    if (
      authenticationStatus === "AUTHENTICATED" &&
      currentUser &&
      !configReady
    ) {
      void loadAuthedSystemConfig(currentUser);
    }
    if (
      authenticationStatus === "AUTHENTICATED" &&
      currentUser &&
      !menuConfigReady
    ) {
      void loadAuthedMenuConfig(currentUser);
    }
    if (!interfaceConfig) {
      void loadPublicInterfaceConfig();
    }
  }, [
    authenticationStatus,
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

  const logout = async (reason: LogoutReason = "manual") => {
    logoutReasonRef.current = reason;
    authRevisionRef.current += 1;
    authResolutionPendingRef.current = false;
    clearAuthenticatedState();
    setAuthenticationError("");
    setAuthenticationStatus(
      reason === "expired" ? "SESSION_EXPIRED" : "ANONYMOUS",
    );
    stopUserDocSubscriptionRef.current();
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      await closeApplicationSession().catch(() => undefined);
      await signOut(auth);
    } catch (error) {
      logoutReasonRef.current = null;
      setAuthenticationError("로그아웃을 완료하지 못했습니다.");
      setAuthenticationStatus("ERROR");
      throw error;
    }
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
  const loading =
    authenticationStatus === "UNKNOWN" ||
    authenticationStatus === "AUTHENTICATING" ||
    (authenticationStatus === "AUTHENTICATED" &&
      currentUser !== null &&
      isAllowedWestoryEmail(currentUser.email) &&
      (applicationSessionAuthorityMode === null ||
        userData?.uid !== currentUser.uid));

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
    authenticationStatus,
    authenticationError,
    applicationSessionAuthorityMode,
    studentMaintenanceConfig,
    studentMaintenanceAccessStatus,
    loading,
    prepareForReauthentication,
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
