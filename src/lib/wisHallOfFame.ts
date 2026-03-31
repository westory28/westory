import defaultPodiumImage from '../assets/wis-hall-of-fame-podium.svg';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { getYearSemester } from './semesterScope';
import { readLocalOnly, writeLocalOnly } from './safeStorage';
import type {
  HallOfFameInterfaceConfig,
  HallOfFamePodiumPositions,
  HallOfFamePodiumSlotPosition,
  InterfaceConfig,
  SystemConfig,
  UserData,
  WisHallOfFameEntry,
  WisHallOfFameEnsureResult,
  WisHallOfFameRecognition,
  WisHallOfFameSnapshot,
} from '../types';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

export const WIS_HALL_OF_FAME_GRADE_KEY = '3';
export const WIS_HALL_OF_FAME_DOC_ID = 'hall_of_fame';
export const WIS_HALL_OF_FAME_SNAPSHOT_VERSION = 1;
export const WIS_HALL_OF_FAME_STALE_MS = 10 * 60 * 1000;
export const DEFAULT_WIS_HALL_OF_FAME_POSITION_PRESET = 'classic_podium_v1';
export const DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL = defaultPodiumImage;

const WIS_HALL_OF_FAME_SEEN_KEY_PREFIX = 'wisHallOfFameSeen';

const DEFAULT_DESKTOP_POSITIONS: HallOfFamePodiumPositions = {
  first: { leftPercent: 50, topPercent: 25, widthPercent: 24 },
  second: { leftPercent: 22, topPercent: 43, widthPercent: 22 },
  third: { leftPercent: 78, topPercent: 43, widthPercent: 22 },
};

const DEFAULT_MOBILE_POSITIONS: HallOfFamePodiumPositions = {
  first: { leftPercent: 50, topPercent: 27, widthPercent: 31 },
  second: { leftPercent: 22, topPercent: 50, widthPercent: 27 },
  third: { leftPercent: 78, topPercent: 50, widthPercent: 27 },
};

const toSafeText = (value: unknown) => String(value || '').trim();

const toNonNegativeNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : fallback;
};

const normalizeSchoolValue = (value: unknown) => {
  const normalized = toSafeText(value);
  if (!normalized) return '';
  const digits = normalized.match(/\d+/)?.[0] || '';
  if (!digits) return normalized;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : normalized;
};

const normalizeSlotPosition = (
  value: Partial<HallOfFamePodiumSlotPosition> | null | undefined,
  fallback: HallOfFamePodiumSlotPosition,
): HallOfFamePodiumSlotPosition => ({
  leftPercent: toNonNegativeNumber(value?.leftPercent, fallback.leftPercent),
  topPercent: toNonNegativeNumber(value?.topPercent, fallback.topPercent),
  widthPercent: Math.max(8, toNonNegativeNumber(value?.widthPercent, fallback.widthPercent)),
});

const normalizePositions = (
  value: Partial<HallOfFamePodiumPositions> | null | undefined,
  fallback: HallOfFamePodiumPositions,
): HallOfFamePodiumPositions => ({
  first: normalizeSlotPosition(value?.first, fallback.first),
  second: normalizeSlotPosition(value?.second, fallback.second),
  third: normalizeSlotPosition(value?.third, fallback.third),
});

export const DEFAULT_WIS_HALL_OF_FAME_PODIUM_POSITIONS = {
  desktop: DEFAULT_DESKTOP_POSITIONS,
  mobile: DEFAULT_MOBILE_POSITIONS,
} as const;

export const getDefaultHallOfFamePositions = () => ({
  desktop: { ...DEFAULT_DESKTOP_POSITIONS },
  mobile: { ...DEFAULT_MOBILE_POSITIONS },
});

export const buildWisHallOfFameClassKey = (grade: unknown, className: unknown) => {
  const normalizedGrade = normalizeSchoolValue(grade);
  const normalizedClass = normalizeSchoolValue(className);
  return normalizedGrade && normalizedClass ? `${normalizedGrade}-${normalizedClass}` : '';
};

export const getWisHallOfFameDocPath = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `years/${year}/semesters/${semester}/point_public/${WIS_HALL_OF_FAME_DOC_ID}`;
};

const normalizeEntry = (value: unknown): WisHallOfFameEntry | null => {
  const raw = value as Partial<WisHallOfFameEntry> | null | undefined;
  if (!raw) return null;

  const uid = toSafeText(raw.uid);
  const rankValue = Number(raw.rank || 0);
  const rank = rankValue === 1 || rankValue === 2 || rankValue === 3 ? rankValue : null;
  const grade = normalizeSchoolValue(raw.grade);
  const className = normalizeSchoolValue(raw.class);
  const classKey = toSafeText(raw.classKey) || buildWisHallOfFameClassKey(grade, className);
  const studentName = toSafeText(raw.studentName);
  const displayName = toSafeText(raw.displayName) || studentName;

  if (!uid || !rank || !grade || !className || !displayName) {
    return null;
  }

  return {
    uid,
    rank,
    grade,
    class: className,
    classKey,
    studentName: studentName || displayName,
    displayName,
    currentBalance: toNonNegativeNumber(raw.currentBalance),
    cumulativeEarned: toNonNegativeNumber(raw.cumulativeEarned),
    profileIcon: toSafeText(raw.profileIcon) || '😀',
    profileEmojiId: toSafeText(raw.profileEmojiId) || undefined,
  };
};

const normalizeEntryMap = (value: unknown) => {
  if (!value || typeof value !== 'object') return {} as Record<string, WisHallOfFameEntry[]>;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, WisHallOfFameEntry[]>>(
    (accumulator, [key, entries]) => {
      const normalizedEntries = Array.isArray(entries)
        ? entries.map((entry) => normalizeEntry(entry)).filter((entry): entry is WisHallOfFameEntry => Boolean(entry))
        : [];
      if (normalizedEntries.length > 0) {
        accumulator[key] = normalizedEntries.slice(0, 3);
      }
      return accumulator;
    },
    {},
  );
};

const resolveSnapshotUpdatedAtMs = (
  raw: Partial<WisHallOfFameSnapshot> & { updatedAtMs?: unknown },
) => {
  const storedUpdatedAtMs = toNonNegativeNumber(raw.updatedAtMs);
  if (storedUpdatedAtMs > 0) {
    return storedUpdatedAtMs;
  }
  const updatedAt = raw.updatedAt as { toMillis?: () => number; seconds?: number } | undefined;
  if (typeof updatedAt?.toMillis === 'function') {
    return updatedAt.toMillis();
  }
  return Number(updatedAt?.seconds || 0) * 1000;
};

export const normalizeWisHallOfFameSnapshot = (
  value: unknown,
): WisHallOfFameSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<WisHallOfFameSnapshot>;
  const updatedAtMs = resolveSnapshotUpdatedAtMs(raw as Partial<WisHallOfFameSnapshot> & { updatedAtMs?: unknown });
  const snapshotKey = toSafeText(raw.snapshotKey) || `${updatedAtMs || Date.now()}`;

  return {
    year: toSafeText(raw.year) || undefined,
    semester: toSafeText(raw.semester) || undefined,
    snapshotVersion: Math.max(1, Math.round(Number(raw.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION))),
    snapshotKey,
    rankingMetric: raw.rankingMetric === 'cumulativeEarned' ? 'cumulativeEarned' : 'cumulativeEarned',
    primaryGradeKey: toSafeText(raw.primaryGradeKey) || WIS_HALL_OF_FAME_GRADE_KEY,
    gradeTop3ByGrade: normalizeEntryMap(raw.gradeTop3ByGrade),
    classTop3ByClassKey: normalizeEntryMap(raw.classTop3ByClassKey),
    updatedAt: raw.updatedAt,
    updatedAtMs,
  };
};

export const getWisHallOfFameSnapshot = async (
  config: ConfigLike,
): Promise<WisHallOfFameSnapshot | null> => {
  const snapshot = await getDoc(doc(db, getWisHallOfFameDocPath(config)));
  if (!snapshot.exists()) return null;
  return normalizeWisHallOfFameSnapshot(snapshot.data());
};

export const ensureWisHallOfFameSnapshot = async (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, 'ensureWisHallOfFame');
  const result = await callable({
    year,
    semester,
  });
  return result.data as WisHallOfFameEnsureResult;
};

export const getWisHallOfFame = getWisHallOfFameSnapshot;
export const ensureWisHallOfFame = ensureWisHallOfFameSnapshot;

const warnHallOfFameSnapshotFailure = (
  stage: string,
  config: ConfigLike,
  error: unknown,
) => {
  const { year, semester } = getYearSemester(config);
  console.warn(`Failed to ${stage} wis hall of fame snapshot (${year}/${semester}):`, error);
};

const getSnapshotUpdatedAtMs = (snapshot: WisHallOfFameSnapshot | null | undefined) => {
  if (!snapshot) return 0;
  if (Number.isFinite(Number(snapshot.updatedAtMs))) {
    return Number(snapshot.updatedAtMs || 0);
  }
  const updatedAt = snapshot.updatedAt as { toMillis?: () => number; seconds?: number } | undefined;
  if (typeof updatedAt?.toMillis === 'function') {
    return updatedAt.toMillis();
  }
  return Number(updatedAt?.seconds || 0) * 1000;
};

export const isWisHallOfFameSnapshotStale = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
) => {
  if (!snapshot) return true;
  if (Number(snapshot.snapshotVersion || 0) !== WIS_HALL_OF_FAME_SNAPSHOT_VERSION) {
    return true;
  }
  const updatedAtMs = getSnapshotUpdatedAtMs(snapshot);
  if (!updatedAtMs) return true;
  return (Date.now() - updatedAtMs) > WIS_HALL_OF_FAME_STALE_MS;
};

export const getOrEnsureWisHallOfFameSnapshot = async (
  config: ConfigLike,
): Promise<WisHallOfFameSnapshot | null> => {
  let currentSnapshot: WisHallOfFameSnapshot | null = null;
  try {
    currentSnapshot = await getWisHallOfFameSnapshot(config);
  } catch (error) {
    warnHallOfFameSnapshotFailure('read', config, error);
  }

  if (currentSnapshot && !isWisHallOfFameSnapshotStale(currentSnapshot)) {
    return currentSnapshot;
  }

  try {
    await ensureWisHallOfFameSnapshot(config);
  } catch (error) {
    warnHallOfFameSnapshotFailure('ensure', config, error);
    return currentSnapshot;
  }

  try {
    const refreshedSnapshot = await getWisHallOfFameSnapshot(config);
    return refreshedSnapshot || currentSnapshot;
  } catch (error) {
    warnHallOfFameSnapshotFailure('reload', config, error);
    return currentSnapshot;
  }
};

export const resolveHallOfFameInterfaceConfig = (
  interfaceConfig?: InterfaceConfig | HallOfFameInterfaceConfig | null,
): Required<Pick<HallOfFameInterfaceConfig, 'positionPreset'>> & {
  podiumImageUrl: string;
  podiumStoragePath: string;
  positions: {
    desktop: HallOfFamePodiumPositions;
    mobile: HallOfFamePodiumPositions;
  };
} => {
  const hallOfFameConfig: HallOfFameInterfaceConfig = interfaceConfig && 'hallOfFame' in interfaceConfig
    ? (interfaceConfig.hallOfFame || {})
    : ((interfaceConfig || {}) as HallOfFameInterfaceConfig);

  return {
    podiumImageUrl: toSafeText(hallOfFameConfig.podiumImageUrl),
    podiumStoragePath: toSafeText(hallOfFameConfig.podiumStoragePath),
    positionPreset: toSafeText(hallOfFameConfig.positionPreset) || DEFAULT_WIS_HALL_OF_FAME_POSITION_PRESET,
    positions: {
      desktop: normalizePositions(hallOfFameConfig.positions?.desktop, DEFAULT_DESKTOP_POSITIONS),
      mobile: normalizePositions(hallOfFameConfig.positions?.mobile, DEFAULT_MOBILE_POSITIONS),
    },
  };
};

export const normalizeHallOfFameInterfaceConfig = resolveHallOfFameInterfaceConfig;

export const getHallOfFameEntryByRank = (
  entries: WisHallOfFameEntry[] | null | undefined,
  rank: 1 | 2 | 3,
) => (entries || []).find((entry) => entry.rank === rank) || null;

export const getWisHallOfFameGradeEntries = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade = snapshot?.primaryGradeKey || WIS_HALL_OF_FAME_GRADE_KEY,
) => snapshot?.gradeTop3ByGrade?.[toSafeText(grade)] || [];

export const getWisHallOfFameClassEntries = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade: unknown,
  className: unknown,
) => {
  const classKey = buildWisHallOfFameClassKey(grade, className);
  return classKey ? snapshot?.classTop3ByClassKey?.[classKey] || [] : [];
};

export const findWisHallOfFameRecognition = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  userData?: Pick<UserData, 'uid' | 'grade' | 'class'> | null,
): WisHallOfFameRecognition | null => {
  const uid = toSafeText(userData?.uid);
  if (!snapshot || !uid) return null;
  const primaryGradeKey = snapshot.primaryGradeKey || WIS_HALL_OF_FAME_GRADE_KEY;

  const gradeRecognition = getWisHallOfFameGradeEntries(snapshot, primaryGradeKey)
    .find((entry) => entry.uid === uid);
  if (gradeRecognition) {
    return {
      scope: 'grade',
      scopeKey: primaryGradeKey,
      entry: gradeRecognition,
      snapshotKey: snapshot.snapshotKey,
    };
  }

  const classKey = buildWisHallOfFameClassKey(userData?.grade, userData?.class);
  if (!classKey) return null;
  const classRecognition = (snapshot.classTop3ByClassKey?.[classKey] || [])
    .find((entry) => entry.uid === uid);
  if (!classRecognition) return null;

  return {
    scope: 'class',
    scopeKey: classKey,
    entry: classRecognition,
    snapshotKey: snapshot.snapshotKey,
  };
};

export const buildWisHallOfFameSeenStorageKey = (
  config: ConfigLike,
  recognition: WisHallOfFameRecognition,
) => {
  const { year, semester } = getYearSemester(config);
  return [
    WIS_HALL_OF_FAME_SEEN_KEY_PREFIX,
    year,
    semester,
    recognition.snapshotKey,
    recognition.scope,
    recognition.scopeKey,
    recognition.entry.uid,
    recognition.entry.rank,
  ].join(':');
};

export const hasSeenWisHallOfFameRecognition = (
  config: ConfigLike,
  recognition: WisHallOfFameRecognition,
) => readLocalOnly(buildWisHallOfFameSeenStorageKey(config, recognition)) === '1';

export const markWisHallOfFameRecognitionSeen = (
  config: ConfigLike,
  recognition: WisHallOfFameRecognition,
) => {
  writeLocalOnly(buildWisHallOfFameSeenStorageKey(config, recognition), '1');
};
