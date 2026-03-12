import { lazy } from 'react';

const RETRY_PREFIX = 'westory-lazy-retry:';

const isChunkLoadError = (error: unknown) => {
    const message = String((error as { message?: string })?.message || error || '');
    return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('ChunkLoadError') ||
        message.includes('Loading chunk') ||
        message.includes('error loading dynamically imported module')
    );
};

export const lazyWithRetry = <T extends { default: React.ComponentType<any> }>(
    importer: () => Promise<T>,
    key: string,
) => lazy(async () => {
    try {
        const loaded = await importer();
        if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(`${RETRY_PREFIX}${key}`);
        }
        return loaded;
    } catch (error) {
        if (typeof window !== 'undefined' && isChunkLoadError(error)) {
            const storageKey = `${RETRY_PREFIX}${key}`;
            const alreadyRetried = window.sessionStorage.getItem(storageKey) === '1';
            if (!alreadyRetried) {
                window.sessionStorage.setItem(storageKey, '1');
                window.location.reload();
                return new Promise(() => undefined);
            }
        }
        throw error;
    }
});
