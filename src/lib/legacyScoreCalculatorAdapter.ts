export type LegacyScoreValues = Record<string, string>;

export interface LegacyScoreDraftScope {
  uid: string;
  year: string;
  semester: string;
}

export interface LegacyScoreDraftSnapshot {
  scores: LegacyScoreValues;
  savedAt: number | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DRAFT_VERSION = 1;
const DRAFT_KEY_PREFIX = "westory:score-calculator:draft:v1";
const WARNING_KEY_PREFIX = "westory:score-calculator:warning:v1";
const MAX_SCORE_ENTRIES = 1000;
const SCORE_KEY_PATTERN = /^[^\r\n]{1,116}_\d{1,3}$/u;

const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value).trim();

const requireScopePart = (label: string, value: unknown) => {
  const normalized = text(value);
  if (!normalized || normalized.length > 160) {
    throw new Error(`Invalid legacy score calculator ${label}.`);
  }
  return normalized;
};

const normalizeScope = (
  scope: LegacyScoreDraftScope,
): LegacyScoreDraftScope => ({
  uid: requireScopePart("uid", scope.uid),
  year: requireScopePart("year", scope.year),
  semester: requireScopePart("semester", scope.semester),
});

const encodeKeyPart = (value: string) => encodeURIComponent(value);

export const getLegacyScoreDraftKey = (scope: LegacyScoreDraftScope) => {
  const normalized = normalizeScope(scope);
  return [
    DRAFT_KEY_PREFIX,
    encodeKeyPart(normalized.uid),
    encodeKeyPart(normalized.year),
    encodeKeyPart(normalized.semester),
  ].join(":");
};

const getLegacyScoreWarningKey = (uid: string) =>
  `${WARNING_KEY_PREFIX}:${encodeKeyPart(requireScopePart("uid", uid))}`;

export const sanitizeLegacyScoreValues = (
  value: unknown,
): LegacyScoreValues => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => SCORE_KEY_PATTERN.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_SCORE_ENTRIES);
  const scores: LegacyScoreValues = {};

  entries.forEach(([key, rawValue]) => {
    const normalized = text(rawValue);
    if (normalized === "") {
      scores[key] = "";
      return;
    }
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1000) return;
    scores[key] = String(numeric);
  });

  return scores;
};

export const saveLegacyScoreDraft = (
  storage: StorageLike,
  scope: LegacyScoreDraftScope,
  scores: LegacyScoreValues,
) => {
  const normalized = normalizeScope(scope);
  const savedAt = Date.now();
  storage.setItem(
    getLegacyScoreDraftKey(normalized),
    JSON.stringify({
      version: DRAFT_VERSION,
      ...normalized,
      scores: sanitizeLegacyScoreValues(scores),
      savedAt,
    }),
  );
  return savedAt;
};

export const loadLegacyScoreDraft = (
  storage: StorageLike,
  scope: LegacyScoreDraftScope,
): LegacyScoreDraftSnapshot => {
  const normalized = normalizeScope(scope);
  const raw = storage.getItem(getLegacyScoreDraftKey(normalized));
  if (!raw) {
    const previousBundleRaw = storage.getItem(
      `scoreDraft:${normalized.uid}:${normalized.year}:${normalized.semester}`,
    );
    if (!previousBundleRaw) return { scores: {}, savedAt: null };
    try {
      const previousBundleDraft = JSON.parse(previousBundleRaw) as Record<
        string,
        unknown
      >;
      const savedAt = Number(previousBundleDraft.savedAt);
      return {
        scores: sanitizeLegacyScoreValues(previousBundleDraft.scores),
        savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null,
      };
    } catch {
      return { scores: {}, savedAt: null };
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== DRAFT_VERSION ||
      text(parsed.uid) !== normalized.uid ||
      text(parsed.year) !== normalized.year ||
      text(parsed.semester) !== normalized.semester
    ) {
      return { scores: {}, savedAt: null };
    }
    const savedAt = Number(parsed.savedAt);
    return {
      scores: sanitizeLegacyScoreValues(parsed.scores),
      savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null,
    };
  } catch {
    return { scores: {}, savedAt: null };
  }
};

export const saveLegacyScoreWarningAcknowledgement = (
  storage: StorageLike,
  uid: string,
) => {
  const normalizedUid = requireScopePart("uid", uid);
  const acknowledgedAt = Date.now();
  storage.setItem(
    getLegacyScoreWarningKey(normalizedUid),
    JSON.stringify({
      version: DRAFT_VERSION,
      uid: normalizedUid,
      acknowledgedAt,
    }),
  );
  return acknowledgedAt;
};

export const loadLegacyScoreWarningAcknowledgement = (
  storage: StorageLike,
  uid: string,
) => {
  const normalizedUid = requireScopePart("uid", uid);
  const raw = storage.getItem(getLegacyScoreWarningKey(normalizedUid));
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (
      parsed.version === DRAFT_VERSION &&
      text(parsed.uid) === normalizedUid &&
      Number(parsed.acknowledgedAt) > 0
    );
  } catch {
    return false;
  }
};
