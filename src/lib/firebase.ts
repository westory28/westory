import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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
let analytics = null;

try {
    analytics = getAnalytics(app);
} catch (e) {
    console.warn("Analytics not supported:", e);
}

export { app, auth, db, analytics };
