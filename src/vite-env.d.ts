/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?:
    | "production"
    | "staging"
    | "recovery"
    | "local"
    | "test";
  readonly VITE_VERCEL_PROJECT_ROLE?: "production" | "staging";
  readonly VITE_USE_FIREBASE_EMULATORS?: "true" | "false";
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string;
  readonly VITE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_FIRESTORE_EMULATOR_PORT?: string;
  readonly VITE_FUNCTIONS_EMULATOR_HOST?: string;
  readonly VITE_FUNCTIONS_EMULATOR_PORT?: string;
  readonly VITE_STORAGE_EMULATOR_HOST?: string;
  readonly VITE_STORAGE_EMULATOR_PORT?: string;
  readonly VITE_PUBLIC_BASE?: string;
  readonly VITE_GOOGLE_MAPS_EMBED_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
