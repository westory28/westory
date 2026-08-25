import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  assertFirebaseBuildBoundary,
  type FirebaseClientConfig,
} from "./src/lib/firebaseEnvironment";
import { createActiveFirebaseBindingMarker } from "./src/lib/firebaseActiveBinding";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true";
  const firebaseConfig: FirebaseClientConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
  };

  assertFirebaseBuildBoundary({
    config: firebaseConfig,
    appCheckSiteKey: env.VITE_FIREBASE_APPCHECK_SITE_KEY,
    explicitEnvironment: env.VITE_APP_ENV,
    githubActions: isGitHubPagesBuild,
    vercelEnvironment: process.env.VERCEL_ENV,
    vercelProjectRole: env.VITE_VERCEL_PROJECT_ROLE,
  });

  const normalizedEnvironment = env.VITE_APP_ENV?.trim().toLowerCase();
  const normalizedProjectRole =
    env.VITE_VERCEL_PROJECT_ROLE?.trim().toLowerCase();
  const isManagedFirebaseBuild =
    normalizedEnvironment === "production" ||
    normalizedEnvironment === "staging";
  const useAllFirebaseEmulators = env.VITE_USE_FIREBASE_EMULATORS === "true";
  const activeFirebaseEmulators = {
    auth:
      useAllFirebaseEmulators || Boolean(env.VITE_AUTH_EMULATOR_HOST?.trim()),
    firestore:
      useAllFirebaseEmulators ||
      Boolean(env.VITE_FIRESTORE_EMULATOR_HOST?.trim()),
    functions:
      useAllFirebaseEmulators ||
      Boolean(env.VITE_FUNCTIONS_EMULATOR_HOST?.trim()),
    storage:
      useAllFirebaseEmulators ||
      Boolean(env.VITE_STORAGE_EMULATOR_HOST?.trim()),
  };
  const activeFirebaseBindingMarker = isManagedFirebaseBuild
    ? createActiveFirebaseBindingMarker({
        config: {
          apiKey: firebaseConfig.apiKey,
          authDomain: firebaseConfig.authDomain,
          projectId: firebaseConfig.projectId,
          storageBucket: firebaseConfig.storageBucket,
          messagingSenderId: firebaseConfig.messagingSenderId,
          appId: firebaseConfig.appId,
        },
        appCheckSiteKey: env.VITE_FIREBASE_APPCHECK_SITE_KEY,
        functionsRegion: env.VITE_FIREBASE_FUNCTIONS_REGION,
        environment: normalizedEnvironment,
        projectRole: normalizedProjectRole,
        emulators: activeFirebaseEmulators,
      })
    : "";

  const publicBase =
    env.VITE_PUBLIC_BASE || (isGitHubPagesBuild ? "/westory/" : "/");

  return {
    base: publicBase,
    server: {
      port: 3000,
      host: "0.0.0.0",
    },
    plugins: [react()],
    define: {
      __W10P_ACTIVE_FIREBASE_CONFIG__: JSON.stringify(
        activeFirebaseBindingMarker,
      ),
      __W10P_ACTIVE_FIREBASE_CONFIG_MANAGED__: JSON.stringify(
        isManagedFirebaseBuild,
      ),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");
            if (!normalizedId.includes("/node_modules/")) return undefined;

            const includesPackage = (packageName: string) =>
              normalizedId.includes(`/node_modules/${packageName}/`);

            if (
              includesPackage("react") ||
              includesPackage("react-dom") ||
              includesPackage("react-router") ||
              includesPackage("react-router-dom") ||
              includesPackage("@remix-run/router") ||
              includesPackage("scheduler")
            ) {
              return "vendor-react";
            }

            if (
              includesPackage("@fullcalendar") ||
              includesPackage("preact") ||
              includesPackage("korean-lunar-calendar")
            ) {
              return "vendor-calendar";
            }

            if (includesPackage("react-pdf") || includesPackage("pdfjs-dist")) {
              return "vendor-pdf";
            }

            if (
              includesPackage("chart.js") ||
              includesPackage("react-chartjs-2") ||
              includesPackage("@kurkle/color")
            ) {
              return "vendor-chart";
            }

            if (
              includesPackage("read-excel-file") ||
              includesPackage("write-excel-file") ||
              includesPackage("exceljs") ||
              includesPackage("jszip") ||
              includesPackage("fflate")
            ) {
              return "vendor-excel";
            }

            if (
              includesPackage("firebase/analytics") ||
              includesPackage("@firebase/analytics") ||
              includesPackage("@firebase/installations")
            ) {
              return "vendor-firebase-analytics";
            }

            if (
              includesPackage("firebase/auth") ||
              includesPackage("@firebase/auth")
            ) {
              return "vendor-firebase-auth";
            }

            if (
              includesPackage("firebase/firestore") ||
              includesPackage("@firebase/firestore") ||
              includesPackage("@firebase/webchannel-wrapper")
            ) {
              return "vendor-firebase-firestore";
            }

            if (
              includesPackage("firebase/storage") ||
              includesPackage("@firebase/storage")
            ) {
              return "vendor-firebase-storage";
            }

            if (
              includesPackage("firebase/functions") ||
              includesPackage("@firebase/functions")
            ) {
              return "vendor-firebase-functions";
            }

            if (
              includesPackage("firebase/app") ||
              includesPackage("@firebase/app") ||
              includesPackage("@firebase/component") ||
              includesPackage("@firebase/logger") ||
              includesPackage("@firebase/util")
            ) {
              return "vendor-firebase-core";
            }
            return undefined;
          },
        },
      },
    },
  };
});
