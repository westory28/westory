import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const SITE_SETTINGS_CACHE_TTL_MS = 30_000;

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

export const readSiteSettingDoc = async <T>(docId: string): Promise<T | null> => {
    const now = Date.now();
    const cached = siteSettingCache.get(docId);

    if (cached?.promise) {
        return cached.promise as Promise<T | null>;
    }

    if (cached?.hasValue && cached.expiresAt > now) {
        return cached.value as T | null;
    }

    const promise = getDoc(doc(db, 'site_settings', docId))
        .then((snapshot) => {
            const value = snapshot.exists() ? (snapshot.data() as T) : null;
            siteSettingCache.set(docId, {
                expiresAt: Date.now() + SITE_SETTINGS_CACHE_TTL_MS,
                hasValue: true,
                value,
            });
            return value;
        })
        .catch((error) => {
            siteSettingCache.delete(docId);
            throw error;
        });

    siteSettingCache.set(docId, {
        expiresAt: now + SITE_SETTINGS_CACHE_TTL_MS,
        hasValue: cached?.hasValue === true,
        value: cached?.value ?? null,
        promise,
    });

    return promise as Promise<T | null>;
};
