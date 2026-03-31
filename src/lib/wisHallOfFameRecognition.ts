import type { SystemConfig, UserData, WisHallOfFameRecognition } from '../types';
import {
    buildWisHallOfFameSeenStorageKey,
    findWisHallOfFameRecognition,
    getOrEnsureWisHallOfFameSnapshot,
} from './wisHallOfFame';
import { readLocalOnly, writeLocalOnly } from './safeStorage';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

export interface HallOfFameRecognition {
    seenKey: string;
    rank: number;
    grade: string;
    className: string;
    studentName: string;
    profileIcon: string;
    scope: WisHallOfFameRecognition['scope'];
    headline: string;
    message: string;
}

const buildHeadline = (scope: WisHallOfFameRecognition['scope']) => (
    scope === 'grade'
        ? '축하합니다! 화랑의 전당에 올랐어요.'
        : '축하합니다! 우리 반 화랑으로 빛났어요.'
);

const buildMessage = (scope: WisHallOfFameRecognition['scope']) => (
    scope === 'grade'
        ? '이번 학기 3학년 전교 랭킹에 이름을 올렸어요.'
        : '이번 학기 우리 반을 빛낸 화랑이에요.'
);

export const markHallOfFameRecognitionSeen = (seenKey: string) => {
    writeLocalOnly(seenKey, '1');
};

export const loadHallOfFameRecognition = async (
    config: ConfigLike,
    userData: Pick<UserData, 'uid' | 'grade' | 'class'> | null | undefined,
): Promise<HallOfFameRecognition | null> => {
    const snapshot = await getOrEnsureWisHallOfFameSnapshot(config);
    const recognition = findWisHallOfFameRecognition(snapshot, userData);
    if (!recognition) return null;

    const seenKey = buildWisHallOfFameSeenStorageKey(config, recognition);
    if (readLocalOnly(seenKey) === '1') {
        return null;
    }

    return {
        seenKey,
        rank: recognition.entry.rank,
        grade: recognition.entry.grade,
        className: recognition.entry.class,
        studentName: recognition.entry.displayName || recognition.entry.studentName,
        profileIcon: recognition.entry.profileIcon,
        scope: recognition.scope,
        headline: buildHeadline(recognition.scope),
        message: buildMessage(recognition.scope),
    };
};
