import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/analytics';

const firebaseConfig = {
    apiKey: "AIzaSyAOlPQ5PFmL0zxmGrGcuEBnqBXisph7kPU",
    authDomain: "history-quiz-yongsin.firebaseapp.com",
    projectId: "history-quiz-yongsin",
    storageBucket: "history-quiz-yongsin.firebasestorage.app",
    messagingSenderId: "177587430482",
    appId: "1:177587430482:web:d79cc145c11e335cc3ab8b",
    measurementId: "G-LHN97D7R2R"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);

// Initialize services
const db = firebase.firestore();
const auth = firebase.auth();
let analytics = null;

try {
    analytics = firebase.analytics();
} catch (e) {
    console.warn("Analytics not supported or failed to initialize:", e);
}

// Export for module usage
// Export for module usage
export { app, db, auth, analytics, firebase };

// Attach to window for backward compatibility with existing non-module scripts
window.firebase = firebase;
window.db = db;
window.auth = auth;
window.analytics = analytics;
