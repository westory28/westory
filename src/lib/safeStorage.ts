import { isSemesterArchive } from "./semesterArchive";
const memoryStorage = new Map<string, string>();

const isBrowser = typeof window !== "undefined";

const readStorage = (key: string): string | null => {
  if (!isBrowser || isSemesterArchive) return memoryStorage.get(key) ?? null;

  try {
    const sessionValue = window.sessionStorage.getItem(key);
    if (sessionValue !== null) return sessionValue;
  } catch (error) {
    console.warn("sessionStorage read blocked:", error);
  }

  try {
    const localValue = window.localStorage.getItem(key);
    if (localValue !== null) return localValue;
  } catch (error) {
    console.warn("localStorage read blocked:", error);
  }

  return memoryStorage.get(key) ?? null;
};

const writeStorage = (key: string, value: string) => {
  memoryStorage.set(key, value);
  if (!isBrowser || isSemesterArchive) return;

  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    console.warn("sessionStorage write blocked:", error);
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn("localStorage write blocked:", error);
  }
};

const removeStorage = (key: string) => {
  memoryStorage.delete(key);
  if (!isBrowser || isSemesterArchive) return;

  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn("sessionStorage remove blocked:", error);
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("localStorage remove blocked:", error);
  }
};

const readLocalOnly = (key: string): string | null => {
  if (!isBrowser || isSemesterArchive) return memoryStorage.get(key) ?? null;
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch (error) {
    console.warn("localStorage read blocked:", error);
  }
  return memoryStorage.get(key) ?? null;
};

const writeLocalOnly = (key: string, value: string) => {
  memoryStorage.set(key, value);
  if (!isBrowser || isSemesterArchive) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn("localStorage write blocked:", error);
  }
};

export {
  readStorage,
  writeStorage,
  removeStorage,
  readLocalOnly,
  writeLocalOnly,
};
