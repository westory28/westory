import { lazy } from "react";

export const lazyWithRetry = <T extends { default: React.ComponentType<any> }>(
  importer: () => Promise<T>,
  _key: string,
) =>
  // ErrorBoundary owns the shared, bounded asset-recovery attempt. Never leave
  // Suspense pending forever when a reload is cancelled or fails to navigate.
  lazy(importer);
