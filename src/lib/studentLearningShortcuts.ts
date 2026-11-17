import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "../contexts/AuthContext";
import { auth } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import { getYearSemester } from "./semesterScope";
import { isSemesterArchive } from "./semesterArchive";

export type StudentLearningShortcutId =
  | "lesson"
  | "maps"
  | "wispi"
  | "avatar-shop"
  | "weplay"
  | "calendar";

interface ShortcutState {
  items: StudentLearningShortcutId[];
  revision: number;
}
interface Entry {
  user: User;
  semesterId: string;
  value: ShortcutState | null;
  fetchedAt: number;
  loading: boolean;
  error: string;
  listeners: Set<() => void>;
  read?: Promise<void>;
  save?: { fingerprint: string; promise: Promise<void> };
}
const entries = new Map<string, Entry>();
const CACHE_TTL_MS = 60_000;
const changedSession = () =>
  new Error("로그인 상태가 변경되었습니다. 다시 확인해 주세요.");
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "바로가기를 불러오지 못했습니다.";
const notify = (entry: Entry) =>
  entry.listeners.forEach((listener) => listener());
const current = (key: string, entry: Entry) =>
  entries.get(key) === entry && auth.currentUser === entry.user;

async function call(
  key: string,
  entry: Entry,
  fields: Record<string, unknown>,
) {
  if (!current(key, entry)) throw changedSession();
  const response = await callWithApplicationSession<
    Record<string, unknown>,
    ShortcutState
  >(
    "manageStudentLearningShortcuts",
    { semesterId: entry.semesterId, ...fields },
    entry.user,
  );
  if (!current(key, entry)) throw changedSession();
  return response.data;
}

function readEntry(key: string, entry: Entry): Promise<void> {
  if (entry.read) return entry.read;
  if (entry.save) return entry.save.promise.then(() => readEntry(key, entry));
  entry.loading = true;
  entry.error = "";
  notify(entry);
  const promise = call(key, entry, { action: "get" })
    .then((value) => {
      entry.value = value;
      entry.fetchedAt = Date.now();
    })
    .catch((error) => {
      if (current(key, entry)) {
        entry.value = null;
        entry.fetchedAt = 0;
        entry.error = errorText(error);
      }
      throw error;
    })
    .finally(() => {
      entry.read = undefined;
      entry.loading = false;
      if (current(key, entry)) notify(entry);
    });
  entry.read = promise;
  return promise;
}

function saveEntry(
  key: string,
  entry: Entry,
  items: StudentLearningShortcutId[],
): Promise<void> {
  const fingerprint = JSON.stringify(items);
  if (entry.save)
    return entry.save.fingerprint === fingerprint
      ? entry.save.promise
      : Promise.reject(new Error("이전 설정을 저장한 뒤 다시 선택해 주세요."));
  if (!current(key, entry)) return Promise.reject(changedSession());
  entry.error = "";
  notify(entry);
  const promise = (async () => {
    if (entry.read) await entry.read;
    if (!entry.value) {
      // Do not invoke readEntry while this save owns the queue.
      entry.value = await call(key, entry, { action: "get" });
      entry.fetchedAt = Date.now();
    }
    if (!current(key, entry)) throw changedSession();
    if (JSON.stringify(entry.value.items) === fingerprint) return;
    entry.value = await call(key, entry, {
      action: "save",
      items,
      expectedRevision: entry.value.revision,
    });
    entry.fetchedAt = Date.now();
  })()
    .catch((error) => {
      if (current(key, entry)) {
        entry.error = errorText(error);
        entry.fetchedAt = 0;
      }
      throw error;
    })
    .finally(() => {
      entry.save = undefined;
      if (current(key, entry)) notify(entry);
    });
  entry.save = { fingerprint, promise };
  return promise;
}

// Memory only and shared for the exact account/login generation/current semester.
// Open once to load; a later open refreshes after 60 seconds for other devices.
// No polling or automatic error retries. The last mounted consumer clears the cache.
export function useStudentLearningShortcuts(active: boolean) {
  const { currentUser, userData, authGeneration, config, configReady } =
    useAuth();
  const { year, semester } = getYearSemester(config);
  const semesterId = `${year}-${semester}`;
  const key =
    currentUser &&
    userData?.role === "student" &&
    config &&
    configReady !== false &&
    !isSemesterArchive
      ? `${currentUser.uid}:${authGeneration}:${semesterId}`
      : "";
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value: ShortcutState | null;
    loading: boolean;
    error: string;
  }>({ key: "", value: null, loading: false, error: "" });
  useEffect(() => {
    if (!key || !currentUser) return;
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        user: currentUser,
        semesterId,
        value: null,
        fetchedAt: 0,
        loading: false,
        error: "",
        listeners: new Set(),
      };
      entries.set(key, entry);
    }
    const subscribed = entry;
    const listener = () =>
      setSnapshot({
        key,
        value: subscribed.value,
        loading: subscribed.loading,
        error: subscribed.error,
      });
    subscribed.listeners.add(listener);
    listener();
    return () => {
      subscribed.listeners.delete(listener);
      if (!subscribed.listeners.size && entries.get(key) === subscribed)
        entries.delete(key);
    };
  }, [key, currentUser, semesterId]);
  useEffect(() => {
    const entry = entries.get(key);
    if (
      active &&
      entry &&
      (!entry.value || Date.now() - entry.fetchedAt >= CACHE_TTL_MS)
    )
      void readEntry(key, entry).catch(() => undefined);
  }, [active, key]);
  const visible = snapshot.key === key ? snapshot : null;
  return {
    items: visible?.value?.items || [],
    loaded: Boolean(visible?.value),
    loading: visible?.loading || false,
    error: visible?.error || "",
    save: (items: StudentLearningShortcutId[]) => {
      const entry = entries.get(key);
      return entry
        ? saveEntry(key, entry, [...items])
        : Promise.reject(changedSession());
    },
    reload: () => {
      const entry = entries.get(key);
      return entry ? readEntry(key, entry) : Promise.reject(changedSession());
    },
  };
}
