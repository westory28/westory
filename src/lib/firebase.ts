import { initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    browserSessionPersistence,
    getAuth,
    indexedDBLocalPersistence,
    inMemoryPersistence,
    setPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: "AIzaSyAOlPQ5PFmL0zxmGrGcuEBnqBXisph7kPU",
    authDomain: "history-quiz-yongsin.firebaseapp.com",
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

export { app, auth, db, storage, analytics, authPersistenceReady };
