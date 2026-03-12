import { initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    browserSessionPersistence,
    getAuth,
    indexedDBLocalPersistence,
    inMemoryPersistence,
    setPersistence,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const configuredAuthDomain = (() => {
    const envDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "history-quiz-yongsin.firebaseapp.com";
    if (typeof window === 'undefined') return envDomain;

    const runtimeHost = window.location.hostname;
    if (/^(localhost|127\.0\.0\.1)$/.test(runtimeHost)) return envDomain;

    if (/^(?:www\.)?westory\.kr$/i.test(runtimeHost)) {
        return runtimeHost;
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
const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
let analytics = null;
let firestoreEmulatorConnected = false;

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

    if (import.meta.env.DEV && !firestoreEmulatorConnected) {
        connectFirestoreEmulator(db, emulatorHost, emulatorPort);
        firestoreEmulatorConnected = true;
        console.info(`[Firebase] Connected Firestore emulator at ${emulatorHost}:${emulatorPort}`);
    }

    if (isBrowser) {
        const currentHost = window.location.hostname;
        const authHost = firebaseConfig.authDomain;
        const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(currentHost);
        if (!isLocalHost && authHost && currentHost !== authHost) {
            console.warn(
                `[Auth] Current host (${currentHost}) differs from Firebase authDomain (${authHost}). ` +
                'Safari-based browsers may fail redirect login unless the helper domain is configured for the same site.',
            );
        }
    }
    if (isBrowser && firebaseConfig.measurementId) {
        analytics = getAnalytics(app);
    }
} catch (e) {
    console.warn("Analytics not supported:", e);
}
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
    window.setTimeout(() => {
        void import('firebase/analytics')
            .then(({ getAnalytics }) => {
                analytics = getAnalytics(app);
            })
            .catch((e) => {
                console.warn("Analytics not supported:", e);
            });
    }, 0);
}

export { app, auth, db, storage, analytics, authPersistenceReady, configuredAuthDomain };
