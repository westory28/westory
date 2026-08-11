import * as React from "react";

export type ShellViewport = "mobile" | "tablet" | "compact" | "desktop";

const resolveViewport = (): ShellViewport => {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(min-width: 1280px)").matches) return "desktop";
  if (window.matchMedia("(min-width: 1024px)").matches) return "compact";
  if (window.matchMedia("(min-width: 768px)").matches) return "tablet";
  return "mobile";
};

const subscribers = new Set<() => void>();
let currentViewport: ShellViewport = resolveViewport();
let listening = false;
let mediaBindings: Array<{
  query: MediaQueryList;
  listener: () => void;
}> = [];

const startListening = () => {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const update = () => {
    const next = resolveViewport();
    if (next === currentViewport) return;
    currentViewport = next;
    subscribers.forEach((subscriber) => subscriber());
  };
  currentViewport = resolveViewport();
  mediaBindings = [768, 1024, 1280].map((width) => {
    const query = window.matchMedia(`(min-width: ${width}px)`);
    query.addEventListener("change", update);
    return { query, listener: update };
  });
};

const stopListening = () => {
  mediaBindings.forEach(({ query, listener }) => {
    query.removeEventListener("change", listener);
  });
  mediaBindings = [];
  listening = false;
};

const subscribe = (callback: () => void) => {
  subscribers.add(callback);
  startListening();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) stopListening();
  };
};

const getSnapshot = () => currentViewport;
const getServerSnapshot = (): ShellViewport => "desktop";

export const useShellViewport = () =>
  React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
