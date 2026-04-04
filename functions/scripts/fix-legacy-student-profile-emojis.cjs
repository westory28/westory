const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  initializeApp,
  applicationDefault,
  getApps,
} = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const DEFAULT_PROJECT_ID = "history-quiz-yongsin";
const DEFAULT_SAMPLE_LIMIT = 20;
const FIREBASE_CLI_CLIENT_ID =
  process.env.FIREBASE_CLIENT_ID ||
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET =
  process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi";
const DEFAULT_POINT_RANK_TIERS = [
  { code: "tier_1", minPoints: 0 },
  { code: "tier_2", minPoints: 50 },
  { code: "tier_3", minPoints: 150 },
  { code: "tier_4", minPoints: 300 },
  { code: "tier_5", minPoints: 500 },
];
const DEFAULT_PROFILE_EMOJI_ID = "smile";
const PROFILE_EMOJI_REGISTRY = [
  { id: "smile", emoji: "😀", value: "😀", label: "웃는 얼굴", category: "기본", sortOrder: 10, enabled: true, unlockTierCode: "tier_1", legacyValues: [] },
  { id: "soft_smile", emoji: "🙂", value: "🙂", label: "미소", category: "기본", sortOrder: 20, enabled: true, unlockTierCode: "tier_1", legacyValues: [] },
  { id: "note", emoji: "📝", value: "📝", label: "메모", category: "학습", sortOrder: 30, enabled: true, unlockTierCode: "tier_1", legacyValues: [] },
  { id: "book", emoji: "📚", value: "📚", label: "책", category: "학습", sortOrder: 40, enabled: true, unlockTierCode: "tier_1", legacyValues: [] },
  { id: "cool", emoji: "😎", value: "😎", label: "선글라스", category: "표정", sortOrder: 50, enabled: true, unlockTierCode: "tier_2", legacyValues: [] },
  { id: "brain", emoji: "🧠", value: "🧠", label: "두뇌", category: "학습", sortOrder: 60, enabled: true, unlockTierCode: "tier_2", legacyValues: [] },
  { id: "clover", emoji: "🍀", value: "🍀", label: "행운", category: "자연", sortOrder: 70, enabled: true, unlockTierCode: "tier_2", legacyValues: [] },
  { id: "target", emoji: "🎯", value: "🎯", label: "목표", category: "학습", sortOrder: 80, enabled: true, unlockTierCode: "tier_2", legacyValues: [] },
  { id: "nerd", emoji: "🤓", value: "🤓", label: "공부 모드", category: "표정", sortOrder: 90, enabled: true, unlockTierCode: "tier_3", legacyValues: [] },
  { id: "trophy", emoji: "🏆", value: "🏆", label: "트로피", category: "성취", sortOrder: 100, enabled: true, unlockTierCode: "tier_3", legacyValues: [] },
  { id: "rocket", emoji: "🚀", value: "🚀", label: "로켓", category: "성취", sortOrder: 110, enabled: true, unlockTierCode: "tier_3", legacyValues: [] },
  { id: "school", emoji: "🏫", value: "🏫", label: "학교", category: "학습", sortOrder: 120, enabled: true, unlockTierCode: "tier_3", legacyValues: [] },
  { id: "sparkles", emoji: "🌟", value: "🌟", label: "반짝별", category: "반짝임", sortOrder: 130, enabled: true, unlockTierCode: "tier_4", legacyValues: [] },
  { id: "science", emoji: "🧪", value: "🧪", label: "실험", category: "학습", sortOrder: 140, enabled: true, unlockTierCode: "tier_4", legacyValues: [] },
  { id: "tiger", emoji: "🐯", value: "🐯", label: "호랑이", category: "동물", sortOrder: 150, enabled: true, unlockTierCode: "tier_4", legacyValues: [] },
  { id: "panda", emoji: "🐼", value: "🐼", label: "판다", category: "동물", sortOrder: 160, enabled: true, unlockTierCode: "tier_4", legacyValues: [] },
  { id: "pencil", emoji: "✏️", value: "✏️", label: "연필", category: "학습", sortOrder: 170, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
  { id: "bear", emoji: "🐻", value: "🐻", label: "곰", category: "동물", sortOrder: 180, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
  { id: "fox", emoji: "🦊", value: "🦊", label: "여우", category: "동물", sortOrder: 190, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
  { id: "dolphin", emoji: "🐬", value: "🐬", label: "돌고래", category: "동물", sortOrder: 200, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
  { id: "owl", emoji: "🦉", value: "🦉", label: "부엉이", category: "동물", sortOrder: 210, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
  { id: "whale", emoji: "🐳", value: "🐳", label: "고래", category: "동물", sortOrder: 220, enabled: true, unlockTierCode: "tier_5", legacyValues: [] },
];

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const resolveProjectId = () =>
  getArgValue("project") ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  DEFAULT_PROJECT_ID;

const resolveSampleLimit = () => {
  const raw = Number(getArgValue("sample-limit") || DEFAULT_SAMPLE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SAMPLE_LIMIT;
};

const resolveFirebaseCliConfigPath = () => {
  if (process.env.FIREBASE_TOOLS_CONFIG_PATH) {
    return process.env.FIREBASE_TOOLS_CONFIG_PATH;
  }

  const candidates = [
    path.join(
      process.env.USERPROFILE || "",
      ".config",
      "configstore",
      "firebase-tools.json",
    ),
    path.join(process.env.APPDATA || "", "configstore", "firebase-tools.json"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
};

const loadFirebaseCliRefreshToken = () => {
  const configPath = resolveFirebaseCliConfigPath();
  if (!configPath) return null;

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const refreshToken = raw?.tokens?.refresh_token;
  const email = raw?.user?.email || "";
  if (!refreshToken) return null;

  return {
    configPath,
    email,
    refreshToken,
  };
};

const ensureCredentialSource = () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      type: "google-application-credentials",
      path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      cleanup: () => undefined,
    };
  }

  const cliAuth = loadFirebaseCliRefreshToken();
  if (!cliAuth) {
    throw new Error(
      [
        "No application default credentials were found.",
        "Set GOOGLE_APPLICATION_CREDENTIALS or sign in with `npx firebase-tools login` first.",
      ].join(" "),
    );
  }

  const credentialPath = path.join(
    os.tmpdir(),
    `westory-${(cliAuth.email || "firebase-cli").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}-adc.json`,
  );
  const payload = {
    type: "authorized_user",
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: cliAuth.refreshToken,
  };
  fs.writeFileSync(credentialPath, JSON.stringify(payload, null, 2));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;

  return {
    type: "firebase-cli-login",
    path: cliAuth.configPath,
    email: cliAuth.email,
    cleanup: () => {
      try {
        fs.unlinkSync(credentialPath);
      } catch (error) {
        if (error && error.code !== "ENOENT") {
          console.warn(
            "[cleanup] Failed to remove temporary ADC file:",
            error.message || error,
          );
        }
      }
    },
  };
};

const cloneDefaultEmojiRegistry = () => PROFILE_EMOJI_REGISTRY.map((entry) => ({
  ...entry,
  legacyValues: [...(entry.legacyValues || [])],
}));

const normalizeEmojiText = (value) => String(value || "").trim();

const buildEmojiMaps = (registry) => {
  const byId = new Map();
  const byValue = new Map();
  registry.forEach((entry) => {
    byId.set(entry.id, entry);
    byValue.set(entry.emoji, entry);
    byValue.set(entry.value || entry.emoji, entry);
    (entry.legacyValues || []).forEach((legacyValue) => {
      if (!byValue.has(legacyValue)) {
        byValue.set(legacyValue, entry);
      }
    });
  });
  return { byId, byValue };
};

const getProfileEmojiEntryById = (emojiId, registry = PROFILE_EMOJI_REGISTRY) =>
  buildEmojiMaps(registry).byId.get(String(emojiId || "").trim()) || null;

const getProfileEmojiEntryByValue = (value, registry = PROFILE_EMOJI_REGISTRY) =>
  buildEmojiMaps(registry).byValue.get(normalizeEmojiText(value)) || null;

const getEnabledEmojiRegistry = (registry) =>
  registry.filter((entry) => entry.enabled !== false);

const parseTierIndex = (tierCode) => {
  const parsed = Number(String(tierCode || "").replace("tier_", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeTierCode = (value, index) => {
  const raw = String(value || "").trim();
  return /^tier_\d+$/.test(raw) ? raw : `tier_${index + 1}`;
};

const normalizeRankTier = (tier, index) => ({
  code: normalizeTierCode(tier?.code, index),
  minPoints: Math.max(0, Number(tier?.minPoints ?? tier?.threshold ?? 0)),
  allowedEmojiIds: Array.isArray(tier?.allowedEmojiIds)
    ? tier.allowedEmojiIds.map((value) => String(value || "").trim()).filter(Boolean)
    : undefined,
});

const ensureUniqueEmojiId = (candidateId, usedIds, fallbackIndex) => {
  const baseId =
    String(candidateId || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `emoji_${fallbackIndex + 1}`;
  let nextId = baseId;
  let suffix = 2;
  while (usedIds.has(nextId)) {
    nextId = `${baseId}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(nextId);
  return nextId;
};

const resolveEmojiRegistry = (rawRegistry) => {
  if (!Array.isArray(rawRegistry)) {
    return cloneDefaultEmojiRegistry();
  }

  const usedIds = new Set();
  const entries = rawRegistry
    .map((entry, index) => {
      const fallbackEntry = PROFILE_EMOJI_REGISTRY[index] || {};
      const emoji = normalizeEmojiText(entry?.emoji || entry?.value || fallbackEntry.emoji || "");
      if (!emoji) return null;
      const rawValue = normalizeEmojiText(entry?.value);
      return {
        id: ensureUniqueEmojiId(entry?.id || fallbackEntry.id || entry?.label || emoji, usedIds, index),
        emoji,
        value: emoji,
        label: String(entry?.label || fallbackEntry.label || `emoji ${index + 1}`).trim(),
        category: String(entry?.category || fallbackEntry.category || "기타").trim() || "기타",
        sortOrder: Number.isFinite(Number(entry?.sortOrder))
          ? Number(entry.sortOrder)
          : Number(fallbackEntry.sortOrder || (index + 1) * 10),
        enabled: entry?.enabled !== false,
        unlockTierCode: /^tier_\d+$/.test(String(entry?.unlockTierCode || ""))
          ? String(entry.unlockTierCode).trim()
          : fallbackEntry.unlockTierCode,
        legacyValues: Array.from(
          new Set(
            [
              ...(Array.isArray(entry?.legacyValues)
                ? entry.legacyValues.map((value) => String(value || "").trim()).filter(Boolean)
                : []),
              rawValue && rawValue !== emoji ? rawValue : "",
            ].filter(Boolean),
          ),
        ),
      };
    })
    .filter(Boolean);

  if (!entries.length) {
    return cloneDefaultEmojiRegistry();
  }

  return [...entries].sort((a, b) => {
    const sortGap = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (sortGap !== 0) return sortGap;
    return String(a.label || "").localeCompare(String(b.label || ""), "ko");
  });
};

const sanitizeEmojiIds = (raw, registry) =>
  Array.from(
    new Set(
      Array.isArray(raw)
        ? raw
            .map((value) => String(value || "").trim())
            .filter((emojiId) => {
              const entry = getProfileEmojiEntryById(emojiId, registry);
              return Boolean(entry && entry.enabled !== false);
            })
        : [],
    ),
  );

const getClampedTierCode = (requestedTierCode, tiers) => {
  if (!tiers.length) return requestedTierCode;
  const requestedIndex = parseTierIndex(requestedTierCode);
  const matchedTier = tiers
    .map((tier) => ({ tier, index: parseTierIndex(tier.code) }))
    .find(({ index }) => index >= requestedIndex);
  return matchedTier?.tier.code || tiers[tiers.length - 1].code;
};

const buildDefaultRankEmojiPolicy = (tiers, registry) => {
  const enabledRegistry = getEnabledEmojiRegistry(registry);
  const tierUnlocks = tiers.reduce(
    (accumulator, tier) => ({
      ...accumulator,
      [tier.code]: {
        allowedEmojiIds: [],
      },
    }),
    {},
  );

  enabledRegistry.forEach((entry) => {
    const tierCode = getClampedTierCode(entry.unlockTierCode || tiers[0]?.code || "tier_1", tiers);
    const currentTier = tierUnlocks[tierCode] || { allowedEmojiIds: [] };
    currentTier.allowedEmojiIds = [...currentTier.allowedEmojiIds, entry.id];
    tierUnlocks[tierCode] = currentTier;
  });

  const requestedDefaultEmojiId =
    getProfileEmojiEntryById(DEFAULT_PROFILE_EMOJI_ID, enabledRegistry)?.id ||
    enabledRegistry[0]?.id ||
    DEFAULT_PROFILE_EMOJI_ID;
  const firstTierCode = tiers[0]?.code;
  if (firstTierCode) {
    const firstTier = tierUnlocks[firstTierCode] || { allowedEmojiIds: [] };
    if (!firstTier.allowedEmojiIds.includes(requestedDefaultEmojiId)) {
      firstTier.allowedEmojiIds = [requestedDefaultEmojiId, ...firstTier.allowedEmojiIds];
    }
    tierUnlocks[firstTierCode] = {
      allowedEmojiIds: Array.from(new Set(firstTier.allowedEmojiIds)),
    };
  }

  return {
    enabled: true,
    defaultEmojiId: requestedDefaultEmojiId,
    legacyMode: "keep_selected",
    tiers: tierUnlocks,
  };
};

const resolveRankPolicy = (rawRankPolicy) => {
  const emojiRegistry = resolveEmojiRegistry(rawRankPolicy?.emojiRegistry);
  const tiers = Array.isArray(rawRankPolicy?.tiers)
    ? rawRankPolicy.tiers
        .map((tier, index) => normalizeRankTier(tier, index))
        .sort((a, b) => a.minPoints - b.minPoints)
    : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const normalizedTiers =
    tiers.length > 0 ? tiers : DEFAULT_POINT_RANK_TIERS.map((tier) => ({ ...tier }));
  const defaultEmojiPolicy = buildDefaultRankEmojiPolicy(normalizedTiers, emojiRegistry);
  const usedEmojiIds = new Set();
  const nextTiers = normalizedTiers.map((tier) => {
    const hasExplicitAllowedEmojiIds =
      Array.isArray(tier.allowedEmojiIds) ||
      Array.isArray(rawRankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds);
    const requestedAllowedEmojiIds = hasExplicitAllowedEmojiIds
      ? tier.allowedEmojiIds || rawRankPolicy?.emojiPolicy?.tiers?.[tier.code]?.allowedEmojiIds || []
      : defaultEmojiPolicy.tiers[tier.code]?.allowedEmojiIds || [];
    const allowedEmojiIds = sanitizeEmojiIds(requestedAllowedEmojiIds, emojiRegistry).filter((emojiId) => {
      if (usedEmojiIds.has(emojiId)) return false;
      usedEmojiIds.add(emojiId);
      return true;
    });
    return {
      ...tier,
      allowedEmojiIds,
    };
  });

  const enabledRegistry = getEnabledEmojiRegistry(emojiRegistry);
  const defaultEmojiId =
    getProfileEmojiEntryById(rawRankPolicy?.emojiPolicy?.defaultEmojiId, enabledRegistry)?.id ||
    getProfileEmojiEntryById(defaultEmojiPolicy.defaultEmojiId, enabledRegistry)?.id ||
    enabledRegistry[0]?.id ||
    DEFAULT_PROFILE_EMOJI_ID;
  const firstTierCode = nextTiers[0]?.code;
  if (firstTierCode) {
    nextTiers.forEach((tier) => {
      tier.allowedEmojiIds = (tier.allowedEmojiIds || []).filter(
        (emojiId) => tier.code === firstTierCode || emojiId !== defaultEmojiId,
      );
    });
    nextTiers[0].allowedEmojiIds = Array.from(
      new Set([defaultEmojiId, ...(nextTiers[0].allowedEmojiIds || [])]),
    );
  }

  const emojiPolicyTiers = nextTiers.reduce((accumulator, tier) => {
    accumulator[tier.code] = {
      allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
    };
    return accumulator;
  }, {});

  return {
    enabled: rawRankPolicy?.enabled !== false,
    activeThemeId: "korean_golpum",
    themeId: "korean_golpum",
    basedOn:
      rawRankPolicy?.basedOn === "earnedTotal" ||
      rawRankPolicy?.basedOn === "earnedTotal_plus_positive_manual_adjust"
        ? rawRankPolicy.basedOn
        : "earnedTotal_plus_positive_manual_adjust",
    tiers: nextTiers,
    emojiRegistry,
    emojiPolicy: {
      enabled: rawRankPolicy?.emojiPolicy?.enabled !== false,
      defaultEmojiId,
      legacyMode:
        rawRankPolicy?.emojiPolicy?.legacyMode === "strict" ? "strict" : "keep_selected",
      tiers: emojiPolicyTiers,
    },
  };
};

const buildRankSnapshot = (rankEarnedTotal, rankPolicy) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  const metricValue = Math.max(0, Number(rankEarnedTotal || 0));
  let activeTier = resolvedRankPolicy.tiers[0] || { code: "tier_1" };

  resolvedRankPolicy.tiers.forEach((tier) => {
    if (metricValue >= Number(tier.minPoints || 0)) {
      activeTier = tier;
    }
  });

  return {
    tierCode: activeTier.code,
    metricValue,
  };
};

const getAllowedEmojiIdsForTier = (rankPolicy, currentTierCode) => {
  const resolvedRankPolicy = resolveRankPolicy(rankPolicy);
  const enabledRegistry = getEnabledEmojiRegistry(resolvedRankPolicy.emojiRegistry);
  if (!resolvedRankPolicy.emojiPolicy.enabled) {
    return enabledRegistry.map((entry) => entry.id);
  }

  const targetTierCode = currentTierCode || resolvedRankPolicy.tiers[0]?.code || "tier_1";
  const targetTierIndex = resolvedRankPolicy.tiers.findIndex((tier) => tier.code === targetTierCode);
  const safeTargetTierIndex = targetTierIndex >= 0 ? targetTierIndex : 0;
  const allowedEmojiIds = resolvedRankPolicy.tiers.reduce((accumulator, tier, index) => {
    if (index > safeTargetTierIndex) {
      return accumulator;
    }
    return [...accumulator, ...(tier.allowedEmojiIds || [])];
  }, []);
  const uniqueAllowedEmojiIds = Array.from(
    new Set(
      allowedEmojiIds.filter((emojiId) => {
        const entry = getProfileEmojiEntryById(emojiId, resolvedRankPolicy.emojiRegistry);
        return Boolean(entry && entry.enabled !== false);
      }),
    ),
  );

  return uniqueAllowedEmojiIds.length > 0
    ? uniqueAllowedEmojiIds
    : [resolvedRankPolicy.emojiPolicy.defaultEmojiId];
};

const getCurrentRankEarnedTotal = async (db, year, semester, uid, wallet, rankPolicy) => {
  const storedRankEarnedTotal = Number(wallet?.rankEarnedTotal);
  if (Number.isFinite(storedRankEarnedTotal)) {
    return Math.max(0, storedRankEarnedTotal);
  }

  if (rankPolicy.basedOn === "earnedTotal") {
    return Math.max(0, Number(wallet?.earnedTotal || 0));
  }

  const manualAdjustSnap = await db
    .collection(`years/${year}/semesters/${semester}/point_transactions`)
    .where("uid", "==", uid)
    .where("type", "==", "manual_adjust")
    .get();

  const positiveManualAdjustTotal = manualAdjustSnap.docs.reduce((total, docSnap) => {
    const delta = Number(docSnap.get("delta") || 0);
    return delta > 0 ? total + delta : total;
  }, 0);

  return Math.max(0, Number(wallet?.earnedTotal || 0) + positiveManualAdjustTotal);
};

const resolveScope = async (db) => {
  const requestedYear = String(getArgValue("year") || "").trim();
  const requestedSemester = String(getArgValue("semester") || "").trim();
  if (requestedYear && requestedSemester) {
    return {
      year: requestedYear,
      semester: requestedSemester,
      source: "cli",
    };
  }

  const configSnap = await db.doc("site_settings/config").get();
  const data = configSnap.exists ? configSnap.data() || {} : {};
  return {
    year: String(requestedYear || data.year || "2026").trim(),
    semester: String(requestedSemester || data.semester || "1").trim(),
    source: configSnap.exists ? "site_settings/config" : "fallback",
  };
};

const summarizeSample = (item) => ({
  uid: item.uid,
  email: item.email,
  name: item.name,
  tierCode: item.tierCode,
  reason: item.reason,
  allowedEmojiIds: item.allowedEmojiIds,
  before: item.before,
  after: item.after,
});

const inspectStudents = async (db, scope, sampleLimit) => {
  const policySnap = await db
    .doc(`years/${scope.year}/semesters/${scope.semester}/point_policies/current`)
    .get();
  const rankPolicy = resolveRankPolicy(policySnap.exists ? policySnap.data()?.rankPolicy : null);
  const usersSnap = await db.collection("users").where("role", "==", "student").get();
  const walletSnap = await db
    .collection(`years/${scope.year}/semesters/${scope.semester}/point_wallets`)
    .get();
  const walletMap = new Map(walletSnap.docs.map((docSnap) => [docSnap.id, docSnap.data() || {}]));

  const affected = [];
  const skippedNoAllowed = [];
  const samples = [];
  let missingWalletCount = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data() || {};
    const wallet = walletMap.get(docSnap.id) || null;
    if (!wallet) {
      missingWalletCount += 1;
    }

    const tierCode = buildRankSnapshot(
      await getCurrentRankEarnedTotal(db, scope.year, scope.semester, docSnap.id, wallet, rankPolicy),
      rankPolicy,
    ).tierCode;
    const allowedEmojiIds = getAllowedEmojiIdsForTier(rankPolicy, tierCode);
    const replacementEmojiId = allowedEmojiIds[0] || "";
    const replacementEntry = replacementEmojiId
      ? getProfileEmojiEntryById(replacementEmojiId, rankPolicy.emojiRegistry)
      : null;

    if (!replacementEntry) {
      skippedNoAllowed.push({
        uid: docSnap.id,
        email: String(data.email || "").trim(),
        name: String(data.name || "").trim(),
        tierCode,
      });
      continue;
    }

    const storedProfileEmojiId = String(data.profileEmojiId || "").trim();
    const storedProfileIcon = normalizeEmojiText(data.profileIcon);
    const selectedEntry = storedProfileEmojiId
      ? getProfileEmojiEntryById(storedProfileEmojiId, rankPolicy.emojiRegistry)
      : getProfileEmojiEntryByValue(storedProfileIcon, rankPolicy.emojiRegistry);

    const selectedAllowed = Boolean(
      selectedEntry &&
        selectedEntry.enabled !== false &&
        allowedEmojiIds.includes(selectedEntry.id),
    );

    let reason = "";
    if (!selectedEntry) {
      reason =
        storedProfileEmojiId || storedProfileIcon
          ? "legacy_or_unknown_selection"
          : "";
    } else if (selectedEntry.enabled === false) {
      reason = "disabled_selection";
    } else if (!selectedAllowed) {
      reason = "selection_outside_allowed_tier";
    }

    if (!reason) {
      continue;
    }

    const candidate = {
      ref: docSnap.ref,
      uid: docSnap.id,
      email: String(data.email || "").trim(),
      name: String(data.name || "").trim(),
      tierCode,
      allowedEmojiIds,
      reason,
      before: {
        profileEmojiId: storedProfileEmojiId || null,
        profileIcon: storedProfileIcon || null,
        selectedResolvedEmojiId: selectedEntry?.id || null,
      },
      after: {
        profileEmojiId: replacementEntry.id,
        profileIcon: replacementEntry.emoji,
      },
    };
    affected.push(candidate);
    if (samples.length < sampleLimit) {
      samples.push(summarizeSample(candidate));
    }
  }

  return {
    scope,
    rankPolicySummary: {
      tiers: rankPolicy.tiers.map((tier) => ({
        code: tier.code,
        minPoints: tier.minPoints,
        allowedEmojiIds: tier.allowedEmojiIds || [],
      })),
      defaultEmojiId: rankPolicy.emojiPolicy.defaultEmojiId,
    },
    totalStudentsScanned: usersSnap.size,
    totalWalletsScanned: walletSnap.size,
    missingWalletCount,
    affectedCount: affected.length,
    skippedNoAllowedCount: skippedNoAllowed.length,
    skippedNoAllowedSample: skippedNoAllowed.slice(0, sampleLimit),
    samples,
    affected,
  };
};

const applyCorrection = async (affected, sampleLimit) => {
  if (!affected.length) {
    return {
      updatedCount: 0,
      appliedSamples: [],
    };
  }

  const writer = getFirestore().bulkWriter();
  writer.onWriteError((error) => {
    console.error(
      "[emoji-fix] Write failed:",
      error.documentRef?.path || "[unknown]",
      error.message,
    );
    return false;
  });

  const appliedSamples = [];
  for (const item of affected) {
    writer.set(
      item.ref,
      {
        profileEmojiId: item.after.profileEmojiId,
        profileIcon: item.after.profileIcon,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (appliedSamples.length < sampleLimit) {
      appliedSamples.push(summarizeSample(item));
    }
  }

  await writer.close();
  return {
    updatedCount: affected.length,
    appliedSamples,
  };
};

const main = async () => {
  const apply = hasFlag("apply");
  const sampleLimit = resolveSampleLimit();
  const projectId = resolveProjectId();
  const credentialSource = ensureCredentialSource();

  try {
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }

    const db = getFirestore();
    const scope = await resolveScope(db);
    const initial = await inspectStudents(db, scope, sampleLimit);
    const baseSummary = {
      mode: apply ? "apply" : "dry-run",
      projectId,
      credentialSource: credentialSource.type,
      credentialEmail: credentialSource.email || "",
      scope,
      totalStudentsScanned: initial.totalStudentsScanned,
      totalWalletsScanned: initial.totalWalletsScanned,
      missingWalletCount: initial.missingWalletCount,
      affectedCount: initial.affectedCount,
      skippedNoAllowedCount: initial.skippedNoAllowedCount,
      rankPolicySummary: initial.rankPolicySummary,
      samples: initial.samples,
      skippedNoAllowedSample: initial.skippedNoAllowedSample,
    };

    if (!apply) {
      console.log(JSON.stringify(baseSummary, null, 2));
      return;
    }

    const applyResult = await applyCorrection(initial.affected, sampleLimit);
    const verification = await inspectStudents(db, scope, sampleLimit);
    const finalSummary = {
      ...baseSummary,
      updatedCount: applyResult.updatedCount,
      appliedSamples: applyResult.appliedSamples,
      remainingAffectedCount: verification.affectedCount,
      remainingSkippedNoAllowedCount: verification.skippedNoAllowedCount,
      remainingSamples: verification.samples,
    };

    console.log(JSON.stringify(finalSummary, null, 2));

    if (verification.affectedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    credentialSource.cleanup();
  }
};

main().catch((error) => {
  console.error("[emoji-fix] Failed:", error);
  process.exitCode = 1;
});
