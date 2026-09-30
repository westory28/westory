import { archiveScope, isSemesterArchive } from "../lib/semesterArchive";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { User, onIdTokenChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, authPersistenceReady, db } from "../lib/firebase";
import { SystemConfig, InterfaceConfig, UserData } from "../types";
import {
  cloneDefaultMenus,
  sanitizeMenuConfig,
  type MenuConfig,
} from "../constants/menus";
import { markLoginPerf, measureLoginPerf } from "../lib/loginPerf";
import { prepareApplicationSession } from "../lib/applicationSession";
import {
  AuthStartupController,
  type AuthPhase,
  type AuthStartupError,
  type AuthStartupState,
  type LoginBootstrap,
} from "../lib/authStartup";
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
  authPhase: AuthPhase;
  authError: AuthStartupError | null;
  authGeneration: number;
  onboardingUser: User | null;
  beginLoginFlow: (resume?: boolean) => number;
  isLoginFlowCurrent: (flow: number) => boolean;
  failLoginFlow: (flow: number, error: unknown) => void;
  abandonLoginFlow: (flow: number) => void;
  discardStaleLoginUser: (user: User, flow: number) => Promise<void>;
  claimLoginBootstrap: (user: User, flow: number) => Promise<LoginBootstrap>;
  isAuthAttemptCurrent: (generation: number, user: User) => boolean;
  assertAuthAttemptCurrent: (generation: number, user: User) => Promise<void>;
  waitForAuthProfile: (
    generation: number,
    user: User,
    matches: (profile: UserData) => boolean,
  ) => Promise<void>;
  retryAuth: () => Promise<void>;
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
  const [startup, setStartup] = useState<AuthStartupState>({
    phase: "resolving",
    generation: 0,
    currentUser: null,
    onboardingUser: null,
    userData: null,
    error: null,
  });
  const { currentUser, userData } = startup;
  const loading = ["resolving", "opening-session", "loading-profile"].includes(
    startup.phase,
  );
  const startupControllerRef = useRef<AuthStartupController | null>(null);
  const authGenerationRef = useRef(0);
  const perfPhasesRef = useRef(new Set<string>());
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [configLoadedAt, setConfigLoadedAt] = useState(0);
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const [menuConfigReady, setMenuConfigReady] = useState(false);
  const [menuConfigLoadedAt, setMenuConfigLoadedAt] = useState(0);
  const [interfaceConfig, setInterfaceConfig] =
    useState<InterfaceConfig | null>(null);

  const systemConfigLoadRef = useRef<Promise<void> | null>(null);
  const menuConfigLoadRef = useRef<Promise<void> | null>(null);

  const loadPublicInterfaceConfig = useCallback(async () => {
    try {
      const data =
        await readSiteSettingDoc<InterfaceConfig>("interface_config");
      setInterfaceConfig(data);
      markLoginPerf("westory-interface-config-ready");
    } catch (e) {
      console.error("Failed to load interface config");
    }
  }, []);

  const loadAuthedSystemConfig = useCallback(
    async (user: User | null, generation = authGenerationRef.current) => {
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
          if (
            auth.currentUser !== user ||
            authGenerationRef.current !== generation
          )
            return;
          setConfig(normalizeSystemConfig(data));
          setConfigReady(true);
          setConfigLoadedAt(Date.now());
          markLoginPerf("westory-auth-config-ready");
        } catch (e) {
          if (
            auth.currentUser !== user ||
            authGenerationRef.current !== generation
          )
            return;
          console.error("Failed to load system config");
          setConfig(null);
          setConfigReady(true);
          setConfigLoadedAt(Date.now());
        }
      })();

      systemConfigLoadRef.current = promise;
      try {
        await promise;
      } finally {
        if (systemConfigLoadRef.current === promise)
          systemConfigLoadRef.current = null;
      }
    },
    [],
  );

  const loadAuthedMenuConfig = useCallback(
    async (user: User | null, generation = authGenerationRef.current) => {
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
          if (
            auth.currentUser !== user ||
            authGenerationRef.current !== generation
          )
            return;
          setMenuConfig(data ? sanitizeMenuConfig(data) : cloneDefaultMenus());
          setMenuConfigReady(true);
          setMenuConfigLoadedAt(Date.now());
        } catch (e) {
          if (
            auth.currentUser !== user ||
            authGenerationRef.current !== generation
          )
            return;
          console.error("Failed to load menu config");
          setMenuConfig(null);
          setMenuConfigReady(true);
          setMenuConfigLoadedAt(Date.now());
        }
      })();

      menuConfigLoadRef.current = promise;
      try {
        await promise;
      } finally {
        if (menuConfigLoadRef.current === promise)
          menuConfigLoadRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    void loadPublicInterfaceConfig();
  }, [loadPublicInterfaceConfig]);

  useEffect(() => {
    const controller = new AuthStartupController(
      {
        currentUser: () => auth.currentUser,
        prepareSession: (user, options) =>
          prepareApplicationSession(user, options),
        listenProfile: (user, next, error) =>
          onSnapshot(
            doc(db, "users", user.uid),
            { includeMetadataChanges: true },
            (snapshot) =>
              next({
                exists: snapshot.exists(),
                data: snapshot.exists() ? (snapshot.data() as UserData) : null,
                fromCache: snapshot.metadata.fromCache,
                hasPendingWrites: snapshot.metadata.hasPendingWrites,
              }),
            error,
          ),
        change: (state) => {
          if (authGenerationRef.current !== state.generation) {
            authGenerationRef.current = state.generation;
            perfPhasesRef.current.clear();
            systemConfigLoadRef.current = null;
            menuConfigLoadRef.current = null;
            setConfig(null);
            setConfigReady(false);
            setConfigLoadedAt(0);
            setMenuConfig(null);
            setMenuConfigReady(false);
            setMenuConfigLoadedAt(0);
          }
          setStartup(state);
        },
        sessionReady: (user, generation) => {
          void Promise.all([
            loadAuthedSystemConfig(user, generation),
            loadAuthedMenuConfig(user, generation),
          ]);
        },
        mark: (phase, generation) => {
          if (perfPhasesRef.current.has(phase)) return;
          perfPhasesRef.current.add(phase);
          markLoginPerf(`westory-auth-${phase}`, {
            attempt: generation,
            phase,
          });
          if (phase === "opening-session") {
            measureLoginPerf(
              "westory-auth-token",
              "westory-auth-resolving",
              "westory-auth-opening-session",
            );
          } else if (phase === "loading-profile") {
            measureLoginPerf(
              "westory-auth-session",
              "westory-auth-opening-session",
              "westory-auth-loading-profile",
            );
          }
          if (phase === "ready" || phase === "onboarding") {
            measureLoginPerf(
              "westory-auth-profile",
              "westory-auth-loading-profile",
              `westory-auth-${phase}`,
            );
            measureLoginPerf(
              "westory-auth-bootstrap",
              "westory-auth-opening-session",
              `westory-auth-${phase}`,
            );
          }
        },
        setTimer: (callback, delay) => window.setTimeout(callback, delay),
        clearTimer: (timer) => window.clearTimeout(timer),
      },
      authGenerationRef.current + 1,
    );
    startupControllerRef.current = controller;
    void authPersistenceReady.catch(() => undefined);
    const unsubscribe = onIdTokenChanged(
      auth,
      (user) => {
        markLoginPerf("westory-auth-current-user-resolved", {
          hasUser: !!user,
        });
        measureLoginPerf(
          "westory-auth-init",
          "westory-app-load-start",
          "westory-auth-current-user-resolved",
        );
        void controller.observe(user);
      },
      (error) => {
        controller.observerFailed(error);
      },
    );
    return () => {
      controller.dispose();
      if (startupControllerRef.current === controller)
        startupControllerRef.current = null;
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
    loading,
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
    startupControllerRef.current?.invalidate();
    await signOut(auth);
  };

  const beginLoginFlow = useCallback(
    (resume = false) =>
      startupControllerRef.current?.beginLoginFlow(resume) ?? -1,
    [],
  );
  const isLoginFlowCurrent = useCallback(
    (flow: number) =>
      startupControllerRef.current?.isLoginFlowCurrent(flow) === true,
    [],
  );
  const failLoginFlow = useCallback(
    (flow: number, error: unknown) =>
      startupControllerRef.current?.failLoginFlow(flow, error),
    [],
  );
  const claimLoginBootstrap = useCallback((user: User, flow: number) => {
    const controller = startupControllerRef.current;
    if (!controller)
      return Promise.reject(new Error("로그인 상태를 확인하지 못했습니다."));
    return controller.claimLoginBootstrap(user, flow);
  }, []);
  const abandonLoginFlow = useCallback(
    (flow: number) => startupControllerRef.current?.abandonLoginFlow(flow),
    [],
  );
  const discardStaleLoginUser = useCallback(
    async (user: User, flow: number) => {
      const controller = startupControllerRef.current;
      if (!controller?.rejectStaleAcquisition(user, flow)) return;
      await signOut(auth);
    },
    [],
  );
  const isAuthAttemptCurrent = useCallback(
    (generation: number, user: User) =>
      startupControllerRef.current?.isCurrent(generation, user) === true,
    [],
  );
  const assertAuthAttemptCurrent = useCallback(
    async (generation: number, user: User) => {
      const controller = startupControllerRef.current;
      if (!controller) throw new Error("로그인 상태가 변경되었습니다.");
      await controller.assertCurrent(generation, user);
    },
    [],
  );
  const retryAuth = useCallback(async () => {
    await startupControllerRef.current?.retry();
  }, []);
  const waitForAuthProfile = useCallback(
    async (
      generation: number,
      user: User,
      matches: (profile: UserData) => boolean,
    ) => {
      const controller = startupControllerRef.current;
      if (!controller) throw new Error("로그인 상태가 변경되었습니다.");
      await controller.waitForProfile(generation, user, matches);
    },
    [],
  );

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

  const effectiveConfig = React.useMemo(
    () =>
      config && isSemesterArchive && archiveScope
        ? { ...config, ...archiveScope }
        : config,
    [config],
  );
  const value = {
    user: currentUser,
    currentUser,
    userData,
    userConfig: effectiveConfig,
    config: effectiveConfig,
    configReady,
    menuConfig,
    menuConfigReady,
    settingsLoadedAt,
    interfaceConfig,
    loading,
    authPhase: startup.phase,
    authError: startup.error,
    authGeneration: startup.generation,
    onboardingUser: startup.onboardingUser,
    beginLoginFlow,
    isLoginFlowCurrent,
    failLoginFlow,
    abandonLoginFlow,
    discardStaleLoginUser,
    claimLoginBootstrap,
    isAuthAttemptCurrent,
    assertAuthAttemptCurrent,
    waitForAuthProfile,
    retryAuth,
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
