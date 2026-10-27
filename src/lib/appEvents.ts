const POINTS_UPDATED_EVENT = "westory:points-updated";
const MENU_CONFIG_UPDATED_EVENT = "westory:menu-config-updated";
const SYSTEM_CONFIG_UPDATED_EVENT = "westory:system-config-updated";
let pointsRevision = 0;
export const getPointsRevision = () => pointsRevision;
const foregroundSubscribers = new Set<() => boolean>();
let foregroundTimer: ReturnType<typeof setTimeout> | null = null;
const cancelForegroundRefresh = () => {
  if (foregroundTimer !== null) clearTimeout(foregroundTimer);
  foregroundTimer = null;
};
const canRefreshForegroundPoints = () =>
  typeof document !== "undefined" &&
  document.visibilityState === "visible" &&
  (typeof navigator === "undefined" || navigator.onLine !== false) &&
  [...foregroundSubscribers].some((isCurrent) => isCurrent());
const scheduleForegroundRefresh = () => {
  cancelForegroundRefresh();
  if (!canRefreshForegroundPoints()) return;
  foregroundTimer = setTimeout(() => {
    foregroundTimer = null;
    if (canRefreshForegroundPoints()) notifyPointsUpdated();
  }, 200);
};

// Header and the wallet page share one set of browser listeners and one timer.
// Registration itself does not fetch; resuming a visible, current student
// session invalidates pending reads and refreshes through the existing event.
export const subscribePointsForegroundRefresh = (isCurrent: () => boolean) => {
  if (typeof window === "undefined" || typeof document === "undefined")
    return () => undefined;
  foregroundSubscribers.add(isCurrent);
  if (foregroundSubscribers.size === 1) {
    window.addEventListener("focus", scheduleForegroundRefresh);
    window.addEventListener("online", scheduleForegroundRefresh);
    document.addEventListener("visibilitychange", scheduleForegroundRefresh);
  }
  return () => {
    foregroundSubscribers.delete(isCurrent);
    if (foregroundSubscribers.size > 0) return;
    cancelForegroundRefresh();
    window.removeEventListener("focus", scheduleForegroundRefresh);
    window.removeEventListener("online", scheduleForegroundRefresh);
    document.removeEventListener("visibilitychange", scheduleForegroundRefresh);
  };
};

const emitWindowEvent = (eventName: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName));
};

export const notifyPointsUpdated = () => {
  cancelForegroundRefresh();
  pointsRevision += 1;
  emitWindowEvent(POINTS_UPDATED_EVENT);
};

export const notifyMenuConfigUpdated = () => {
  emitWindowEvent(MENU_CONFIG_UPDATED_EVENT);
};

export const notifySystemConfigUpdated = () => {
  emitWindowEvent(SYSTEM_CONFIG_UPDATED_EVENT);
};

export const subscribePointsUpdated = (listener: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(POINTS_UPDATED_EVENT, listener as EventListener);
  return () =>
    window.removeEventListener(POINTS_UPDATED_EVENT, listener as EventListener);
};

export const subscribeMenuConfigUpdated = (listener: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(MENU_CONFIG_UPDATED_EVENT, listener as EventListener);
  return () =>
    window.removeEventListener(
      MENU_CONFIG_UPDATED_EVENT,
      listener as EventListener,
    );
};

export const subscribeSystemConfigUpdated = (listener: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(
    SYSTEM_CONFIG_UPDATED_EVENT,
    listener as EventListener,
  );
  return () =>
    window.removeEventListener(
      SYSTEM_CONFIG_UPDATED_EVENT,
      listener as EventListener,
    );
};
