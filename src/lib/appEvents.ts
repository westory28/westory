const POINTS_UPDATED_EVENT = 'westory:points-updated';
const MENU_CONFIG_UPDATED_EVENT = 'westory:menu-config-updated';
const SYSTEM_CONFIG_UPDATED_EVENT = 'westory:system-config-updated';

const emitWindowEvent = (eventName: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName));
};

export const notifyPointsUpdated = () => {
  emitWindowEvent(POINTS_UPDATED_EVENT);
};

export const notifyMenuConfigUpdated = () => {
  emitWindowEvent(MENU_CONFIG_UPDATED_EVENT);
};

export const notifySystemConfigUpdated = () => {
  emitWindowEvent(SYSTEM_CONFIG_UPDATED_EVENT);
};

export const subscribePointsUpdated = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(POINTS_UPDATED_EVENT, listener as EventListener);
  return () => window.removeEventListener(POINTS_UPDATED_EVENT, listener as EventListener);
};

export const subscribeMenuConfigUpdated = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(MENU_CONFIG_UPDATED_EVENT, listener as EventListener);
  return () => window.removeEventListener(MENU_CONFIG_UPDATED_EVENT, listener as EventListener);
};

export const subscribeSystemConfigUpdated = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(SYSTEM_CONFIG_UPDATED_EVENT, listener as EventListener);
  return () => window.removeEventListener(SYSTEM_CONFIG_UPDATED_EVENT, listener as EventListener);
};
