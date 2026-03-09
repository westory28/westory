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
import { getAnalytics } from 'firebase/analytics';

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

const authPersistenceReady = typeof window === 'undefined'
    ? Promise.resolve()
    : (async () => {
        // Some mobile browsers may delay or reject IndexedDB-backed persistence
        // during redirect recovery. Ensure one persistence is fully settled
        // before auth listeners and redirect handling begin.
        try {
            await setPersistence(auth, indexedDBLocalPersistence);
            return;
        } catch {
            try {
                await setPersistence(auth, browserLocalPersistence);
                return;
            } catch {
                try {
                    await setPersistence(auth, browserSessionPersistence);
                    return;
                } catch {
                    await setPersistence(auth, inMemoryPersistence);
                }
            }
        }
    })();

try {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser && firebaseConfig.measurementId) {
        analytics = getAnalytics(app);
    }
} catch (e) {
    console.warn("Analytics not supported:", e);
}

export { app, auth, db, storage, analytics, authPersistenceReady };
