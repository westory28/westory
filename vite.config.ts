import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true";
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
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
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
