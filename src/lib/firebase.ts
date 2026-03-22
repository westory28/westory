import { initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    browserSessionPersistence,
    getAuth,
    indexedDBLocalPersistence,
    inMemoryPersistence,
    setPersistence,
} from 'firebase/auth';
import type { Analytics } from 'firebase/analytics';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const isLocalQaHost = (host: string) => /^(localhost|127\.0\.0\.1)$/i.test(host);
const isWestoryCustomHost = (host: string) => /^(?:www\.)?westory\.kr$/i.test(host);

const configuredAuthDomain = (() => {
    const envDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "history-quiz-yongsin.firebaseapp.com";
    if (typeof window === 'undefined') return envDomain;

    const runtimeHost = window.location.hostname;
    if (isLocalQaHost(runtimeHost)) return envDomain;

    // Only use the custom domain helper when we are on the real HTTPS site,
    // not on a local hosts-file alias or a custom-port preview.
    if (isWestoryCustomHost(runtimeHost) && window.location.protocol === 'https:' && !window.location.port) {
        return runtimeHost.toLowerCase();
    }

    return envDomain;
})();

const firebaseConfig = {
    apiKey: "AIzaSyAOlPQ5PFmL0zxmGrGcuEBnqBXisph7kPU",
    authDomain: configuredAuthDomain,
    projectId: "history-quiz-yongsin",
    storageBucket: "history-quiz-yongsin.firebasestorage.app",
    messagingSenderId: "177587430482",
    appId: "1:177587430482:web:d79cc145c11e335cc3ab8b",
    measurementId: "G-LHN97D7R2R"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'asia-northeast3');
const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
let analytics: Analytics | null = null;
let firestoreEmulatorConnected = false;
let functionsEmulatorConnected = false;

const isMobileBrowser = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
};

const authPersistenceReady = typeof window === 'undefined'
    ? Promise.resolve()
    : (async () => {
        // Old mobile browsers often stall on IndexedDB-backed persistence.
        // Prefer lighter storage first on phones to shorten login startup time.
        const persistenceOrder = isMobileBrowser()
            ? [browserLocalPersistence, browserSessionPersistence, indexedDBLocalPersistence, inMemoryPersistence]
            : [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];

        for (const persistence of persistenceOrder) {
            try {
                await setPersistence(auth, persistence);
                return;
            } catch {
                continue;
            }
        }
    })();

try {
    const isBrowser = typeof window !== 'undefined';
    const emulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
    const emulatorPort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
    const functionsEmulatorHost = import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST || emulatorHost;
    const functionsEmulatorPort = Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001);

    if (import.meta.env.DEV && !firestoreEmulatorConnected) {
        connectFirestoreEmulator(db, emulatorHost, emulatorPort);
        firestoreEmulatorConnected = true;
        console.info(`[Firebase] Connected Firestore emulator at ${emulatorHost}:${emulatorPort}`);
    }
    if (import.meta.env.DEV && !functionsEmulatorConnected) {
        connectFunctionsEmulator(functions, functionsEmulatorHost, functionsEmulatorPort);
        functionsEmulatorConnected = true;
        console.info(`[Firebase] Connected Functions emulator at ${functionsEmulatorHost}:${functionsEmulatorPort}`);
    }

    if (isBrowser) {
        const currentHost = window.location.hostname;
        const authHost = firebaseConfig.authDomain;
        const isLocalHost = isLocalQaHost(currentHost);
        if (isWestoryCustomHost(currentHost) && authHost !== currentHost) {
            console.warn(
                `[Auth] Non-production westory.kr origin detected (${window.location.origin}); ` +
                `falling back to Firebase authDomain (${authHost}). ` +
                'Use the real HTTPS deployment or localhost/127.0.0.1 for QA login validation.',
            );
        }
        if (!isLocalHost && authHost && currentHost !== authHost) {
            console.warn(
                `[Auth] Current host (${currentHost}) differs from Firebase authDomain (${authHost}). ` +
                'Safari-based browsers may fail redirect login unless the helper domain is configured for the same site.',
            );
        }
    }
} catch (e) {
    console.warn("Analytics not supported:", e);
}
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
    window.setTimeout(() => {
        void import('firebase/analytics')
            .then(async ({ getAnalytics, isSupported }) => {
                if (!(await isSupported())) return;
                analytics = getAnalytics(app);
            })
            .catch((e) => {
                console.warn("Analytics not supported:", e);
            });
    }, 0);
}

export { app, auth, db, functions, storage, analytics, authPersistenceReady, configuredAuthDomain };
