import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./assets/index.css";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { LoadingProvider } from "./components/common/LoadingState";
import { markLoginPerf } from "./lib/loginPerf";
import { installAssetRecovery } from "./lib/assetRecovery";

if (
  typeof window !== "undefined" &&
  window.location.hostname.endsWith("github.io") &&
  window.location.pathname.startsWith("/westory") &&
  !window.location.hash
) {
  window.location.replace(
    `${window.location.origin}${window.location.pathname}${window.location.search}#/`,
  );
}

markLoginPerf("westory-app-load-start");
installAssetRecovery();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoadingProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </LoadingProvider>
  </React.StrictMode>,
);
