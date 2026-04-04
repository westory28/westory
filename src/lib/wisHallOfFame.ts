import defaultPodiumImage from '../assets/wis-hall-of-fame-podium.svg';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { getYearSemester } from './semesterScope';
import { readLocalOnly, writeLocalOnly } from './safeStorage';
import type {
  HallOfFameInterfaceConfig,
  HallOfFameLeaderboardPanelPosition,
  HallOfFamePodiumPositions,
  HallOfFamePodiumSlotPosition,
  InterfaceConfig,
  SystemConfig,
  UserData,
  WisHallOfFameEnsureResult,
  WisHallOfFameEntry,
  WisHallOfFameLeaderboardMeta,
  WisHallOfFameLeaderboardPolicy,
  WisHallOfFameRecognition,
  WisHallOfFameSnapshot,
} from '../types';

type ConfigLike = Pick<SystemConfig, 'year' | 'semester'> | null | undefined;

export const WIS_HALL_OF_FAME_GRADE_KEY = '3';
export const WIS_HALL_OF_FAME_DOC_ID = 'hall_of_fame';
export const WIS_HALL_OF_FAME_SNAPSHOT_VERSION = 6;
export const WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS = 4;
export const WIS_HALL_OF_FAME_STALE_MS = WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
export const DEFAULT_WIS_HALL_OF_FAME_POSITION_PRESET = 'classic_podium_v1';
export const DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL = defaultPodiumImage;
export const DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT = 10;
export const DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT = 20;

const WIS_HALL_OF_FAME_SEEN_KEY_PREFIX = 'wisHallOfFameSeen';

const DEFAULT_DESKTOP_POSITIONS: HallOfFamePodiumPositions = {
  first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
  second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
  third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
};

const DEFAULT_MOBILE_POSITIONS: HallOfFamePodiumPositions = {
  first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
  second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
  third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
};

const DEFAULT_DESKTOP_LEADERBOARD_PANEL: HallOfFameLeaderboardPanelPosition = {
  leftPercent: 71,
  topPercent: 0,
  widthPercent: 29,
};

const DEFAULT_MOBILE_LEADERBOARD_PANEL: HallOfFameLeaderboardPanelPosition = {
  leftPercent: 50,
  topPercent: 0,
  widthPercent: 100,
};

const toSafeText = (value: unknown) => String(value || '').trim();

const toNonNegativeNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : fallback;
};

const clampNumber = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, numericValue));
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
  leftPercent: clampNumber(value?.leftPercent, 0, 100, fallback.leftPercent),
  topPercent: clampNumber(value?.topPercent, 0, 100, fallback.topPercent),
  widthPercent: clampNumber(value?.widthPercent, 8, 72, fallback.widthPercent),
});

const normalizePositions = (
  value: Partial<HallOfFamePodiumPositions> | null | undefined,
  fallback: HallOfFamePodiumPositions,
): HallOfFamePodiumPositions => ({
  first: normalizeSlotPosition(value?.first, fallback.first),
  second: normalizeSlotPosition(value?.second, fallback.second),
  third: normalizeSlotPosition(value?.third, fallback.third),
});

const normalizeLeaderboardPanelPosition = (
  value: Partial<HallOfFameLeaderboardPanelPosition> | null | undefined,
  fallback: HallOfFameLeaderboardPanelPosition,
): HallOfFameLeaderboardPanelPosition => ({
  leftPercent: clampNumber(value?.leftPercent, 0, 100, fallback.leftPercent),
  topPercent: clampNumber(value?.topPercent, 0, 100, fallback.topPercent),
  widthPercent: clampNumber(
    value?.widthPercent,
    fallback.widthPercent >= 90 ? 78 : 24,
    fallback.widthPercent >= 90 ? 100 : 38,
    fallback.widthPercent,
  ),
});

const normalizeLeaderboardPolicy = (
  value?: Partial<WisHallOfFameLeaderboardPolicy> | null,
): WisHallOfFameLeaderboardPolicy => ({
  gradeRankLimit: clampNumber(value?.gradeRankLimit, 4, DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT, DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT),
  classRankLimit: clampNumber(value?.classRankLimit, 4, DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT, DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT),
  includeTies: value?.includeTies !== false,
  storedRankLimit: clampNumber(
    value?.storedRankLimit,
    DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT,
    50,
    DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT,
  ),
});

const normalizeLeaderboardMeta = (value: unknown): WisHallOfFameLeaderboardMeta | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<WisHallOfFameLeaderboardMeta>;
  return {
    storedRankLimit: clampNumber(raw.storedRankLimit, 1, 50, DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT),
    visibleCount: toNonNegativeNumber(raw.visibleCount),
    totalCandidates: toNonNegativeNumber(raw.totalCandidates),
    cutoffOrdinal: toNonNegativeNumber(raw.cutoffOrdinal),
    cutoffRank: toNonNegativeNumber(raw.cutoffRank),
    cutoffCumulativeEarned: toNonNegativeNumber(raw.cutoffCumulativeEarned),
    includeTies: raw.includeTies !== false,
  };
};

const normalizeEntry = (value: unknown): WisHallOfFameEntry | null => {
  const raw = value as Partial<WisHallOfFameEntry> | null | undefined;
  if (!raw) return null;

  const uid = toSafeText(raw.uid);
  const rank = Math.max(1, Math.round(Number(raw.rank || 0)));
  const podiumSlotRaw = Number(raw.podiumSlot || 0);
  const podiumSlot = podiumSlotRaw === 1 || podiumSlotRaw === 2 || podiumSlotRaw === 3
    ? podiumSlotRaw
    : undefined;
  const classKey = toSafeText(raw.classKey);
  const [classKeyGrade = '', classKeyClass = ''] = classKey.split('-');
  const grade = normalizeSchoolValue(raw.grade) || normalizeSchoolValue(classKeyGrade);
  const className = normalizeSchoolValue(raw.class) || normalizeSchoolValue(classKeyClass);
  const resolvedClassKey = classKey || buildWisHallOfFameClassKey(grade, className);
  const studentName = toSafeText(raw.studentName) || toSafeText(raw.displayName);
  const displayName = toSafeText(raw.displayName) || studentName;

  if (!uid || !rank || !grade || !className || !studentName) {
    return null;
  }

  return {
    uid,
    rank,
    podiumSlot,
    grade,
    class: className,
    classKey: resolvedClassKey,
    studentName: studentName || displayName,
    displayName,
    currentBalance: toNonNegativeNumber(raw.currentBalance),
    cumulativeEarned: toNonNegativeNumber(raw.cumulativeEarned),
    profileIcon: toSafeText(raw.profileIcon) || '😀',
    profileEmojiId: toSafeText(raw.profileEmojiId) || undefined,
  };
};

const normalizeEntryMap = (
  value: unknown,
  limit = Number.POSITIVE_INFINITY,
) => {
  if (!value || typeof value !== 'object') return {} as Record<string, WisHallOfFameEntry[]>;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, WisHallOfFameEntry[]>>(
    (accumulator, [key, entries]) => {
      const normalizedEntries = Array.isArray(entries)
        ? entries
          .map((entry) => normalizeEntry(entry))
          .filter((entry): entry is WisHallOfFameEntry => Boolean(entry))
          .slice(0, limit)
        : [];
      if (normalizedEntries.length > 0) {
        accumulator[key] = normalizedEntries;
      }
      return accumulator;
    },
    {},
  );
};

const normalizePodiumEntryMap = (value: unknown) => Object.entries(normalizeEntryMap(value)).reduce<
  Record<string, WisHallOfFameEntry[]>
>((accumulator, [key, entries]) => {
  const normalizedEntries = (entries || []).filter((entry) => Number(entry.rank || 0) <= 3);
  if (normalizedEntries.length > 0) {
    accumulator[key] = normalizedEntries.map((entry) => ({
      ...entry,
      podiumSlot: entry.rank === 1 || entry.rank === 2 || entry.rank === 3
        ? entry.rank
        : entry.podiumSlot,
    }));
  }
  return accumulator;
}, {});

const normalizeMetaMap = (value: unknown) => {
  if (!value || typeof value !== 'object') return {} as Record<string, WisHallOfFameLeaderboardMeta>;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, WisHallOfFameLeaderboardMeta>>(
    (accumulator, [key, meta]) => {
      const normalizedMeta = normalizeLeaderboardMeta(meta);
      if (normalizedMeta) {
        accumulator[key] = normalizedMeta;
      }
      return accumulator;
    },
    {},
  );
};

const toRecordObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const pickRecordCandidate = (...candidates: unknown[]) => {
  for (const candidate of candidates) {
    const record = toRecordObject(candidate);
    if (record) {
      return record;
    }
  }
  return null;
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

const resolveSnapshotSourceUpdatedAtMs = (
  raw: Partial<WisHallOfFameSnapshot> & {
    sourceUpdatedAtMs?: unknown;
    sourceUpdatedAt?: unknown;
  },
) => {
  const storedSourceUpdatedAtMs = toNonNegativeNumber(raw.sourceUpdatedAtMs);
  if (storedSourceUpdatedAtMs > 0) {
    return storedSourceUpdatedAtMs;
  }
  const sourceUpdatedAt = raw.sourceUpdatedAt as
    | { toMillis?: () => number; seconds?: number }
    | undefined;
  if (typeof sourceUpdatedAt?.toMillis === 'function') {
    return sourceUpdatedAt.toMillis();
  }
  const sourceUpdatedAtSeconds = Number(sourceUpdatedAt?.seconds || 0);
  if (sourceUpdatedAtSeconds > 0) {
    return sourceUpdatedAtSeconds * 1000;
  }
  return resolveSnapshotUpdatedAtMs(raw);
};

const buildPodiumEntriesFromLeaderboard = (entries: WisHallOfFameEntry[]) => entries
  .filter((entry) => Number(entry.rank || 0) > 0 && Number(entry.rank || 0) <= 3)
  .map((entry) => ({
    ...entry,
    podiumSlot: (entry.rank === 1 || entry.rank === 2 || entry.rank === 3
      ? entry.rank
      : entry.podiumSlot) as 1 | 2 | 3 | undefined,
  }));

const resolveBestPodiumEntries = (
  podiumEntries: WisHallOfFameEntry[] | null | undefined,
  leaderboardEntries: WisHallOfFameEntry[] | null | undefined,
) => {
  const normalizedPodiumEntries = podiumEntries || [];
  const rebuiltEntries = buildPodiumEntriesFromLeaderboard(leaderboardEntries || []);
  return rebuiltEntries.length > normalizedPodiumEntries.length
    ? rebuiltEntries
    : normalizedPodiumEntries;
};

export const DEFAULT_WIS_HALL_OF_FAME_PODIUM_POSITIONS = {
  desktop: DEFAULT_DESKTOP_POSITIONS,
  mobile: DEFAULT_MOBILE_POSITIONS,
} as const;

export const DEFAULT_WIS_HALL_OF_FAME_LEADERBOARD_PANEL = {
  desktop: DEFAULT_DESKTOP_LEADERBOARD_PANEL,
  mobile: DEFAULT_MOBILE_LEADERBOARD_PANEL,
} as const;

export const getDefaultHallOfFamePositions = () => ({
  desktop: { ...DEFAULT_DESKTOP_POSITIONS },
  mobile: { ...DEFAULT_MOBILE_POSITIONS },
});

export const getDefaultHallOfFameLeaderboardPanel = () => ({
  desktop: { ...DEFAULT_DESKTOP_LEADERBOARD_PANEL },
  mobile: { ...DEFAULT_MOBILE_LEADERBOARD_PANEL },
});

export const getDefaultHallOfFameLeaderboardPanelPosition = getDefaultHallOfFameLeaderboardPanel;

export const buildWisHallOfFameClassKey = (grade: unknown, className: unknown) => {
  const normalizedGrade = normalizeSchoolValue(grade);
  const normalizedClass = normalizeSchoolValue(className);
  return normalizedGrade && normalizedClass ? `${normalizedGrade}-${normalizedClass}` : '';
};

const resolveHallOfFameYearSemester = (config: ConfigLike) => {
  const year = toSafeText(config?.year);
  const semester = toSafeText(config?.semester);
  if (!year || !semester) return null;
  return { year, semester };
};

export const getWisHallOfFameDocPath = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `years/${year}/semesters/${semester}/point_public/${WIS_HALL_OF_FAME_DOC_ID}`;
};

export const normalizeWisHallOfFameSnapshot = (
  value: unknown,
): WisHallOfFameSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<WisHallOfFameSnapshot> & Record<string, unknown>;
  const updatedAtMs = resolveSnapshotUpdatedAtMs(raw as Partial<WisHallOfFameSnapshot> & { updatedAtMs?: unknown });
  const sourceUpdatedAtMs = resolveSnapshotSourceUpdatedAtMs(
    raw as Partial<WisHallOfFameSnapshot> & {
      sourceUpdatedAtMs?: unknown;
      sourceUpdatedAt?: unknown;
    },
  );
  const snapshotKey = toSafeText(raw.snapshotKey) || `${updatedAtMs || Date.now()}`;
  const legacyLeaderboard = pickRecordCandidate(raw.leaderboard);
  const legacyLeaderboardMeta = pickRecordCandidate(raw.leaderboardMeta);
  const rawGradeLeaderboardByGrade = pickRecordCandidate(
    raw.gradeLeaderboardByGrade,
    raw.gradeLeadersByGrade,
    legacyLeaderboard?.gradeLeaderboardByGrade,
    legacyLeaderboard?.gradeLeadersByGrade,
    legacyLeaderboard?.gradeByGrade,
  );
  const rawClassLeaderboardByClassKey = pickRecordCandidate(
    raw.classLeaderboardByClassKey,
    raw.classLeadersByClassKey,
    legacyLeaderboard?.classLeaderboardByClassKey,
    legacyLeaderboard?.classLeadersByClassKey,
    legacyLeaderboard?.classByClassKey,
  );
  const rawGradeLeaderboardMetaByGrade = pickRecordCandidate(
    raw.gradeLeaderboardMetaByGrade,
    raw.gradeLeadersMetaByGrade,
    legacyLeaderboardMeta?.gradeLeaderboardMetaByGrade,
    legacyLeaderboardMeta?.gradeLeadersByGrade,
    legacyLeaderboardMeta?.gradeByGrade,
  );
  const rawClassLeaderboardMetaByClassKey = pickRecordCandidate(
    raw.classLeaderboardMetaByClassKey,
    raw.classLeadersMetaByClassKey,
    legacyLeaderboardMeta?.classLeaderboardMetaByClassKey,
    legacyLeaderboardMeta?.classLeadersByClassKey,
    legacyLeaderboardMeta?.classByClassKey,
  );
  const normalizedGradeTop3ByGrade = normalizePodiumEntryMap(raw.gradeTop3ByGrade);
  const normalizedClassTop3ByClassKey = normalizePodiumEntryMap(raw.classTop3ByClassKey);
  const normalizedGradeLeaderboardByGrade = normalizeEntryMap(rawGradeLeaderboardByGrade);
  const normalizedClassLeaderboardByClassKey = normalizeEntryMap(rawClassLeaderboardByClassKey);
  return {
    year: toSafeText(raw.year) || undefined,
    semester: toSafeText(raw.semester) || undefined,
    snapshotVersion: Math.max(1, Math.round(Number(raw.snapshotVersion || WIS_HALL_OF_FAME_SNAPSHOT_VERSION))),
    snapshotKey,
    rankingMetric: raw.rankingMetric === 'cumulativeEarned' ? 'cumulativeEarned' : 'cumulativeEarned',
    primaryGradeKey: toSafeText(raw.primaryGradeKey) || WIS_HALL_OF_FAME_GRADE_KEY,
    gradeTop3ByGrade: Object.keys(normalizedGradeTop3ByGrade).length > 0
      ? normalizedGradeTop3ByGrade
      : Object.fromEntries(
        Object.entries(normalizedGradeLeaderboardByGrade).map(([key, entries]) => [key, buildPodiumEntriesFromLeaderboard(entries)]),
      ),
    classTop3ByClassKey: Object.keys(normalizedClassTop3ByClassKey).length > 0
      ? normalizedClassTop3ByClassKey
      : Object.fromEntries(
        Object.entries(normalizedClassLeaderboardByClassKey).map(([key, entries]) => [key, buildPodiumEntriesFromLeaderboard(entries)]),
      ),
    gradeLeaderboardByGrade: normalizedGradeLeaderboardByGrade,
    classLeaderboardByClassKey: normalizedClassLeaderboardByClassKey,
    gradeLeaderboardMetaByGrade: normalizeMetaMap(rawGradeLeaderboardMetaByGrade),
    classLeaderboardMetaByClassKey: normalizeMetaMap(rawClassLeaderboardMetaByClassKey),
    leaderboardPolicy: normalizeLeaderboardPolicy(raw.leaderboardPolicy),
    updatedAt: raw.updatedAt,
    updatedAtMs,
    sourceUpdatedAtMs,
  };
};

export const getWisHallOfFameSnapshot = async (
  config: ConfigLike,
): Promise<WisHallOfFameSnapshot | null> => {
  if (!resolveHallOfFameYearSemester(config)) return null;
  const snapshot = await getDoc(doc(db, getWisHallOfFameDocPath(config)));
  if (!snapshot.exists()) return null;
  return normalizeWisHallOfFameSnapshot(snapshot.data());
};

export const ensureWisHallOfFameSnapshot = async (
  config: ConfigLike,
  options?: { force?: boolean },
) => {
  const targetYearSemester = resolveHallOfFameYearSemester(config);
  if (!targetYearSemester) {
    throw new Error('Hall of fame requires current year/semester config.');
  }
  const { year, semester } = targetYearSemester;
  const callable = httpsCallable(functions, 'ensureWisHallOfFame');
  const result = await callable({
    year,
    semester,
    force: options?.force === true,
  });
  return result.data as WisHallOfFameEnsureResult;
};

export const getWisHallOfFame = getWisHallOfFameSnapshot;
export const ensureWisHallOfFame = ensureWisHallOfFameSnapshot;

export const saveWisHallOfFameConfig = async (
  config: ConfigLike,
  hallOfFame: HallOfFameInterfaceConfig,
) => {
  const targetYearSemester = resolveHallOfFameYearSemester(config);
  if (!targetYearSemester) {
    throw new Error('Hall of fame requires current year/semester config.');
  }
  const { year, semester } = targetYearSemester;
  const callable = httpsCallable(functions, 'saveWisHallOfFameConfig');
  const result = await callable({
    year,
    semester,
    hallOfFame,
  });
  const payload = result.data as {
    saved?: boolean;
    hallOfFame?: HallOfFameInterfaceConfig | null;
  };
  return {
    saved: payload?.saved === true,
    hallOfFame: resolveHallOfFameInterfaceConfig(payload?.hallOfFame || hallOfFame),
  };
};

const warnHallOfFameSnapshotFailure = (
  stage: string,
  config: ConfigLike,
  error: unknown,
) => {
  const targetYearSemester = resolveHallOfFameYearSemester(config);
  const scopeLabel = targetYearSemester
    ? `${targetYearSemester.year}/${targetYearSemester.semester}`
    : 'missing-year-semester';
  console.warn(`Failed to ${stage} wis hall of fame snapshot (${scopeLabel}):`, error);
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

const hasHallOfFameSnapshotRankingData = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
) => Object.keys(snapshot?.gradeTop3ByGrade || {}).length > 0
  || Object.keys(snapshot?.classTop3ByClassKey || {}).length > 0
  || Object.keys(snapshot?.gradeLeaderboardByGrade || {}).length > 0
  || Object.keys(snapshot?.classLeaderboardByClassKey || {}).length > 0;

const hasHallOfFameSnapshotLeaderboardData = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
) => Object.keys(snapshot?.gradeLeaderboardByGrade || {}).length > 0
  || Object.keys(snapshot?.classLeaderboardByClassKey || {}).length > 0;

const hasHallOfFameSnapshotLeaderboardMeta = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
) => Object.keys(snapshot?.gradeLeaderboardMetaByGrade || {}).length > 0
  || Object.keys(snapshot?.classLeaderboardMetaByClassKey || {}).length > 0;

const hasCompleteHallOfFameLeaderboardEntries = (
  leaderboardMap: Record<string, WisHallOfFameEntry[]> | null | undefined,
  metaMap: Record<string, WisHallOfFameLeaderboardMeta> | null | undefined,
) => Object.entries(metaMap || {}).every(([key, meta]) => {
  const expectedVisibleCount = Math.max(0, Number(meta?.visibleCount || 0));
  const totalCandidates = Math.max(0, Number(meta?.totalCandidates || 0));
  const actualVisibleCount = Array.isArray(leaderboardMap?.[key])
    ? leaderboardMap?.[key].length
    : 0;
  if (expectedVisibleCount > 0 && actualVisibleCount < expectedVisibleCount) {
    return false;
  }
  if (totalCandidates > 3 && actualVisibleCount <= 3) {
    return false;
  }
  return true;
});

const hasCompleteHallOfFameLeaderboardScopes = (
  podiumMap: Record<string, WisHallOfFameEntry[]> | null | undefined,
  leaderboardMap: Record<string, WisHallOfFameEntry[]> | null | undefined,
  metaMap: Record<string, WisHallOfFameLeaderboardMeta> | null | undefined,
) => {
  const scopeKeys = new Set([
    ...Object.keys(podiumMap || {}),
    ...Object.keys(leaderboardMap || {}),
    ...Object.keys(metaMap || {}),
  ]);

  return Array.from(scopeKeys).every((key) => {
    const podiumEntries = podiumMap?.[key] || [];
    const leaderboardEntries = leaderboardMap?.[key] || [];
    const scopeMeta = metaMap?.[key] || null;
    const hasPodiumEntries = podiumEntries.length > 0;
    const hasLeaderboardEntries = leaderboardEntries.length > 0;

    if ((hasPodiumEntries || hasLeaderboardEntries) && !scopeMeta) {
      return false;
    }
    if (hasPodiumEntries && !hasLeaderboardEntries) {
      return false;
    }
    if (!scopeMeta) {
      return true;
    }
    return leaderboardEntries.length >= Math.max(0, Number(scopeMeta.visibleCount || 0));
  });
};

export const isWisHallOfFameSnapshotStale = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
) => {
  if (!snapshot) return true;
  if (Number(snapshot.snapshotVersion || 0) !== WIS_HALL_OF_FAME_SNAPSHOT_VERSION) {
    return true;
  }
  if (
    hasHallOfFameSnapshotRankingData(snapshot)
    && (
      !hasHallOfFameSnapshotLeaderboardData(snapshot)
      || !hasHallOfFameSnapshotLeaderboardMeta(snapshot)
      || !hasCompleteHallOfFameLeaderboardEntries(
        snapshot?.gradeLeaderboardByGrade,
        snapshot?.gradeLeaderboardMetaByGrade,
      )
      || !hasCompleteHallOfFameLeaderboardEntries(
        snapshot?.classLeaderboardByClassKey,
        snapshot?.classLeaderboardMetaByClassKey,
      )
      || !hasCompleteHallOfFameLeaderboardScopes(
        snapshot?.gradeTop3ByGrade,
        snapshot?.gradeLeaderboardByGrade,
        snapshot?.gradeLeaderboardMetaByGrade,
      )
      || !hasCompleteHallOfFameLeaderboardScopes(
        snapshot?.classTop3ByClassKey,
        snapshot?.classLeaderboardByClassKey,
        snapshot?.classLeaderboardMetaByClassKey,
      )
    )
  ) {
    return true;
  }
  const updatedAtMs = getSnapshotUpdatedAtMs(snapshot);
  if (!updatedAtMs) return true;
  const sourceUpdatedAtMs = Math.max(0, Number(snapshot?.sourceUpdatedAtMs || 0));
  if (sourceUpdatedAtMs > updatedAtMs) {
    return true;
  }
  return (Date.now() - updatedAtMs) > WIS_HALL_OF_FAME_STALE_MS;
};

export const getOrEnsureWisHallOfFameSnapshot = async (
  config: ConfigLike,
): Promise<WisHallOfFameSnapshot | null> => {
  try {
    return await getWisHallOfFameSnapshot(config);
  } catch (error) {
    warnHallOfFameSnapshotFailure('read', config, error);
    return null;
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
  leaderboardPanel: {
    desktop: HallOfFameLeaderboardPanelPosition;
    mobile: HallOfFameLeaderboardPanelPosition;
  };
  publicRange: Required<NonNullable<HallOfFameInterfaceConfig['publicRange']>>;
  recognitionPopup: Required<NonNullable<HallOfFameInterfaceConfig['recognitionPopup']>>;
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
    leaderboardPanel: {
      desktop: normalizeLeaderboardPanelPosition(
        hallOfFameConfig.leaderboardPanel?.desktop,
        DEFAULT_DESKTOP_LEADERBOARD_PANEL,
      ),
      mobile: normalizeLeaderboardPanelPosition(
        hallOfFameConfig.leaderboardPanel?.mobile,
        DEFAULT_MOBILE_LEADERBOARD_PANEL,
      ),
    },
    publicRange: {
      gradeRankLimit: clampNumber(
        hallOfFameConfig.publicRange?.gradeRankLimit,
        4,
        DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT,
        DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT,
      ),
      classRankLimit: clampNumber(
        hallOfFameConfig.publicRange?.classRankLimit,
        4,
        DEFAULT_WIS_HALL_OF_FAME_STORED_RANK_LIMIT,
        DEFAULT_WIS_HALL_OF_FAME_PUBLIC_RANK_LIMIT,
      ),
      includeTies: hallOfFameConfig.publicRange?.includeTies !== false,
    },
    recognitionPopup: {
      enabled: hallOfFameConfig.recognitionPopup?.enabled !== false,
      gradeEnabled: hallOfFameConfig.recognitionPopup?.gradeEnabled !== false,
      classEnabled: hallOfFameConfig.recognitionPopup?.classEnabled !== false,
    },
  };
};

export const normalizeHallOfFameInterfaceConfig = resolveHallOfFameInterfaceConfig;

export const resolveHallOfFameLeaderboardPolicy = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  interfaceConfig?: InterfaceConfig | HallOfFameInterfaceConfig | null,
) => {
  const normalizedConfig = resolveHallOfFameInterfaceConfig(interfaceConfig);
  const snapshotPolicy = normalizeLeaderboardPolicy(snapshot?.leaderboardPolicy);
  const storedRankLimit = Math.max(
    normalizedConfig.publicRange.gradeRankLimit,
    normalizedConfig.publicRange.classRankLimit,
    Number(snapshotPolicy.storedRankLimit || 0),
  );

  return {
    gradeRankLimit: clampNumber(
      normalizedConfig.publicRange.gradeRankLimit,
      4,
      storedRankLimit,
      snapshotPolicy.gradeRankLimit,
    ),
    classRankLimit: clampNumber(
      normalizedConfig.publicRange.classRankLimit,
      4,
      storedRankLimit,
      snapshotPolicy.classRankLimit,
    ),
    includeTies: normalizedConfig.publicRange.includeTies,
    storedRankLimit,
  };
};

export const getHallOfFameEntryByRank = (
  entries: WisHallOfFameEntry[] | null | undefined,
  rank: number,
) => (entries || []).find((entry) => entry.podiumSlot === rank || entry.rank === rank) || null;

const findHallOfFameEntryByUidInMap = (
  entryMap: Record<string, WisHallOfFameEntry[]> | null | undefined,
  uid: string,
) => {
  const normalizedUid = toSafeText(uid);
  if (!normalizedUid) return null;

  for (const entries of Object.values(entryMap || {})) {
    const matchedEntry = (entries || []).find((entry) => entry.uid === normalizedUid);
    if (matchedEntry) {
      return matchedEntry;
    }
  }

  return null;
};

export const findWisHallOfFameEntryByUid = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  uid: string,
) => {
  const normalizedUid = toSafeText(uid);
  if (!snapshot || !normalizedUid) return null;

  return (
    findHallOfFameEntryByUidInMap(snapshot.gradeLeaderboardByGrade, normalizedUid)
    || findHallOfFameEntryByUidInMap(snapshot.gradeTop3ByGrade, normalizedUid)
    || findHallOfFameEntryByUidInMap(snapshot.classLeaderboardByClassKey, normalizedUid)
    || findHallOfFameEntryByUidInMap(snapshot.classTop3ByClassKey, normalizedUid)
  );
};

export const getWisHallOfFameGradeEntries = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade = snapshot?.primaryGradeKey || WIS_HALL_OF_FAME_GRADE_KEY,
) => {
  const key = toSafeText(grade);
  if (!key) return [];
  return resolveBestPodiumEntries(
    snapshot?.gradeTop3ByGrade?.[key],
    snapshot?.gradeLeaderboardByGrade?.[key],
  );
};

export const getWisHallOfFameClassEntries = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade: unknown,
  className: unknown,
) => {
  const classKey = buildWisHallOfFameClassKey(grade, className);
  if (!classKey) return [];
  return resolveBestPodiumEntries(
    snapshot?.classTop3ByClassKey?.[classKey],
    snapshot?.classLeaderboardByClassKey?.[classKey],
  );
};

export const getWisHallOfFameGradeLeaderboard = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade = snapshot?.primaryGradeKey || WIS_HALL_OF_FAME_GRADE_KEY,
) => snapshot?.gradeLeaderboardByGrade?.[toSafeText(grade)] || [];

export const getWisHallOfFameGradeLeaderboardEntries = getWisHallOfFameGradeLeaderboard;

export const getWisHallOfFameClassLeaderboard = (
  snapshot: WisHallOfFameSnapshot | null | undefined,
  grade: unknown,
  className: unknown,
) => {
  const classKey = buildWisHallOfFameClassKey(grade, className);
  return classKey ? snapshot?.classLeaderboardByClassKey?.[classKey] || [] : [];
};

export const getWisHallOfFameClassLeaderboardEntries = getWisHallOfFameClassLeaderboard;

export const applyHallOfFameRankLimit = (
  entries: WisHallOfFameEntry[] | null | undefined,
  limit: number,
  includeTies = true,
) => {
  const safeEntries = entries || [];
  if (safeEntries.length === 0) return [];
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];
  const limited = safeEntries.slice(0, safeLimit);
  if (!includeTies || limited.length >= safeEntries.length) {
    return limited;
  }

  const cutoffEntry = limited[limited.length - 1];
  if (!cutoffEntry) {
    return limited;
  }
  const cutoffScore = Number(cutoffEntry.cumulativeEarned || 0);
  let endIndex = limited.length;
  while (
    endIndex < safeEntries.length
    && Number(safeEntries[endIndex]?.cumulativeEarned || 0) === cutoffScore
  ) {
    endIndex += 1;
  }
  return safeEntries.slice(0, endIndex);
};

export const getHallOfFameLeaderboardTailEntries = (
  entries: WisHallOfFameEntry[] | null | undefined,
  podiumCount = 3,
) => {
  const safeEntries = entries || [];
  const safePodiumCount = Math.max(0, Math.floor(podiumCount));
  return safeEntries.filter((entry, index) => {
    const rank = Number(entry.rank || 0);
    if (Number.isFinite(rank) && rank > 0) {
      return rank > safePodiumCount;
    }
    return index >= safePodiumCount;
  });
};

export const isHallOfFameRecognitionEnabled = (
  interfaceConfig?: InterfaceConfig | HallOfFameInterfaceConfig | null,
  scope?: WisHallOfFameRecognition['scope'],
) => {
  const normalizedConfig = resolveHallOfFameInterfaceConfig(interfaceConfig);
  if (!normalizedConfig.recognitionPopup.enabled) return false;
  if (scope === 'grade') return normalizedConfig.recognitionPopup.gradeEnabled;
  if (scope === 'class') return normalizedConfig.recognitionPopup.classEnabled;
  return true;
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
  const classRecognition = getWisHallOfFameClassEntries(snapshot, userData?.grade, userData?.class)
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
