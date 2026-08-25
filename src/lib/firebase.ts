import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  setPersistence,
} from "firebase/auth";
import type { Analytics } from "firebase/analytics";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import type { Functions, HttpsCallable } from "firebase/functions";
import type { FirebaseStorage } from "firebase/storage";
import { markLoginPerf } from "./loginPerf";
import {
  assertFirebaseEnvironmentBoundary,
  getLocalFirebaseConfig,
  isLocalQaHost,
  resolveRuntimeEnvironment,
  type FirebaseClientConfig,
} from "./firebaseEnvironment";
import {
  parseActiveFirebaseBindingMarker,
  readInjectedActiveFirebaseBindingMarker,
} from "./firebaseActiveBinding";
import { isHighRiskCommand } from "./highRiskCommands";
import {
  requestStepUpReauthentication,
  runHighRiskCommandSingleFlight,
  StepUpReauthError,
} from "./stepUpReauth";

declare const __W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__: boolean;

const isWestoryCustomHost = (host: string) =>
  /^(?:www\.)?westory\.kr$/i.test(host);

const runtimeHost =
  typeof window === "undefined" ? "" : window.location.hostname;
const normalizedExplicitEnvironment =
  import.meta.env.VITE_APP_ENV?.trim().toLowerCase();
const isNormalizedManagedFirebaseEnvironment =
  normalizedExplicitEnvironment === "production" ||
  normalizedExplicitEnvironment === "staging";
const isManagedFirebaseBuild = __W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__;
if (isManagedFirebaseBuild !== isNormalizedManagedFirebaseEnvironment) {
  throw new Error(
    "[Environment] The injected Firebase build role does not match normalized VITE_APP_ENV.",
  );
}
const resolvedRuntimeEnvironment = resolveRuntimeEnvironment({
  explicitEnvironment: normalizedExplicitEnvironment,
  hostname: runtimeHost,
  isDev: import.meta.env.DEV,
});
const isResolvedManagedFirebaseRuntime =
  resolvedRuntimeEnvironment === "production" ||
  resolvedRuntimeEnvironment === "staging";
if (isManagedFirebaseBuild !== isResolvedManagedFirebaseRuntime) {
  throw new Error(
    "[Environment] Managed Firebase builds require an explicit matching VITE_APP_ENV.",
  );
}

// The parser applies this one narrowly-scoped Production-only override while
// returning the same frozen binding shape used by every Firebase initializer.
const productionAuthDomainOverride =
  resolvedRuntimeEnvironment === "production" &&
  typeof window !== "undefined" &&
  isWestoryCustomHost(runtimeHost) &&
  window.location.protocol === "https:" &&
  !window.location.port
    ? runtimeHost.toLowerCase()
    : undefined;
const activeFirebaseBinding = isManagedFirebaseBuild
  ? parseActiveFirebaseBindingMarker(
      readInjectedActiveFirebaseBindingMarker(),
      productionAuthDomainOverride
        ? { productionAuthDomainOverride }
        : undefined,
    )
  : null;
if (
  activeFirebaseBinding &&
  activeFirebaseBinding.environment !== resolvedRuntimeEnvironment
) {
  throw new Error(
    "[Environment] The active Firebase binding does not match VITE_APP_ENV.",
  );
}
const runtimeEnvironment =
  activeFirebaseBinding?.environment ?? resolvedRuntimeEnvironment;

const fallbackEmulatorTargets = (() => {
  if (isManagedFirebaseBuild) return null;
  const useAllFirebaseEmulators =
    import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
  return Object.freeze({
    auth:
      useAllFirebaseEmulators ||
      Boolean(import.meta.env.VITE_AUTH_EMULATOR_HOST),
    firestore:
      useAllFirebaseEmulators ||
      Boolean(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST),
    functions:
      useAllFirebaseEmulators ||
      Boolean(import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST),
    storage:
      useAllFirebaseEmulators ||
      Boolean(import.meta.env.VITE_STORAGE_EMULATOR_HOST),
  });
})();
const emulatorTargets =
  activeFirebaseBinding?.emulators ?? fallbackEmulatorTargets;
if (!emulatorTargets) {
  throw new Error("[Environment] Firebase emulator binding is unavailable.");
}

const fallbackFirebaseConfig = (() => {
  if (isManagedFirebaseBuild) return null;
  const envFirebaseConfig: FirebaseClientConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
  };
  const baseFirebaseConfig =
    resolvedRuntimeEnvironment === "local" ||
    resolvedRuntimeEnvironment === "test"
      ? ({
          ...getLocalFirebaseConfig(),
          ...Object.fromEntries(
            Object.entries(envFirebaseConfig).filter(([, value]) => value),
          ),
        } as FirebaseClientConfig)
      : envFirebaseConfig;
  let configuredAuthDomain = baseFirebaseConfig.authDomain;
  if (
    typeof window !== "undefined" &&
    !isLocalQaHost(runtimeHost) &&
    isWestoryCustomHost(runtimeHost) &&
    window.location.protocol === "https:" &&
    !window.location.port
  ) {
    configuredAuthDomain = runtimeHost.toLowerCase();
  }
  return Object.freeze({
    ...baseFirebaseConfig,
    authDomain: configuredAuthDomain,
  });
})();
const resolvedFirebaseConfig =
  activeFirebaseBinding?.config ?? fallbackFirebaseConfig;
if (!resolvedFirebaseConfig) {
  throw new Error("[Environment] Firebase client binding is unavailable.");
}
const firebaseConfig: FirebaseClientConfig = resolvedFirebaseConfig;
const configuredAuthDomain = firebaseConfig.authDomain;

assertFirebaseEnvironmentBoundary({
  config: activeFirebaseBinding?.config ?? firebaseConfig,
  environment: runtimeEnvironment,
  hostname: runtimeHost,
  emulators: emulatorTargets,
});

const app = initializeApp(activeFirebaseBinding?.config ?? firebaseConfig);
const appCheckSiteKey = isManagedFirebaseBuild
  ? (activeFirebaseBinding?.appCheckSiteKey ?? "")
  : String(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || "").trim();
const isProtectedCloudRuntime =
  typeof window !== "undefined" &&
  (runtimeEnvironment === "staging" || runtimeEnvironment === "production") &&
  !Object.values(emulatorTargets).some(Boolean);
if (isProtectedCloudRuntime && !appCheckSiteKey) {
  throw new Error(
    "[Environment] Protected cloud deployments require VITE_FIREBASE_APPCHECK_SITE_KEY.",
  );
}
const appCheck: AppCheck | null = isProtectedCloudRuntime
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(
        activeFirebaseBinding?.appCheckSiteKey ?? appCheckSiteKey,
      ),
      isTokenAutoRefreshEnabled: true,
    })
  : null;
const auth = getAuth(app);
const db = getFirestore(app);
let analytics: Analytics | null = null;
let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;
let functionsEmulatorConnected = false;
let storageEmulatorConnected = false;
let functionsPromise: Promise<Functions> | null = null;
let storagePromise: Promise<FirebaseStorage> | null = null;

const emulatorHost =
  import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1";
const emulatorPort = Number(
  import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080,
);
const functionsEmulatorHost =
  import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST || emulatorHost;
const functionsEmulatorPort = Number(
  import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001,
);
const authEmulatorHost =
  import.meta.env.VITE_AUTH_EMULATOR_HOST || emulatorHost;
const authEmulatorPort = Number(
  import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099,
);
const storageEmulatorHost =
  import.meta.env.VITE_STORAGE_EMULATOR_HOST || emulatorHost;
const storageEmulatorPort = Number(
  import.meta.env.VITE_STORAGE_EMULATOR_PORT || 9199,
);

if (emulatorTargets.auth && !authEmulatorConnected) {
  connectAuthEmulator(auth, `http://${authEmulatorHost}:${authEmulatorPort}`, {
    disableWarnings: true,
  });
  authEmulatorConnected = true;
}

const isMobileBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
};

const authPersistenceReady =
  typeof window === "undefined"
    ? Promise.resolve()
    : (async () => {
        // Old mobile browsers often stall on IndexedDB-backed persistence.
        // Prefer lighter storage first on phones to shorten login startup time.
        const persistenceOrder = isMobileBrowser()
          ? [
              browserLocalPersistence,
              browserSessionPersistence,
              indexedDBLocalPersistence,
              inMemoryPersistence,
            ]
          : [
              indexedDBLocalPersistence,
              browserLocalPersistence,
              browserSessionPersistence,
              inMemoryPersistence,
            ];

        for (const persistence of persistenceOrder) {
          try {
            await setPersistence(auth, persistence);
            return;
          } catch {
            continue;
          }
        }
      })();

void authPersistenceReady.then(() => {
  markLoginPerf("westory-auth-persistence-ready");
});

try {
  const isBrowser = typeof window !== "undefined";

  if (emulatorTargets.firestore && !firestoreEmulatorConnected) {
    connectFirestoreEmulator(db, emulatorHost, emulatorPort);
    firestoreEmulatorConnected = true;
    console.info(
      `[Firebase] Connected Firestore emulator at ${emulatorHost}:${emulatorPort}`,
    );
  }

  if (isBrowser) {
    const currentHost = window.location.hostname;
    const authHost = firebaseConfig.authDomain;
    const isLocalHost = isLocalQaHost(currentHost);
    if (isWestoryCustomHost(currentHost) && authHost !== currentHost) {
      console.warn(
        `[Auth] Non-production westory.kr origin detected (${window.location.origin}); ` +
          `falling back to Firebase authDomain (${authHost}). ` +
          "Use the real HTTPS deployment or localhost/127.0.0.1 for QA login validation.",
      );
    }
    if (!isLocalHost && authHost && currentHost !== authHost) {
      console.warn(
        `[Auth] Current host (${currentHost}) differs from Firebase authDomain (${authHost}). ` +
          "Safari-based browsers may fail redirect login unless the helper domain is configured for the same site.",
      );
    }
  }
} catch (e) {
  console.warn("Analytics not supported:", e);
}
if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  window.setTimeout(() => {
    void import("firebase/analytics")
      .then(async ({ getAnalytics, isSupported }) => {
        if (!(await isSupported())) return;
        analytics = getAnalytics(app);
      })
      .catch((e) => {
        console.warn("Analytics not supported:", e);
      });
  }, 0);
}

const getFirebaseFunctions = () => {
  if (!functionsPromise) {
    functionsPromise = import("firebase/functions")
      .then(({ connectFunctionsEmulator, getFunctions }) => {
        const functions = getFunctions(
          app,
          activeFirebaseBinding?.functionsRegion ??
            (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ||
              "asia-northeast3"),
        );
        if (emulatorTargets.functions && !functionsEmulatorConnected) {
          connectFunctionsEmulator(
            functions,
            functionsEmulatorHost,
            functionsEmulatorPort,
          );
          functionsEmulatorConnected = true;
          console.info(
            `[Firebase] Connected Functions emulator at ${functionsEmulatorHost}:${functionsEmulatorPort}`,
          );
        }
        return functions;
      })
      .catch((error) => {
        functionsPromise = null;
        throw error;
      });
  }
  return functionsPromise;
};

const getHttpsCallable = async <RequestData = unknown, ResponseData = unknown>(
  name: string,
): Promise<HttpsCallable<RequestData, ResponseData>> => {
  const [functions, { httpsCallable }] = await Promise.all([
    getFirebaseFunctions(),
    import("firebase/functions"),
  ]);
  const callable = httpsCallable<RequestData, ResponseData>(functions, name);

  const invokeWithSession = async (data?: RequestData) => {
    const { prepareCallableDataWithApplicationSession } =
      await import("./applicationSession");
    const prepared = prepareCallableDataWithApplicationSession(name, data);
    return callable(prepared as RequestData | undefined);
  };

  const callableWithSession = (async (data?: RequestData) =>
    invokeWithSession(data)) as HttpsCallable<RequestData, ResponseData>;
  callableWithSession.stream = async (data, options) => {
    const { prepareCallableDataWithApplicationSession } =
      await import("./applicationSession");
    const prepared = prepareCallableDataWithApplicationSession(name, data);
    return callable.stream(prepared as RequestData, options);
  };

  if (!isHighRiskCommand(name)) return callableWithSession;

  const guardedCallable = (async (data?: RequestData) => {
    const invocationUid = auth.currentUser?.uid || "";
    return runHighRiskCommandSingleFlight(
      name,
      data,
      async () => {
        if (!invocationUid || auth.currentUser?.uid !== invocationUid) {
          throw new StepUpReauthError(
            invocationUid ? "IDENTITY_CHANGED" : "UNAUTHENTICATED",
            invocationUid
              ? "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다."
              : "로그인 사용자를 확인할 수 없어 작업을 실행하지 않았습니다.",
          );
        }
        await requestStepUpReauthentication(name);
        if (auth.currentUser?.uid !== invocationUid) {
          throw new StepUpReauthError(
            "IDENTITY_CHANGED",
            "로그인 사용자가 바뀌어 작업을 실행하지 않았습니다.",
          );
        }
        return invokeWithSession(data);
      },
      invocationUid,
    );
  }) as HttpsCallable<RequestData, ResponseData>;
  guardedCallable.stream = async (data, options) => {
    await requestStepUpReauthentication(name);
    return callableWithSession.stream(data, options);
  };
  return guardedCallable;
};

const getFirebaseStorage = () => {
  if (!storagePromise) {
    storagePromise = import("firebase/storage")
      .then(({ connectStorageEmulator, getStorage }) => {
        const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
        if (emulatorTargets.storage && !storageEmulatorConnected) {
          connectStorageEmulator(
            storage,
            storageEmulatorHost,
            storageEmulatorPort,
          );
          storageEmulatorConnected = true;
        }
        return storage;
      })
      .catch((error) => {
        storagePromise = null;
        throw error;
      });
  }
  return storagePromise;
};

export {
  app,
  appCheck,
  auth,
  db,
  getFirebaseFunctions,
  getHttpsCallable,
  getFirebaseStorage,
  analytics,
  authPersistenceReady,
  configuredAuthDomain,
  runtimeEnvironment,
};
