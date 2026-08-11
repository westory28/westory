import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./assets/index.css";
import ErrorBoundary from "./components/common/ErrorBoundary";
import { markLoginPerf } from "./lib/loginPerf";

if (typeof window !== "undefined" && !window.location.hash) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/u, "");
  const pathname = window.location.pathname;
  const routePath =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const recoverableRoute =
    /^\/(?:student|teacher|maintenance|developer-log)(?:\/|$)/u.test(routePath);

  if (recoverableRoute) {
    const appRoot = `${window.location.origin}${basePath || ""}/`;
    window.location.replace(`${appRoot}#${routePath}${window.location.search}`);
  }
}

markLoginPerf("westory-app-load-start");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
