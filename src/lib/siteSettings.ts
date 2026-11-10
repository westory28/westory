import { doc, getDoc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { withRequestDeadline } from "./requestDeadline";

const SITE_SETTINGS_CACHE_TTL_MS = 30_000;
const SITE_SETTINGS_READ_TIMEOUT_MS = 12_000;

interface SiteSettingCacheEntry {
  expiresAt: number;
  hasValue: boolean;
  value: unknown;
  promise?: Promise<unknown>;
}

const siteSettingCache = new Map<string, SiteSettingCacheEntry>();

export const invalidateSiteSettingDocCache = (docId?: string) => {
  if (!docId) {
    siteSettingCache.clear();
    return;
  }
  siteSettingCache.delete(docId);
};

export const readSiteSettingDoc = async <T>(
  docId: string,
): Promise<T | null> => {
  const now = Date.now();
  const cached = siteSettingCache.get(docId);

  if (cached?.promise) {
    return cached.promise as Promise<T | null>;
  }

  if (cached?.hasValue && cached.expiresAt > now) {
    return cached.value as T | null;
  }

  const entry: SiteSettingCacheEntry = {
    expiresAt: now + SITE_SETTINGS_CACHE_TTL_MS,
    hasValue: cached?.hasValue === true,
    value: cached?.value ?? null,
  };
  const promise = withRequestDeadline(
    getDoc(doc(db, "site_settings", docId)),
    SITE_SETTINGS_READ_TIMEOUT_MS,
    "화면 설정 조회가 지연되고 있습니다. 다시 시도해 주세요.",
  )
    .then((snapshot) => {
      const value = snapshot.exists() ? (snapshot.data() as T) : null;
      if (siteSettingCache.get(docId) === entry)
        siteSettingCache.set(docId, {
          expiresAt: Date.now() + SITE_SETTINGS_CACHE_TTL_MS,
          hasValue: true,
          value,
        });
      return value;
    })
    .catch((error) => {
      if (siteSettingCache.get(docId) === entry) siteSettingCache.delete(docId);
      throw error;
    });

  entry.promise = promise;
  siteSettingCache.set(docId, entry);

  return promise as Promise<T | null>;
};

export const readFreshSiteSettingDoc = async <T>(
  docId: string,
): Promise<T | null> => {
  const entry: SiteSettingCacheEntry = {
    expiresAt: 0,
    hasValue: false,
    value: null,
  };
  siteSettingCache.set(docId, entry);
  const request = withRequestDeadline(
    getDocFromServer(doc(db, "site_settings", docId)),
    SITE_SETTINGS_READ_TIMEOUT_MS,
    "공개 설정 조회가 지연되고 있습니다. 다시 시도해 주세요.",
  )
    .then((snapshot) => {
      const value = snapshot.exists() ? (snapshot.data() as T) : null;
      if (siteSettingCache.get(docId) === entry)
        siteSettingCache.set(docId, {
          expiresAt: Date.now() + SITE_SETTINGS_CACHE_TTL_MS,
          hasValue: true,
          value,
        });
      return value;
    })
    .catch((error) => {
      if (siteSettingCache.get(docId) === entry) siteSettingCache.delete(docId);
      throw error;
    });
  entry.promise = request;
  return request;
};
