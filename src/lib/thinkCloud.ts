import type { SystemConfig } from '../types';
import { getSemesterCollectionPath, getSemesterDocPath } from './semesterScope';

export type ThinkCloudInputMode = 'word' | 'sentence';
export type ThinkCloudSessionStatus = 'draft' | 'active' | 'closed';

export interface ThinkCloudOptions {
    allowDuplicatePerUser: boolean;
    inputMode: ThinkCloudInputMode;
    anonymous: boolean;
    maxLength: number;
    profanityFilter: boolean;
}

export interface ThinkCloudSession {
    title: string;
    description: string;
    status: ThinkCloudSessionStatus;
    options: ThinkCloudOptions;
    createdBy: string;
    createdByName: string;
    createdAt?: unknown;
    activatedAt?: unknown;
    closedAt?: unknown;
}

export interface ThinkCloudResponse {
    uid: string;
    displayName: string;
    textRaw: string;
    textNormalized: string;
    createdAt?: unknown;
}

export const THINK_CLOUD_STATE_DOC_ID = 'current';
export const THINK_CLOUD_SESSION_COLLECTION = 'think_cloud_sessions';
export const THINK_CLOUD_STATE_COLLECTION = 'think_cloud_state';

export const DEFAULT_THINK_CLOUD_OPTIONS: ThinkCloudOptions = {
    allowDuplicatePerUser: false,
    inputMode: 'word',
    anonymous: true,
    maxLength: 20,
    profanityFilter: true,
};

const toSafeSpace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const normalizeResponseText = (value: string, mode: ThinkCloudInputMode) => {
    const compact = toSafeSpace(value).toLowerCase();
    if (mode === 'word') {
        return compact.replace(/\s+/g, '');
    }
    return compact;
};

export const getInputValidationError = (value: string, options: ThinkCloudOptions) => {
    const trimmed = toSafeSpace(value);
    if (!trimmed) {
        return '내용을 입력해 주세요.';
    }
    if (trimmed.length > options.maxLength) {
        return `최대 ${options.maxLength}자까지 입력할 수 있습니다.`;
    }
    if (options.inputMode === 'word' && /\s/.test(trimmed)) {
        return '단어 1개만 입력해 주세요.';
    }
    return null;
};

export const buildThinkCloudStateDocPath = (config: SystemConfig | null | undefined) =>
    getSemesterDocPath(config, THINK_CLOUD_STATE_COLLECTION, THINK_CLOUD_STATE_DOC_ID);

export const buildThinkCloudSessionCollectionPath = (config: SystemConfig | null | undefined) =>
    getSemesterCollectionPath(config, THINK_CLOUD_SESSION_COLLECTION);

export const buildThinkCloudResponsesCollectionPath = (
    config: SystemConfig | null | undefined,
    sessionId: string,
) => `${buildThinkCloudSessionCollectionPath(config)}/${sessionId}/responses`;

export const createResponseDedupeId = (uid: string, normalizedText: string) => {
    let hash = 0;
    for (let i = 0; i < normalizedText.length; i += 1) {
        hash = (hash * 31 + normalizedText.charCodeAt(i)) | 0;
    }
    const hex = Math.abs(hash).toString(16);
    return `${uid}_${hex}`;
};

