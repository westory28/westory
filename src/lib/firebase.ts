import { initializeApp } from "firebase/app";
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

const isWestoryCustomHost = (host: string) =>
  /^(?:www\.)?westory\.kr$/i.test(host);

const runtimeHost =
  typeof window === "undefined" ? "" : window.location.hostname;
const runtimeEnvironment = resolveRuntimeEnvironment({
  explicitEnvironment: import.meta.env.VITE_APP_ENV,
  hostname: runtimeHost,
  isDev: import.meta.env.DEV,
});

const useAllFirebaseEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
const emulatorTargets = {
  auth:
    useAllFirebaseEmulators || Boolean(import.meta.env.VITE_AUTH_EMULATOR_HOST),
  firestore:
    useAllFirebaseEmulators ||
    Boolean(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST),
  functions:
    useAllFirebaseEmulators ||
    Boolean(import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST),
  storage:
    useAllFirebaseEmulators ||
    Boolean(import.meta.env.VITE_STORAGE_EMULATOR_HOST),
};

const envFirebaseConfig: FirebaseClientConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

const baseFirebaseConfig = (() => {
  if (runtimeEnvironment === "production") {
    return envFirebaseConfig;
  }
  if (runtimeEnvironment === "local" || runtimeEnvironment === "test") {
    return {
      ...getLocalFirebaseConfig(),
      ...Object.fromEntries(
        Object.entries(envFirebaseConfig).filter(([, value]) => value),
      ),
    } as FirebaseClientConfig;
  }
  return envFirebaseConfig;
})();

const configuredAuthDomain = (() => {
  const envDomain = baseFirebaseConfig.authDomain;
  if (typeof window === "undefined") return envDomain;

  if (isLocalQaHost(runtimeHost)) return envDomain;

  // Only use the custom domain helper when we are on the real HTTPS site,
  // not on a local hosts-file alias or a custom-port preview.
  if (
    isWestoryCustomHost(runtimeHost) &&
    window.location.protocol === "https:" &&
    !window.location.port
  ) {
    return runtimeHost.toLowerCase();
  }

  return envDomain;
})();

const firebaseConfig = {
  ...baseFirebaseConfig,
  authDomain: configuredAuthDomain,
};

assertFirebaseEnvironmentBoundary({
  config: firebaseConfig,
  environment: runtimeEnvironment,
  hostname: runtimeHost,
  emulators: emulatorTargets,
});

const app = initializeApp(firebaseConfig);
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
          import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-northeast3",
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
  return httpsCallable<RequestData, ResponseData>(functions, name);
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
