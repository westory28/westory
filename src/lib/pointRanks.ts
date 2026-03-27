import type {
  PointRankBadgeStyleToken,
  PointRankBasedOn,
  PointRankEmojiPolicy,
  PointRankEmojiPolicyTier,
  PointRankEmojiRegistryEntry,
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
  PointRankThemeOverride,
  PointRankThemeTierOverride,
  PointRankTierCode,
  PointTransaction,
  PointWallet,
} from "../types";
import {
  buildDefaultPointRankEmojiPolicy,
  DEFAULT_PROFILE_EMOJI_ID,
  DEFAULT_PROFILE_EMOJI_REGISTRY,
  getProfileEmojiEntryById,
  getProfileEmojiEntryByValue,
  getProfileEmojiRegistry,
  getProfileEmojiValueById,
  resolveProfileEmojiRegistry,
  sanitizeProfileEmojiIds,
} from "./profileEmojis";

export interface PointRankThemeTierMeta {
  label: string;
  shortLabel: string;
  description: string;
  badgeStyleToken: PointRankBadgeStyleToken | string;
  badgeClass: string;
}

interface PointRankThemeMeta {
  themeName: string;
  tiers: Partial<
    Record<PointRankTierCode, Omit<PointRankThemeTierMeta, "badgeClass">>
  >;
}

interface ResolvePointRankPolicyOptions {
  sortTiers?: boolean;
  sortEmojiRegistry?: boolean;
}

export interface PointRankDisplay {
  themeId: PointRankThemeId;
  themeName: string;
  tierCode: PointRankTierCode;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
  metricValue: number;
  minPoints: number;
  nextLabel: string | null;
  nextMinPoints: number | null;
  remainingToNext: number;
  progressPercent: number;
  basedOn: PointRankBasedOn;
  enabled: boolean;
}

export interface PointRankTierDisplayItem {
  code: PointRankTierCode;
  minPoints: number;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
  badgeStyleToken: PointRankBadgeStyleToken | string;
  themeId: PointRankThemeId;
  themeName: string;
  position: number;
}

type PointRankInput = {
  rankPolicy?: Partial<PointRankPolicy> | null;
  wallet?: Pick<PointWallet, "earnedTotal" | "rankEarnedTotal"> | null;
  earnedPointsFromTransactions?: number;
};

const DEFAULT_THEME_ID: PointRankThemeId = "korean_golpum";
const ALL_THEME_IDS: PointRankThemeId[] = ["korean_golpum", "world_nobility"];

const DEFAULT_TIERS: PointRankPolicyTier[] = [
  { code: "tier_1", minPoints: 0 },
  { code: "tier_2", minPoints: 50 },
  { code: "tier_3", minPoints: 150 },
  { code: "tier_4", minPoints: 300 },
  { code: "tier_5", minPoints: 500 },
];

const BADGE_STYLE_CLASS_MAP: Record<string, string> = {
  stone: "border-stone-200 bg-stone-50 text-stone-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  mint: "border-teal-200 bg-teal-50 text-teal-700",
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  red: "border-red-200 bg-red-50 text-red-700",
  pink: "border-pink-200 bg-pink-50 text-pink-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const BADGE_STYLE_TOKENS: PointRankBadgeStyleToken[] = [
  "stone",
  "blue",
  "sky",
  "emerald",
  "mint",
  "yellow",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
  "rose",
];

export const POINT_RANK_THEME_MAP: Record<
  PointRankThemeId,
  PointRankThemeMeta
> = {
  korean_golpum: {
    themeName: "골품제",
    tiers: {
      tier_1: {
        label: "4두품",
        shortLabel: "4두품",
        description: "누적 획득 위스 성장을 막 시작한 단계입니다.",
        badgeStyleToken: "stone",
      },
      tier_2: {
        label: "5두품",
        shortLabel: "5두품",
        description: "꾸준히 위스를 쌓아 가는 단계입니다.",
        badgeStyleToken: "blue",
      },
      tier_3: {
        label: "6두품",
        shortLabel: "6두품",
        description: "학습 활동 누적이 눈에 띄게 쌓인 단계입니다.",
        badgeStyleToken: "emerald",
      },
      tier_4: {
        label: "진골",
        shortLabel: "진골",
        description: "높은 누적 위스를 달성한 상위 단계입니다.",
        badgeStyleToken: "amber",
      },
      tier_5: {
        label: "성골",
        shortLabel: "성골",
        description: "가장 높은 누적 위스 등급입니다.",
        badgeStyleToken: "rose",
      },
    },
  },
  world_nobility: {
    themeName: "유럽 작위",
    tiers: {
      tier_1: {
        label: "남작",
        shortLabel: "남작",
        description: "누적 획득 위스 성장을 막 시작한 단계입니다.",
        badgeStyleToken: "stone",
      },
      tier_2: {
        label: "자작",
        shortLabel: "자작",
        description: "꾸준히 위스를 쌓아 가는 단계입니다.",
        badgeStyleToken: "blue",
      },
      tier_3: {
        label: "백작",
        shortLabel: "백작",
        description: "학습 활동 누적이 눈에 띄게 쌓인 단계입니다.",
        badgeStyleToken: "emerald",
      },
      tier_4: {
        label: "후작",
        shortLabel: "후작",
        description: "높은 누적 위스를 달성한 상위 단계입니다.",
        badgeStyleToken: "amber",
      },
      tier_5: {
        label: "공작",
        shortLabel: "공작",
        description: "가장 높은 누적 위스 등급입니다.",
        badgeStyleToken: "rose",
      },
    },
  },
};

const cloneDefaultTiers = () => DEFAULT_TIERS.map((tier) => ({ ...tier }));

const cloneDefaultRegistry = () =>
  DEFAULT_PROFILE_EMOJI_REGISTRY.map((entry) => ({
    ...entry,
    legacyValues: [...(entry.legacyValues || [])],
  }));

const normalizeThemeId = (value: unknown): PointRankThemeId =>
  value === "world_nobility" ? "world_nobility" : DEFAULT_THEME_ID;

const normalizeBadgeStyleToken = (
  value: unknown,
  fallbackIndex = 0,
): PointRankBadgeStyleToken | string => {
  const raw = String(value || "").trim();
  if (raw && BADGE_STYLE_CLASS_MAP[raw]) return raw;
  return BADGE_STYLE_TOKENS[fallbackIndex % BADGE_STYLE_TOKENS.length];
};

const getBadgeClassByToken = (
  token: PointRankBadgeStyleToken | string,
  fallbackIndex = 0,
) =>
  BADGE_STYLE_CLASS_MAP[token] ||
  BADGE_STYLE_CLASS_MAP[normalizeBadgeStyleToken("", fallbackIndex)] ||
  BADGE_STYLE_CLASS_MAP.stone;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

const stripUndefinedDeep = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce<Record<string, unknown>>(
    (accumulator, [key, entryValue]) => {
      if (entryValue === undefined) return accumulator;
      accumulator[key] = stripUndefinedDeep(entryValue);
      return accumulator;
    },
    {},
  ) as T;
};

export const parsePointRankTierIndex = (tierCode: PointRankTierCode) => {
  const parsed = Number(String(tierCode).replace("tier_", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeTierCode = (
  value: unknown,
  index: number,
): PointRankTierCode => {
  const raw = String(value || "").trim();
  if (/^tier_\d+$/.test(raw)) return raw as PointRankTierCode;
  return `tier_${index + 1}` as PointRankTierCode;
};

const normalizeTier = (
  tier:
    | (Partial<PointRankPolicyTier> & { threshold?: unknown })
    | null
    | undefined,
  index: number,
): PointRankPolicyTier => {
  const label = String(tier?.label || "").trim();
  const shortLabel = String(tier?.shortLabel || "").trim();
  const description = String(tier?.description || "").trim();
  const badgeStyleToken = String(tier?.badgeStyleToken || "").trim();
  const hasAllowedEmojiIds = Array.isArray(tier?.allowedEmojiIds);
  const allowedEmojiIds = hasAllowedEmojiIds
    ? (tier?.allowedEmojiIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  return {
    code: normalizeTierCode(tier?.code, index),
    minPoints: Math.max(0, Number(tier?.minPoints ?? tier?.threshold ?? 0)),
    ...(label ? { label } : {}),
    ...(shortLabel ? { shortLabel } : {}),
    ...(description ? { description } : {}),
    ...(badgeStyleToken ? { badgeStyleToken } : {}),
    ...(hasAllowedEmojiIds ? { allowedEmojiIds } : {}),
  };
};

const isValidBasedOn = (value: unknown): value is PointRankBasedOn =>
  value === "earnedTotal" ||
  value === "earnedTotal_plus_positive_manual_adjust";

const normalizeThemeTierOverride = (
  override: Partial<PointRankThemeTierOverride> | null | undefined,
  fallbackIndex: number,
) => {
  const label = String(override?.label || "").trim();
  const shortLabel = String(override?.shortLabel || "").trim();
  const description = String(override?.description || "").trim();
  const badgeStyleToken = String(override?.badgeStyleToken || "").trim();

  if (!label && !shortLabel && !description && !badgeStyleToken) {
    return undefined;
  }

  return {
    ...(label ? { label } : {}),
    ...(shortLabel ? { shortLabel } : {}),
    ...(description ? { description } : {}),
    ...(badgeStyleToken
      ? {
          badgeStyleToken: normalizeBadgeStyleToken(
            badgeStyleToken,
            fallbackIndex,
          ),
        }
      : {}),
  };
};

const normalizeThemeOverride = (
  rawTheme: Partial<PointRankThemeOverride> | null | undefined,
  tiers: PointRankPolicyTier[],
) => {
  const themeName = String(rawTheme?.themeName || "").trim();
  const resolvedTiers = tiers.reduce<
    NonNullable<PointRankThemeOverride["tiers"]>
  >((accumulator, tier, index) => {
    const nextTierOverride = normalizeThemeTierOverride(
      rawTheme?.tiers?.[tier.code],
      index,
    );
    if (nextTierOverride) {
      accumulator[tier.code] = nextTierOverride;
    }
    return accumulator;
  }, {});

  return {
    ...(themeName ? { themeName } : {}),
    tiers: resolvedTiers,
  };
};

const buildLegacyActiveThemeOverrides = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  activeThemeId: PointRankThemeId,
  tiers: PointRankPolicyTier[],
) => {
  const overrides = tiers.reduce<NonNullable<PointRankThemeOverride["tiers"]>>(
    (accumulator, tier, index) => {
      const nextTierOverride = normalizeThemeTierOverride(
        {
          label: tier.label,
          shortLabel: tier.shortLabel,
          description: tier.description,
          badgeStyleToken: tier.badgeStyleToken,
        },
        index,
      );
      if (nextTierOverride) {
        accumulator[tier.code] = nextTierOverride;
      }
      return accumulator;
    },
    {},
  );

  return Object.keys(overrides).length > 0
    ? {
        ...(rankPolicy?.themes?.[activeThemeId] || {}),
        tiers: {
          ...(rankPolicy?.themes?.[activeThemeId]?.tiers || {}),
          ...overrides,
        },
      }
    : rankPolicy?.themes?.[activeThemeId];
};

const buildThemeOverrides = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  tiers: PointRankPolicyTier[],
  activeThemeId: PointRankThemeId,
) =>
  ALL_THEME_IDS.reduce<NonNullable<PointRankPolicy["themes"]>>(
    (accumulator, themeId) => {
      const rawTheme =
        themeId === activeThemeId
          ? buildLegacyActiveThemeOverrides(rankPolicy, activeThemeId, tiers)
          : rankPolicy?.themes?.[themeId];
      const normalizedTheme = normalizeThemeOverride(rawTheme, tiers);
      if (
        normalizedTheme.themeName ||
        Object.keys(normalizedTheme.tiers).length > 0
      ) {
        accumulator[themeId] = normalizedTheme;
      }
      return accumulator;
    },
    {},
  );

const getResolvedThemeName = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  themeId: PointRankThemeId,
) => {
  const baseTheme =
    POINT_RANK_THEME_MAP[themeId] || POINT_RANK_THEME_MAP[DEFAULT_THEME_ID];
  const overrideName = String(
    rankPolicy?.themes?.[themeId]?.themeName || "",
  ).trim();
  return overrideName || baseTheme.themeName;
};

const getBaseTierMeta = (
  themeId: PointRankThemeId,
  tierCode: PointRankTierCode,
): Omit<PointRankThemeTierMeta, "badgeClass"> => {
  const theme =
    POINT_RANK_THEME_MAP[themeId] || POINT_RANK_THEME_MAP[DEFAULT_THEME_ID];
  const tier = theme.tiers[tierCode];
  if (tier) return tier;

  const tierIndex = parsePointRankTierIndex(tierCode);
  return {
    label: `${theme.themeName} ${tierIndex}단계`,
    shortLabel: `${tierIndex}단계`,
    description: "누적 획득 위스를 기준으로 계산한 등급입니다.",
    badgeStyleToken: normalizeBadgeStyleToken("", tierIndex - 1),
  };
};

const buildResolvedTiers = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  registry: PointRankEmojiRegistryEntry[],
  options?: { sortByMinPoints?: boolean },
) => {
  const rawTiers = Array.isArray(rankPolicy?.tiers)
    ? rankPolicy.tiers.map((tier, index) => normalizeTier(tier, index))
    : cloneDefaultTiers();
  const baseTiers = rawTiers.length > 0 ? [...rawTiers] : cloneDefaultTiers();
  if (options?.sortByMinPoints !== false) {
    baseTiers.sort((a, b) => a.minPoints - b.minPoints);
  }
  const defaultEmojiPolicy = buildDefaultPointRankEmojiPolicy(
    baseTiers,
    registry,
  );
  const rawTierMap = new Map(baseTiers.map((tier) => [tier.code, tier]));
  const usedEmojiIds = new Set<string>();

  const normalizedTiers = baseTiers.map((tier) => {
    const rawTier = rawTierMap.get(tier.code);
    const rawAllowedEmojiIds = rawTier?.allowedEmojiIds;
    const legacyAllowedEmojiIds =
      rankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds;
    const hasExplicitAllowedEmojiIds =
      Array.isArray(rawAllowedEmojiIds) || Array.isArray(legacyAllowedEmojiIds);
    const nextAllowedEmojiIds = sanitizeProfileEmojiIds(
      hasExplicitAllowedEmojiIds
        ? (rawAllowedEmojiIds ?? legacyAllowedEmojiIds ?? [])
        : defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || [],
      registry,
    ).filter((emojiId) => {
      if (usedEmojiIds.has(emojiId)) return false;
      usedEmojiIds.add(emojiId);
      return true;
    });

    const {
      label: _unusedLabel,
      shortLabel: _unusedShortLabel,
      description: _unusedDescription,
      ...normalizedTier
    } = tier;

    return {
      ...normalizedTier,
      allowedEmojiIds: nextAllowedEmojiIds,
    };
  });

  const enabledRegistry = registry.filter((entry) => entry.enabled !== false);
  const requestedDefaultEmojiId = String(
    rankPolicy?.emojiPolicy?.defaultEmojiId || "",
  ).trim();
  const defaultEmojiId =
    getProfileEmojiEntryById(requestedDefaultEmojiId, enabledRegistry)?.id ||
    getProfileEmojiEntryById(defaultEmojiPolicy.defaultEmojiId, enabledRegistry)
      ?.id ||
    enabledRegistry[0]?.id ||
    DEFAULT_PROFILE_EMOJI_ID;

  const firstTierCode = normalizedTiers[0]?.code;
  if (firstTierCode) {
    normalizedTiers.forEach((tier) => {
      tier.allowedEmojiIds = (tier.allowedEmojiIds || []).filter(
        (emojiId) => tier.code === firstTierCode || emojiId !== defaultEmojiId,
      );
    });
    const firstTier = normalizedTiers[0];
    firstTier.allowedEmojiIds = Array.from(
      new Set([defaultEmojiId, ...(firstTier.allowedEmojiIds || [])]),
    );
  }

  return {
    tiers: normalizedTiers,
    defaultEmojiId,
  };
};

const buildResolvedEmojiPolicy = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  tiers: PointRankPolicyTier[],
  defaultEmojiId: string,
) => {
  const legacyMode: PointRankEmojiPolicy["legacyMode"] =
    rankPolicy?.emojiPolicy?.legacyMode === "strict"
      ? "strict"
      : "keep_selected";

  return {
    enabled: rankPolicy?.emojiPolicy?.enabled !== false,
    defaultEmojiId,
    legacyMode,
    tiers: tiers.reduce<NonNullable<PointRankPolicy["emojiPolicy"]["tiers"]>>(
      (accumulator, tier) => {
        accumulator[tier.code] = {
          allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
        };
        return accumulator;
      },
      {},
    ),
  };
};

export const DEFAULT_POINT_RANK_POLICY: PointRankPolicy = (() => {
  const emojiRegistry = cloneDefaultRegistry();
  const tiers = cloneDefaultTiers();
  const defaultEmojiPolicy = buildDefaultPointRankEmojiPolicy(
    tiers,
    emojiRegistry,
  );
  return {
    enabled: true,
    activeThemeId: DEFAULT_THEME_ID,
    themeId: DEFAULT_THEME_ID,
    basedOn: "earnedTotal_plus_positive_manual_adjust",
    tiers: tiers.map((tier) => ({
      ...tier,
      allowedEmojiIds: [
        ...(defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || []),
      ],
    })),
    themes: {},
    emojiRegistry,
    emojiPolicy: {
      ...defaultEmojiPolicy,
      legacyMode: "keep_selected",
    },
    celebrationPolicy: {
      enabled: true,
      effectLevel: "standard",
    },
  };
})();

export const resolvePointRankPolicy = (
  rankPolicy?: Partial<PointRankPolicy> | null,
  options?: ResolvePointRankPolicyOptions,
): PointRankPolicy => {
  const activeThemeId = normalizeThemeId(
    rankPolicy?.activeThemeId ?? rankPolicy?.themeId,
  );
  const emojiRegistry = resolveProfileEmojiRegistry(rankPolicy?.emojiRegistry, {
    sort: options?.sortEmojiRegistry !== false,
  });
  const { tiers, defaultEmojiId } = buildResolvedTiers(
    rankPolicy,
    emojiRegistry,
    {
      sortByMinPoints: options?.sortTiers !== false,
    },
  );

  return {
    enabled: rankPolicy?.enabled !== false,
    activeThemeId,
    themeId: activeThemeId,
    basedOn: isValidBasedOn(rankPolicy?.basedOn)
      ? rankPolicy.basedOn
      : DEFAULT_POINT_RANK_POLICY.basedOn,
    tiers,
    themes: buildThemeOverrides(rankPolicy, tiers, activeThemeId),
    emojiRegistry,
    emojiPolicy: buildResolvedEmojiPolicy(rankPolicy, tiers, defaultEmojiId),
    celebrationPolicy: {
      enabled: rankPolicy?.celebrationPolicy?.enabled !== false,
      effectLevel:
        rankPolicy?.celebrationPolicy?.effectLevel === "subtle"
          ? "subtle"
          : "standard",
    },
  };
};

export const resolvePointRankPolicyDraft = (
  rankPolicy?: Partial<PointRankPolicy> | null,
) =>
  resolvePointRankPolicy(rankPolicy, {
    sortTiers: false,
    sortEmojiRegistry: false,
  });

export const buildPointRankPolicySavePayload = (
  rankPolicy?: Partial<PointRankPolicy> | null,
) => stripUndefinedDeep(resolvePointRankPolicy(rankPolicy));

export const getPointRankThemeName = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  themeId: PointRankThemeId,
) => getResolvedThemeName(resolvePointRankPolicy(rankPolicy), themeId);

export const getPointRankTierMeta = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  themeId: PointRankThemeId,
  tierCode: PointRankTierCode,
): PointRankThemeTierMeta => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const theme = resolvedPolicy.themes?.[themeId];
  const baseMeta = getBaseTierMeta(themeId, tierCode);
  const tierOverride = theme?.tiers?.[tierCode];
  const tierPosition = resolvedPolicy.tiers.findIndex(
    (tier) => tier.code === tierCode,
  );
  const badgeStyleToken =
    tierOverride?.badgeStyleToken ||
    resolvedPolicy.tiers.find((tier) => tier.code === tierCode)
      ?.badgeStyleToken ||
    baseMeta.badgeStyleToken;

  return {
    label: tierOverride?.label || baseMeta.label,
    shortLabel:
      tierOverride?.shortLabel ||
      tierOverride?.label ||
      baseMeta.shortLabel ||
      baseMeta.label,
    description: tierOverride?.description || baseMeta.description,
    badgeStyleToken,
    badgeClass: getBadgeClassByToken(
      badgeStyleToken,
      tierPosition >= 0 ? tierPosition : parsePointRankTierIndex(tierCode) - 1,
    ),
  };
};

export const getPointRankTierDisplayItems = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  options?: { themeId?: PointRankThemeId; descending?: boolean },
): PointRankTierDisplayItem[] => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const themeId = options?.themeId || resolvedPolicy.activeThemeId;
  const items = resolvedPolicy.tiers.map((tier, index) => {
    const tierMeta = getPointRankTierMeta(resolvedPolicy, themeId, tier.code);
    return {
      code: tier.code,
      minPoints: tier.minPoints,
      label: tierMeta.label,
      shortLabel: tierMeta.shortLabel,
      description: tierMeta.description,
      badgeClass: tierMeta.badgeClass,
      badgeStyleToken: tierMeta.badgeStyleToken,
      themeId,
      themeName: getResolvedThemeName(resolvedPolicy, themeId),
      position: index,
    };
  });

  return options?.descending === false ? items : [...items].reverse();
};

export const getPointRankEmojiRegistry = (
  rankPolicy?: Partial<PointRankPolicy> | null,
  preferredValues?: unknown,
  options?: { includeDisabled?: boolean },
) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  return getProfileEmojiRegistry(
    preferredValues,
    resolvedPolicy.emojiRegistry,
    options,
  );
};

export const getPointRankEmojiEntryById = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  emojiId: string,
) =>
  getProfileEmojiEntryById(
    emojiId,
    resolvePointRankPolicy(rankPolicy).emojiRegistry,
  );

export const getPointRankEmojiEntryByValue = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  value: string,
) =>
  getProfileEmojiEntryByValue(
    value,
    resolvePointRankPolicy(rankPolicy).emojiRegistry,
  );

export const getPointRankTierPosition = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  tierCode: PointRankTierCode | null | undefined,
) => {
  if (!tierCode) return -1;
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  return resolvedPolicy.tiers.findIndex((tier) => tier.code === tierCode);
};

export const createPointRankTierCode = (
  tiers: Array<Pick<PointRankPolicyTier, "code">>,
) => {
  const maxIndex = tiers.reduce(
    (maxValue, tier) => Math.max(maxValue, parsePointRankTierIndex(tier.code)),
    0,
  );
  return `tier_${maxIndex + 1}` as PointRankTierCode;
};

export const getPointRankPolicyValidationError = (
  rankPolicy?: Partial<PointRankPolicy> | null,
) => {
  const rawTiers = Array.isArray(rankPolicy?.tiers)
    ? rankPolicy.tiers.map((tier, index) => normalizeTier(tier, index))
    : cloneDefaultTiers();
  if (rawTiers.length === 0) {
    return "등급은 최소 1개 이상 필요합니다.";
  }

  const usedCodes = new Set<string>();
  for (let index = 0; index < rawTiers.length; index += 1) {
    const tier = rawTiers[index];
    if (usedCodes.has(tier.code)) {
      return "등급 코드가 중복되었습니다.";
    }
    usedCodes.add(tier.code);

    if (
      !Number.isFinite(Number(tier.minPoints)) ||
      Number(tier.minPoints) < 0
    ) {
      return "승급 기준 위스는 0 이상의 숫자여야 합니다.";
    }
  }

  const sortedTiers = [...rawTiers].sort((a, b) => a.minPoints - b.minPoints);
  for (let index = 1; index < sortedTiers.length; index += 1) {
    if (
      Number(sortedTiers[index - 1].minPoints) >=
      Number(sortedTiers[index].minPoints)
    ) {
      return "승급 기준 위스는 서로 다른 값으로 입력해 주세요.";
    }
  }

  const emojiRegistry = resolveProfileEmojiRegistry(rankPolicy?.emojiRegistry);
  const enabledEmojiCount = emojiRegistry.filter(
    (entry) => entry.enabled !== false,
  ).length;
  if (enabledEmojiCount === 0) {
    return "사용 가능한 이모지가 최소 1개 이상 필요합니다.";
  }

  return "";
};

export const isPointRankEarnTransaction = (
  transaction: Pick<PointTransaction, "type" | "delta">,
) =>
  [
    "attendance",
    "attendance_monthly_bonus",
    "quiz",
    "quiz_bonus",
    "lesson",
    "manual_adjust",
  ].includes(transaction.type) && Number(transaction.delta || 0) > 0;

export const sumPointRankEarnedPoints = (
  transactions: Array<Pick<PointTransaction, "type" | "delta">>,
) =>
  transactions.reduce(
    (total, transaction) =>
      isPointRankEarnTransaction(transaction)
        ? total + Number(transaction.delta || 0)
        : total,
    0,
  );

export const buildPointRankEarnedPointsByUid = (
  transactions: Array<Pick<PointTransaction, "uid" | "type" | "delta">>,
) =>
  transactions.reduce<Record<string, number>>((accumulator, transaction) => {
    const uid = String(transaction.uid || "").trim();
    if (!uid || !isPointRankEarnTransaction(transaction)) return accumulator;
    accumulator[uid] =
      Number(accumulator[uid] || 0) + Number(transaction.delta || 0);
    return accumulator;
  }, {});

export const hasPointRankEarnedTotalSnapshot = (
  wallet?: Pick<PointWallet, "rankEarnedTotal"> | null,
) => Number.isFinite(Number(wallet?.rankEarnedTotal));

export const needsPointRankLegacyFallback = (
  wallet?: Pick<PointWallet, "rankEarnedTotal"> | null,
) => !hasPointRankEarnedTotalSnapshot(wallet);

const getStoredRankEarnedTotal = (
  wallet?: Pick<PointWallet, "rankEarnedTotal"> | null,
) =>
  hasPointRankEarnedTotalSnapshot(wallet)
    ? Math.max(0, Number(wallet?.rankEarnedTotal || 0))
    : null;

const getPointRankMetricValue = ({
  wallet,
  rankPolicy,
  earnedPointsFromTransactions = 0,
}: PointRankInput) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const storedRankEarnedTotal = getStoredRankEarnedTotal(wallet);
  if (storedRankEarnedTotal !== null) {
    return storedRankEarnedTotal;
  }
  if (resolvedPolicy.basedOn === "earnedTotal") {
    return Math.max(0, Number(wallet?.earnedTotal || 0));
  }
  return Math.max(
    0,
    Number(wallet?.earnedTotal || 0) +
      Number(earnedPointsFromTransactions || 0),
  );
};

export const getPointRankAllowedEmojiIds = (
  rankPolicy?: Partial<PointRankPolicy> | null,
  currentTierCode?: PointRankTierCode | null,
) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const enabledRegistry = resolvedPolicy.emojiRegistry.filter(
    (entry) => entry.enabled !== false,
  );
  if (!resolvedPolicy.emojiPolicy.enabled) {
    return enabledRegistry.map((entry) => entry.id);
  }

  const targetTierCode =
    currentTierCode || resolvedPolicy.tiers[0]?.code || "tier_1";
  const targetTierIndex = resolvedPolicy.tiers.findIndex(
    (tier) => tier.code === targetTierCode,
  );
  const safeTargetTierIndex = targetTierIndex >= 0 ? targetTierIndex : 0;
  const allowedEmojiIds = resolvedPolicy.tiers.reduce<string[]>(
    (accumulator, tier, index) => {
      if (index > safeTargetTierIndex) return accumulator;
      return [...accumulator, ...(tier.allowedEmojiIds || [])];
    },
    [],
  );
  const uniqueAllowedEmojiIds = Array.from(
    new Set(
      allowedEmojiIds.filter((emojiId) => {
        const entry = getProfileEmojiEntryById(
          emojiId,
          resolvedPolicy.emojiRegistry,
        );
        return Boolean(entry && entry.enabled !== false);
      }),
    ),
  );

  return uniqueAllowedEmojiIds.length > 0
    ? uniqueAllowedEmojiIds
    : [resolvedPolicy.emojiPolicy.defaultEmojiId];
};

export const getPointRankUnlockTierCodeForEmoji = (
  rankPolicy: Partial<PointRankPolicy> | null | undefined,
  emojiId: string,
) => {
  const normalizedEmojiId = String(emojiId || "").trim();
  if (!normalizedEmojiId) return null;

  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const match = resolvedPolicy.tiers.find((tier) =>
    (tier.allowedEmojiIds || []).includes(normalizedEmojiId),
  );
  if (match) return match.code;

  if (normalizedEmojiId === resolvedPolicy.emojiPolicy.defaultEmojiId) {
    return resolvedPolicy.tiers[0]?.code || "tier_1";
  }

  return null;
};

export const isPointRankEmojiUnlocked = ({
  rankPolicy,
  currentTierCode,
  emojiId,
}: {
  rankPolicy?: Partial<PointRankPolicy> | null;
  currentTierCode?: PointRankTierCode | null;
  emojiId: string;
}) =>
  getPointRankAllowedEmojiIds(rankPolicy, currentTierCode).includes(
    String(emojiId || "").trim(),
  );

export const getPointRankDisplay = ({
  rankPolicy,
  wallet,
  earnedPointsFromTransactions = 0,
}: PointRankInput): PointRankDisplay | null => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  if (!resolvedPolicy.enabled) return null;

  const metricValue = getPointRankMetricValue({
    wallet,
    rankPolicy: resolvedPolicy,
    earnedPointsFromTransactions,
  });
  let activeTier = resolvedPolicy.tiers[0];
  let nextTier: PointRankPolicyTier | null = null;

  resolvedPolicy.tiers.forEach((tier, index) => {
    if (metricValue >= tier.minPoints) {
      activeTier = tier;
      nextTier = resolvedPolicy.tiers[index + 1] || null;
    }
  });

  if (!nextTier) {
    nextTier =
      resolvedPolicy.tiers.find((tier) => tier.minPoints > metricValue) || null;
  }

  const themeName = getResolvedThemeName(
    resolvedPolicy,
    resolvedPolicy.activeThemeId,
  );
  const tierMeta = getPointRankTierMeta(
    resolvedPolicy,
    resolvedPolicy.activeThemeId,
    activeTier.code,
  );
  const nextTierMeta = nextTier
    ? getPointRankTierMeta(
        resolvedPolicy,
        resolvedPolicy.activeThemeId,
        nextTier.code,
      )
    : null;
  const remainingToNext = nextTier
    ? Math.max(0, nextTier.minPoints - metricValue)
    : 0;
  const progressPercent = nextTier
    ? Math.min(
        100,
        Math.max(
          0,
          ((metricValue - activeTier.minPoints) /
            Math.max(nextTier.minPoints - activeTier.minPoints, 1)) *
            100,
        ),
      )
    : 100;

  return {
    themeId: resolvedPolicy.activeThemeId,
    themeName,
    tierCode: activeTier.code,
    label: tierMeta.label,
    shortLabel: tierMeta.shortLabel,
    description: tierMeta.description,
    badgeClass: tierMeta.badgeClass,
    metricValue,
    minPoints: activeTier.minPoints,
    nextLabel: nextTierMeta?.label || null,
    nextMinPoints: nextTier?.minPoints ?? null,
    remainingToNext,
    progressPercent,
    basedOn: resolvedPolicy.basedOn,
    enabled: resolvedPolicy.enabled,
  };
};

export const getPointRankUnlockedEmojiEntries = (
  rankPolicy?: Partial<PointRankPolicy> | null,
  currentTierCode?: PointRankTierCode | null,
) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  return getPointRankAllowedEmojiIds(resolvedPolicy, currentTierCode)
    .map((emojiId) =>
      getProfileEmojiEntryById(emojiId, resolvedPolicy.emojiRegistry),
    )
    .filter((entry): entry is PointRankEmojiRegistryEntry => Boolean(entry));
};

export const getPointRankNewlyUnlockedEmojiEntries = ({
  rankPolicy,
  previousTierCode,
  currentTierCode,
}: {
  rankPolicy?: Partial<PointRankPolicy> | null;
  previousTierCode?: PointRankTierCode | null;
  currentTierCode?: PointRankTierCode | null;
}) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  const previousIds = new Set(
    getPointRankAllowedEmojiIds(resolvedPolicy, previousTierCode),
  );
  return getPointRankAllowedEmojiIds(resolvedPolicy, currentTierCode)
    .filter((emojiId) => !previousIds.has(emojiId))
    .map((emojiId) =>
      getProfileEmojiEntryById(emojiId, resolvedPolicy.emojiRegistry),
    )
    .filter((entry): entry is PointRankEmojiRegistryEntry => Boolean(entry));
};

export const getPointRankDefaultEmojiValue = (
  rankPolicy?: Partial<PointRankPolicy> | null,
) => {
  const resolvedPolicy = resolvePointRankPolicy(rankPolicy);
  return (
    getProfileEmojiValueById(
      resolvedPolicy.emojiPolicy.defaultEmojiId,
      resolvedPolicy.emojiRegistry,
    ) ||
    DEFAULT_PROFILE_EMOJI_REGISTRY[0]?.emoji ||
    "😀"
  );
};
