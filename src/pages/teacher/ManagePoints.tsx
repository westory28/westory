import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { TEACHER_POINT_TAB_LABELS } from "../../constants/pointLabels";
import { useAppToast } from "../../components/common/AppToastProvider";
import { PageDataLoading } from "../../components/common/LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import {
  adjustLegacyTeacherWis as adjustPoints,
  deleteLegacyTeacherPointProduct as deletePointProduct,
  getLegacyTeacherPointPolicy as getPointPolicy,
  getLegacyTeacherPointSchoolOptions as getPointSchoolOptions,
  getLegacyTeacherRankEarnedPointsMap as getPointRankManualAdjustEarnedPointsMap,
  getLegacyTeacherWisHallOfFameState,
  listLegacyTeacherPointOrders as listPointOrders,
  listLegacyTeacherPointProducts as listPointProducts,
  listLegacyTeacherPointStudentTargets as listPointStudentTargets,
  listLegacyTeacherPointStudentTargetsByClass as listPointStudentTargetsByClass,
  listLegacyTeacherPointTransactionsByUid as listPointTransactionsByUid,
  listLegacyTeacherPointWallets as listPointWallets,
  reviewLegacyTeacherPointOrder as reviewPointOrder,
  saveLegacyTeacherPointPolicy as upsertPointPolicy,
  saveLegacyTeacherPointProduct as upsertPointProduct,
  saveLegacyTeacherWisHallOfFameConfig,
  updateLegacyTeacherPointAdjustment as updatePointAdjustment,
} from "../../lib/legacyWisPresentationAdapter";
import { createStableLegacyMutationActionKey } from "../../lib/legacyWisMutationIntent";
import { POINT_POLICY_FALLBACK } from "../../lib/points";
import {
  getPointRankPolicyValidationError,
  getPointWalletCumulativeEarned,
  needsPointRankLegacyFallback,
  resolvePointRankPolicyDraft,
} from "../../lib/pointRanks";
import { canManagePoints, canReadPoints } from "../../lib/permissions";
import type {
  PointOrder,
  PointOrderStatus,
  PointPolicy,
  PointProduct,
  PointRankEmojiRegistryEntry,
  PointRankPolicy,
  PointRankPolicyTier,
  PointStudentTarget,
  PointTransaction,
  PointWallet,
} from "../../types";
import PointGrantTab from "./components/points/PointGrantTab";
import PointPolicyTab from "./components/points/PointPolicyTab";
import PointRanksTab, {
  type RankEmojiCollectionDraft,
  type RankPanelSaveTone,
  type RankSettingsDraft,
  type RankThemeDraft,
} from "./components/points/PointRanksTab";
import PointProductsTab from "./components/points/PointProductsTab";
import PointRequestsTab from "./components/points/PointRequestsTab";
import PointsOverviewTab from "./components/points/PointsOverviewTab";
import HallOfFameManagementTab from "./components/points/HallOfFameManagementTab";

type TeacherPointTab = keyof typeof TEACHER_POINT_TAB_LABELS;
type GrantMode = "grant" | "reclaim";
type OrderFilter = "all" | PointOrderStatus;
type PolicyFeedbackTone = RankPanelSaveTone;
type SchoolOption = { value: string; label: string };
type OverviewSortKey =
  | "none"
  | "affiliation"
  | "balance"
  | "earnedTotal"
  | "spentTotal";
type OverviewSortDirection = "asc" | "desc";
type ProductFormState = {
  id: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  imageUrl: string;
  previewImageUrl: string;
  imageStoragePath: string;
  previewStoragePath: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_POLICY: PointPolicy = POINT_POLICY_FALLBACK;

const createEmptyProductForm = (): ProductFormState => ({
  id: "",
  name: "",
  description: "",
  price: "0",
  stock: "0",
  imageUrl: "",
  previewImageUrl: "",
  imageStoragePath: "",
  previewStoragePath: "",
  sortOrder: "",
  isActive: true,
});

const normalizeValue = (value: unknown) => String(value || "").trim();
const normalizeSearchValue = (value: unknown) =>
  normalizeValue(value).toLowerCase();
const OVERVIEW_PAGE_SIZE = 20;
const createLocalPointTimestamp = () => ({
  seconds: Math.floor(Date.now() / 1000),
  nanoseconds: 0,
});

const sortPointProducts = (items: PointProduct[]) =>
  [...items].sort((left, right) => {
    const sortGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (sortGap !== 0) return sortGap;
    return normalizeValue(left.name).localeCompare(
      normalizeValue(right.name),
      "ko-KR",
      { numeric: true },
    );
  });

const getNextPointProductSortOrder = (items: PointProduct[]) =>
  items.reduce(
    (maxValue, item) => Math.max(maxValue, Number(item.sortOrder || 0)),
    -10,
  ) + 10;

const resequencePointProducts = (items: PointProduct[]) =>
  items.map((item, index) => ({
    ...item,
    sortOrder: (index + 1) * 10,
  }));

const reorderPointProducts = (
  items: PointProduct[],
  sourceId: string,
  targetId: string,
) => {
  const orderedItems = sortPointProducts(items);
  const sourceIndex = orderedItems.findIndex((item) => item.id === sourceId);
  const targetIndex = orderedItems.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items;
  }

  const nextItems = [...orderedItems];
  const [movedItem] = nextItems.splice(sourceIndex, 1);
  nextItems.splice(targetIndex, 0, movedItem);
  return resequencePointProducts(nextItems);
};

const mergePointProductIntoList = (
  items: PointProduct[],
  nextItem: PointProduct,
) => {
  const nextItems = items.some((item) => item.id === nextItem.id)
    ? items.map((item) =>
        item.id === nextItem.id ? { ...item, ...nextItem } : item,
      )
    : [...items, nextItem];
  return sortPointProducts(nextItems);
};

const sortOverviewWallets = (
  wallets: PointWallet[],
  sortKey: OverviewSortKey,
  sortDirection: OverviewSortDirection,
) => {
  if (sortKey === "none") {
    return wallets;
  }

  const direction = sortDirection === "asc" ? 1 : -1;

  return wallets
    .map((wallet, index) => ({ wallet, index }))
    .sort((left, right) => {
      let comparison = 0;

      if (sortKey === "affiliation") {
        comparison =
          normalizeValue(left.wallet.grade).localeCompare(
            normalizeValue(right.wallet.grade),
            "ko-KR",
            { numeric: true },
          ) ||
          normalizeValue(left.wallet.class).localeCompare(
            normalizeValue(right.wallet.class),
            "ko-KR",
            { numeric: true },
          ) ||
          normalizeValue(left.wallet.number).localeCompare(
            normalizeValue(right.wallet.number),
            "ko-KR",
            { numeric: true },
          ) ||
          normalizeValue(left.wallet.studentName).localeCompare(
            normalizeValue(right.wallet.studentName),
            "ko-KR",
            { numeric: true },
          );
      } else if (sortKey === "balance") {
        comparison = (left.wallet.balance || 0) - (right.wallet.balance || 0);
      } else if (sortKey === "earnedTotal") {
        comparison =
          getPointWalletCumulativeEarned(left.wallet) -
          getPointWalletCumulativeEarned(right.wallet);
      } else if (sortKey === "spentTotal") {
        comparison =
          (left.wallet.spentTotal || 0) - (right.wallet.spentTotal || 0);
      }

      if (comparison !== 0) {
        return comparison * direction;
      }

      return left.index - right.index;
    })
    .map(({ wallet }) => wallet);
};

const cloneRankTiers = (tiers: PointRankPolicyTier[] = []) =>
  tiers.map((tier) => ({
    ...tier,
    allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
  }));

const cloneRankThemes = (
  themes: PointRankPolicy["themes"] = {},
): PointRankPolicy["themes"] =>
  Object.fromEntries(
    Object.entries(themes || {}).map(([themeId, themeConfig]) => [
      themeId,
      {
        ...themeConfig,
        tiers: Object.fromEntries(
          Object.entries(themeConfig?.tiers || {}).map(
            ([tierCode, tierOverride]) => [tierCode, { ...tierOverride }],
          ),
        ),
      },
    ]),
  ) as PointRankPolicy["themes"];

const cloneRankEmojiRegistry = (
  emojiRegistry: PointRankEmojiRegistryEntry[] = [],
) =>
  emojiRegistry.map((entry) => ({
    ...entry,
    legacyValues: [...(entry.legacyValues || [])],
  }));

const createRankThemeDraft = (
  rankPolicy?: Partial<PointRankPolicy> | null,
): RankThemeDraft => {
  const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
  return {
    activeThemeId: resolvedPolicy.activeThemeId,
  };
};

const createRankSettingsDraft = (
  rankPolicy?: Partial<PointRankPolicy> | null,
): RankSettingsDraft => {
  const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
  return {
    tiers: cloneRankTiers(resolvedPolicy.tiers),
    themes: cloneRankThemes(resolvedPolicy.themes),
    celebrationPolicy: {
      ...resolvedPolicy.celebrationPolicy,
    },
  };
};

const createRankEmojiCollectionDraft = (
  rankPolicy?: Partial<PointRankPolicy> | null,
): RankEmojiCollectionDraft => {
  const resolvedPolicy = resolvePointRankPolicyDraft(rankPolicy);
  return {
    emojiRegistry: cloneRankEmojiRegistry(resolvedPolicy.emojiRegistry),
    tiers: cloneRankTiers(resolvedPolicy.tiers),
  };
};

const ManagePointsScope: React.FC = () => {
  const { config, currentUser, userData, interfaceConfig } = useAuth();
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canRead = canReadPoints(userData, currentUser?.email);
  const canManage = canManagePoints(userData, currentUser?.email);

  const [activeTab, setActiveTab] = useState<TeacherPointTab>(() => {
    const requested = searchParams.get("tab") as TeacherPointTab;
    return requested in TEACHER_POINT_TAB_LABELS ? requested : "overview";
  });
  const loadRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [wallets, setWallets] = useState<PointWallet[]>([]);
  const [students, setStudents] = useState<PointStudentTarget[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [selectedUid, setSelectedUid] = useState("");
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [savedPolicy, setSavedPolicy] = useState<PointPolicy>(EMPTY_POLICY);
  const [policyDraft, setPolicyDraft] = useState<PointPolicy>(EMPTY_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [policyFeedbackMessage, setPolicyFeedbackMessage] = useState("");
  const [policyFeedbackTone, setPolicyFeedbackTone] =
    useState<PolicyFeedbackTone | null>(null);
  const [rankThemeDraft, setRankThemeDraft] = useState<RankThemeDraft>(() =>
    createRankThemeDraft(EMPTY_POLICY.rankPolicy),
  );
  const [rankThemeDirty, setRankThemeDirty] = useState(false);
  const [rankThemeFeedbackMessage, setRankThemeFeedbackMessage] = useState("");
  const [rankThemeFeedbackTone, setRankThemeFeedbackTone] =
    useState<PolicyFeedbackTone | null>(null);
  const [rankSettingsDraft, setRankSettingsDraft] = useState<RankSettingsDraft>(
    () => createRankSettingsDraft(EMPTY_POLICY.rankPolicy),
  );
  const [rankSettingsDirty, setRankSettingsDirty] = useState(false);
  const [rankSettingsFeedbackMessage, setRankSettingsFeedbackMessage] =
    useState("");
  const [rankSettingsFeedbackTone, setRankSettingsFeedbackTone] =
    useState<PolicyFeedbackTone | null>(null);
  const [rankEmojiDraft, setRankEmojiDraft] =
    useState<RankEmojiCollectionDraft>(() =>
      createRankEmojiCollectionDraft(EMPTY_POLICY.rankPolicy),
    );
  const [rankEmojiDirty, setRankEmojiDirty] = useState(false);
  const [rankEmojiFeedbackMessage, setRankEmojiFeedbackMessage] = useState("");
  const [rankEmojiFeedbackTone, setRankEmojiFeedbackTone] =
    useState<PolicyFeedbackTone | null>(null);
  const [
    rankManualAdjustEarnedPointsByUid,
    setRankManualAdjustEarnedPointsByUid,
  ] = useState<Record<string, number>>({});
  const [products, setProducts] = useState<PointProduct[]>([]);
  const [orders, setOrders] = useState<PointOrder[]>([]);
  const [gradeFilter, setGradeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [numberFilter, setNumberFilter] = useState("all");
  const [nameSearch, setNameSearch] = useState("");
  const [overviewSortKey, setOverviewSortKey] =
    useState<OverviewSortKey>("earnedTotal");
  const [overviewSortDirection, setOverviewSortDirection] =
    useState<OverviewSortDirection>("desc");
  const [overviewPage, setOverviewPage] = useState(1);
  const [grantGradeFilter, setGrantGradeFilter] = useState("all");
  const [grantClassFilter, setGrantClassFilter] = useState("all");
  const [grantNumberFilter, setGrantNumberFilter] = useState("all");
  const [grantNameSearch, setGrantNameSearch] = useState("");
  const [grantSelectedUid, setGrantSelectedUid] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantFeedback, setGrantFeedback] = useState("");
  const [grantSubmittingMode, setGrantSubmittingMode] =
    useState<GrantMode | null>(null);
  const grantMutationIntentRef = useRef<{
    signature: string;
    actionKey: string;
  } | null>(null);
  const loadHallOfFameState = useCallback(
    () => getLegacyTeacherWisHallOfFameState(config),
    [currentUser?.uid, config?.year, config?.semester],
  );
  const saveHallOfFameConfig = (
    hallOfFame: Parameters<
      typeof saveLegacyTeacherWisHallOfFameConfig
    >[0]["hallOfFame"],
    expectedRevision: number,
    actionKey: string,
  ) =>
    saveLegacyTeacherWisHallOfFameConfig({
      config,
      hallOfFame,
      expectedRevision,
      actionKey,
    });
  const [grantGradeOptions, setGrantGradeOptions] = useState<SchoolOption[]>([
    { value: "1", label: "1학년" },
    { value: "2", label: "2학년" },
    { value: "3", label: "3학년" },
  ]);
  const [grantClassOptions, setGrantClassOptions] = useState<SchoolOption[]>(
    Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1}반`,
    })),
  );
  const [productForm, setProductForm] = useState<ProductFormState>(() =>
    createEmptyProductForm(),
  );
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreviewUrl, setProductImagePreviewUrl] = useState("");
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [productFeedback, setProductFeedback] = useState("");
  const [productOrderDirty, setProductOrderDirty] = useState(false);
  const [productOrderSaving, setProductOrderSaving] = useState(false);
  const [productOrderFeedback, setProductOrderFeedback] = useState("");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("requested");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderMemo, setOrderMemo] = useState("");
  const [orderFeedback, setOrderFeedback] = useState("");
  const [orderSavingOrderId, setOrderSavingOrderId] = useState("");
  const [orderSavingStatus, setOrderSavingStatus] =
    useState<PointOrderStatus | null>(null);
  const [selectedEditableTransactionId, setSelectedEditableTransactionId] =
    useState("");
  const [adjustmentDraftValue, setAdjustmentDraftValue] = useState("");
  const [adjustmentFeedback, setAdjustmentFeedback] = useState("");
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);

  const actor = useMemo(
    () => ({
      uid: currentUser?.uid || userData?.uid || "",
      name: userData?.name || currentUser?.displayName || "",
    }),
    [currentUser?.displayName, currentUser?.uid, userData?.name, userData?.uid],
  );
  const savedRankPolicy = useMemo(
    () => resolvePointRankPolicyDraft(savedPolicy.rankPolicy),
    [savedPolicy.rankPolicy],
  );

  const syncRankEmojiUnlockTierCodes = (
    tiers: PointRankPolicyTier[],
    emojiRegistry: PointRankEmojiRegistryEntry[],
  ) =>
    cloneRankEmojiRegistry(emojiRegistry).map((entry) => {
      const assignedTier = tiers.find((tier) =>
        (tier.allowedEmojiIds || []).includes(entry.id),
      );
      return {
        ...entry,
        ...(assignedTier ? { unlockTierCode: assignedTier.code } : {}),
      };
    });

  const applyConfirmedPolicy = (
    confirmedPolicy: PointPolicy,
    options?: {
      resetThemeDraft?: boolean;
      resetRankSettingsDraft?: boolean;
      resetEmojiDraft?: boolean;
    },
  ) => {
    setSavedPolicy(confirmedPolicy);
    setPolicyDraft((prev) =>
      policyDirty
        ? {
            ...prev,
            rankPolicy: confirmedPolicy.rankPolicy,
          }
        : confirmedPolicy,
    );
    setRankThemeDraft((prev) =>
      options?.resetThemeDraft || !rankThemeDirty
        ? createRankThemeDraft(confirmedPolicy.rankPolicy)
        : prev,
    );
    setRankSettingsDraft((prev) =>
      options?.resetRankSettingsDraft || !rankSettingsDirty
        ? createRankSettingsDraft(confirmedPolicy.rankPolicy)
        : prev,
    );
    setRankEmojiDraft((prev) =>
      options?.resetEmojiDraft || !rankEmojiDirty
        ? createRankEmojiCollectionDraft(confirmedPolicy.rankPolicy)
        : prev,
    );
  };

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          wallets.map((wallet) => normalizeValue(wallet.grade)).filter(Boolean),
        ),
      ).sort((a, b) => Number(a) - Number(b)),
    [wallets],
  );

  const classOptions = useMemo(
    () =>
      Array.from(
        new Set(
          wallets
            .filter(
              (wallet) =>
                gradeFilter === "all" ||
                normalizeValue(wallet.grade) === gradeFilter,
            )
            .map((wallet) => normalizeValue(wallet.class))
            .filter(Boolean),
        ),
      ).sort((a, b) => Number(a) - Number(b)),
    [gradeFilter, wallets],
  );

  const numberOptions = useMemo(
    () =>
      Array.from(
        new Set(
          wallets
            .filter(
              (wallet) =>
                gradeFilter === "all" ||
                normalizeValue(wallet.grade) === gradeFilter,
            )
            .filter(
              (wallet) =>
                classFilter === "all" ||
                normalizeValue(wallet.class) === classFilter,
            )
            .map((wallet) => normalizeValue(wallet.number))
            .filter(Boolean),
        ),
      ).sort((a, b) => Number(a) - Number(b)),
    [classFilter, gradeFilter, wallets],
  );

  const filteredWallets = useMemo(
    () =>
      wallets.filter((wallet) => {
        const matchesGrade =
          gradeFilter === "all" || normalizeValue(wallet.grade) === gradeFilter;
        const matchesClass =
          classFilter === "all" || normalizeValue(wallet.class) === classFilter;
        const matchesNumber =
          numberFilter === "all" ||
          normalizeValue(wallet.number) === numberFilter;
        const keyword = nameSearch.trim();
        const matchesName =
          !keyword || normalizeValue(wallet.studentName).includes(keyword);
        return matchesGrade && matchesClass && matchesNumber && matchesName;
      }),
    [classFilter, gradeFilter, nameSearch, numberFilter, wallets],
  );

  const sortedWallets = useMemo(
    () =>
      sortOverviewWallets(
        filteredWallets,
        overviewSortKey,
        overviewSortDirection,
      ),
    [filteredWallets, overviewSortDirection, overviewSortKey],
  );

  const overviewTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedWallets.length / OVERVIEW_PAGE_SIZE)),
    [sortedWallets.length],
  );

  const currentOverviewPage = Math.min(overviewPage, overviewTotalPages);

  const paginatedWallets = useMemo(() => {
    const startIndex = (currentOverviewPage - 1) * OVERVIEW_PAGE_SIZE;
    return sortedWallets.slice(startIndex, startIndex + OVERVIEW_PAGE_SIZE);
  }, [currentOverviewPage, sortedWallets]);

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.uid === selectedUid) || null,
    [selectedUid, wallets],
  );

  const walletMap = useMemo(
    () => new Map(wallets.map((wallet) => [wallet.uid, wallet])),
    [wallets],
  );

  const ordersWithStudentProfiles = useMemo(
    () =>
      orders.map((order) => {
        const wallet = walletMap.get(order.uid);
        if (!wallet) return order;

        return {
          ...order,
          studentName: wallet.studentName || order.studentName,
          grade: wallet.grade || order.grade || "",
          class: wallet.class || order.class || "",
          number: wallet.number || order.number || "",
        };
      }),
    [orders, walletMap],
  );
  const isGlobalGrantSearch = grantNameSearch.trim().length > 0;

  const grantNumberOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter(
              (student) =>
                grantGradeFilter === "all" ||
                normalizeValue(student.grade) === grantGradeFilter,
            )
            .filter(
              (student) =>
                grantClassFilter === "all" ||
                normalizeValue(student.class) === grantClassFilter,
            )
            .map((student) => normalizeValue(student.number))
            .filter(Boolean),
        ),
      ).sort((a, b) => Number(a) - Number(b)),
    [grantClassFilter, grantGradeFilter, students],
  );

  const filteredGrantStudents = useMemo(
    () =>
      students
        .filter((student) => {
          const matchesGrade =
            grantGradeFilter === "all" ||
            normalizeValue(student.grade) === grantGradeFilter;
          const matchesClass =
            grantClassFilter === "all" ||
            normalizeValue(student.class) === grantClassFilter;
          const matchesNumber =
            grantNumberFilter === "all" ||
            normalizeValue(student.number) === grantNumberFilter;
          const keyword = normalizeSearchValue(grantNameSearch);
          const matchesName =
            !keyword ||
            normalizeSearchValue(student.studentName).includes(keyword);
          return matchesGrade && matchesClass && matchesNumber && matchesName;
        })
        .map((student) => ({
          ...student,
          wallet: walletMap.get(student.uid) || null,
        })),
    [
      grantClassFilter,
      grantGradeFilter,
      grantNameSearch,
      grantNumberFilter,
      students,
      walletMap,
    ],
  );

  const selectedGrantStudent = useMemo(() => {
    const matchedFilteredStudent = filteredGrantStudents.find(
      (student) => student.uid === grantSelectedUid,
    );
    if (matchedFilteredStudent) return matchedFilteredStudent;
    const matchedStudent = students.find(
      (student) => student.uid === grantSelectedUid,
    );
    if (!matchedStudent) return null;
    return {
      ...matchedStudent,
      wallet: walletMap.get(grantSelectedUid) || null,
    };
  }, [filteredGrantStudents, grantSelectedUid, students, walletMap]);

  const filteredOrders = useMemo(
    () =>
      orderFilter === "all"
        ? ordersWithStudentProfiles
        : ordersWithStudentProfiles.filter(
            (order) => order.status === orderFilter,
          ),
    [orderFilter, ordersWithStudentProfiles],
  );

  const selectedOrder = useMemo(
    () =>
      filteredOrders.find((order) => order.id === selectedOrderId) ||
      ordersWithStudentProfiles.find((order) => order.id === selectedOrderId) ||
      null,
    [filteredOrders, ordersWithStudentProfiles, selectedOrderId],
  );

  const selectedEditableTransaction = useMemo(
    () =>
      transactions.find(
        (transaction) => transaction.id === selectedEditableTransactionId,
      ) || null,
    [selectedEditableTransactionId, transactions],
  );

  const loadTransactionsForWallet = async (uid: string) => {
    if (!uid) {
      setTransactions([]);
      return;
    }
    const nextTransactions = await listPointTransactionsByUid(config, uid, 20);
    setTransactions(nextTransactions);
  };

  const loadAll = async () => {
    const requestId = ++loadRequestRef.current;
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadErrorMessage("");
    try {
      // Hall of fame owns its single projection read. Other tabs request only
      // the records they actually render, rather than the entire economy.
      if (activeTab === "hall-of-fame") return;
      const needsWallets = activeTab === "overview" || activeTab === "grant";
      const [
        nextWallets,
        nextSchoolOptions,
        nextPolicy,
        nextProducts,
        nextOrders,
      ] = await Promise.all([
        needsWallets ? listPointWallets(config) : Promise.resolve([]),
        needsWallets
          ? getPointSchoolOptions(config)
          : Promise.resolve({
              grades: grantGradeOptions,
              classes: grantClassOptions,
            }),
        getPointPolicy(config),
        activeTab === "products"
          ? listPointProducts(config, false)
          : Promise.resolve([]),
        activeTab === "requests"
          ? listPointOrders(config, { limitCount: 200 })
          : Promise.resolve([]),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) =>
        needsPointRankLegacyFallback(wallet),
      )
        ? await getPointRankManualAdjustEarnedPointsMap(config)
        : {};
      if (requestId !== loadRequestRef.current) return;

      if (needsWallets) {
        setWallets(nextWallets);
        setGrantGradeOptions(nextSchoolOptions.grades);
        setGrantClassOptions(nextSchoolOptions.classes);
      }
      setSavedPolicy(nextPolicy);
      if (!policyDirty) setPolicyDraft(nextPolicy);
      if (!rankThemeDirty)
        setRankThemeDraft(createRankThemeDraft(nextPolicy.rankPolicy));
      if (!rankSettingsDirty)
        setRankSettingsDraft(createRankSettingsDraft(nextPolicy.rankPolicy));
      if (!rankEmojiDirty)
        setRankEmojiDraft(
          createRankEmojiCollectionDraft(nextPolicy.rankPolicy),
        );
      if (activeTab === "products" && !productOrderDirty)
        setProducts(nextProducts);
      if (activeTab === "requests") setOrders(nextOrders);
      if (needsWallets)
        setRankManualAdjustEarnedPointsByUid(
          nextRankManualAdjustEarnedPointsByUid,
        );

      const nextSelectedUid =
        selectedUid && nextWallets.some((wallet) => wallet.uid === selectedUid)
          ? selectedUid
          : nextWallets[0]?.uid || "";
      if (needsWallets) setSelectedUid(nextSelectedUid);
    } catch (error: any) {
      if (requestId !== loadRequestRef.current) return;
      console.error("Failed to load W7 wis state:", error);
      setLoadErrorMessage(
        error?.message ||
          "위스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (
      requestedTab === "grant" ||
      requestedTab === "policy" ||
      requestedTab === "ranks" ||
      requestedTab === "hall-of-fame" ||
      requestedTab === "products" ||
      requestedTab === "requests"
    ) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab("overview");
  }, [searchParams]);

  useEffect(() => {
    void loadAll();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [canRead, currentUser?.uid, config?.year, config?.semester, activeTab]);

  useEffect(() => {
    if (!selectedUid || activeTab !== "overview") {
      setTransactions([]);
      return;
    }

    let cancelled = false;
    const loadTransactions = async () => {
      const nextTransactions = await listPointTransactionsByUid(
        config,
        selectedUid,
        20,
      );
      if (!cancelled) setTransactions(nextTransactions);
    };

    void loadTransactions();
    return () => {
      cancelled = true;
    };
  }, [config?.year, config?.semester, selectedUid, activeTab]);

  useEffect(() => {
    if (!selectedEditableTransaction) {
      setAdjustmentDraftValue("");
      return;
    }
    setAdjustmentDraftValue(String(selectedEditableTransaction.delta || ""));
  }, [selectedEditableTransaction]);

  useEffect(() => {
    setSelectedEditableTransactionId("");
    setAdjustmentDraftValue("");
    setAdjustmentFeedback("");
  }, [selectedUid]);

  useEffect(() => {
    if (classFilter !== "all" && !classOptions.includes(classFilter))
      setClassFilter("all");
  }, [classFilter, classOptions]);

  useEffect(() => {
    if (numberFilter !== "all" && !numberOptions.includes(numberFilter))
      setNumberFilter("all");
  }, [numberFilter, numberOptions]);

  useEffect(() => {
    setOverviewPage(1);
  }, [classFilter, gradeFilter, nameSearch, numberFilter]);

  useEffect(() => {
    if (overviewPage > overviewTotalPages) {
      setOverviewPage(overviewTotalPages);
    }
  }, [overviewPage, overviewTotalPages]);

  useEffect(() => {
    if (sortedWallets.length === 0) {
      if (selectedUid) setSelectedUid("");
      return;
    }

    if (!selectedUid) {
      setSelectedUid(paginatedWallets[0]?.uid || sortedWallets[0]?.uid || "");
      return;
    }

    if (!filteredWallets.some((wallet) => wallet.uid === selectedUid)) {
      setSelectedUid(paginatedWallets[0]?.uid || sortedWallets[0]?.uid || "");
      return;
    }

    if (!paginatedWallets.some((wallet) => wallet.uid === selectedUid)) {
      setSelectedUid(paginatedWallets[0]?.uid || "");
    }
  }, [filteredWallets, paginatedWallets, selectedUid, sortedWallets]);

  useEffect(() => {
    if (
      grantClassFilter !== "all" &&
      !grantClassOptions.some((option) => option.value === grantClassFilter)
    )
      setGrantClassFilter("all");
  }, [grantClassFilter, grantClassOptions]);

  useEffect(() => {
    if (
      grantNumberFilter !== "all" &&
      !grantNumberOptions.includes(grantNumberFilter)
    )
      setGrantNumberFilter("all");
  }, [grantNumberFilter, grantNumberOptions]);

  useEffect(() => {
    if (
      grantSelectedUid &&
      !filteredGrantStudents.some((student) => student.uid === grantSelectedUid)
    ) {
      setGrantSelectedUid(filteredGrantStudents[0]?.uid || "");
    }
  }, [filteredGrantStudents, grantSelectedUid]);

  useEffect(() => {
    if (
      !isGlobalGrantSearch &&
      (grantGradeFilter === "all" || grantClassFilter === "all")
    ) {
      setStudents([]);
      setGrantSelectedUid("");
      setGrantNumberFilter("all");
      return;
    }

    let cancelled = false;
    const loadGrantStudents = async () => {
      setGrantLoading(true);
      try {
        const nextStudents = isGlobalGrantSearch
          ? await listPointStudentTargets(config)
          : await listPointStudentTargetsByClass(
              config,
              grantGradeFilter,
              grantClassFilter,
            );
        if (cancelled) return;
        setStudents(nextStudents);
        setGrantSelectedUid((prev) =>
          prev && nextStudents.some((student) => student.uid === prev)
            ? prev
            : nextStudents[0]?.uid || "",
        );
      } finally {
        if (!cancelled) setGrantLoading(false);
      }
    };

    void loadGrantStudents();
    return () => {
      cancelled = true;
    };
  }, [grantClassFilter, grantGradeFilter, isGlobalGrantSearch]);

  useEffect(() => {
    setOrderMemo(selectedOrder?.memo || "");
  }, [selectedOrder?.id, selectedOrder?.memo]);

  useEffect(
    () => () => {
      if (productImagePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(productImagePreviewUrl);
      }
    },
    [productImagePreviewUrl],
  );

  const handleOverviewSortChange = (
    sortKey: Exclude<OverviewSortKey, "none">,
  ) => {
    const nextSortDirection: OverviewSortDirection =
      overviewSortKey === sortKey
        ? overviewSortDirection === "desc"
          ? "asc"
          : "desc"
        : sortKey === "affiliation"
          ? "asc"
          : "desc";
    const nextSortedWallets = sortOverviewWallets(
      filteredWallets,
      sortKey,
      nextSortDirection,
    );
    const selectedIndex = nextSortedWallets.findIndex(
      (wallet) => wallet.uid === selectedUid,
    );

    setOverviewSortKey(sortKey);
    setOverviewSortDirection(nextSortDirection);
    setOverviewPage(
      selectedIndex >= 0
        ? Math.floor(selectedIndex / OVERVIEW_PAGE_SIZE) + 1
        : 1,
    );
  };

  const handleOverviewPageChange = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), overviewTotalPages);
    setOverviewPage(nextPage);
  };

  const handleTabChange = (tab: TeacherPointTab) => {
    setGrantFeedback("");
    setPolicyFeedbackMessage("");
    setPolicyFeedbackTone(null);
    setProductFeedback("");
    setOrderFeedback("");
    setSearchParams(tab === "overview" ? {} : { tab });
  };

  const updatePolicyDraft = (updater: (prev: PointPolicy) => PointPolicy) => {
    setPolicyDraft((prev) => updater(prev));
    setPolicyDirty(true);
    setPolicyFeedbackMessage("");
    setPolicyFeedbackTone(null);
  };

  const updateRankThemeDraft = (
    updater: (prev: RankThemeDraft) => RankThemeDraft,
  ) => {
    setRankThemeDraft((prev) => updater(prev));
    setRankThemeDirty(true);
    setRankThemeFeedbackMessage("");
    setRankThemeFeedbackTone(null);
  };

  const updateRankSettingsDraft = (
    updater: (prev: RankSettingsDraft) => RankSettingsDraft,
  ) => {
    setRankSettingsDraft((prev) => updater(prev));
    setRankSettingsDirty(true);
    setRankSettingsFeedbackMessage("");
    setRankSettingsFeedbackTone(null);
  };

  const updateRankEmojiDraft = (
    updater: (prev: RankEmojiCollectionDraft) => RankEmojiCollectionDraft,
  ) => {
    setRankEmojiDraft((prev) => updater(prev));
    setRankEmojiDirty(true);
    setRankEmojiFeedbackMessage("");
    setRankEmojiFeedbackTone(null);
  };

  const resolveProductSortOrder = (
    productId: string,
    fallbackSortOrder = "",
  ) => {
    if (productId) {
      const existingProduct = products.find((item) => item.id === productId);
      if (existingProduct) return Number(existingProduct.sortOrder || 0);
    }

    if (!productId) {
      return getNextPointProductSortOrder(products);
    }

    const numericFallback = Number(fallbackSortOrder);
    return Number.isFinite(numericFallback)
      ? numericFallback
      : getNextPointProductSortOrder(products);
  };

  const handleReorderProducts = (sourceId: string, targetId: string) => {
    const nextProducts = reorderPointProducts(products, sourceId, targetId);
    if (nextProducts === products) return;
    setProducts(nextProducts);
    setProductOrderDirty(true);
    setProductOrderFeedback("");
  };

  const handleSaveProductOrder = async () => {
    if (!canManage || !productOrderDirty || productOrderSaving) return;

    setProductOrderSaving(true);
    setProductOrderFeedback(
      "현재 위스 원장은 상품 순서를 저장하지 않습니다. 상품명으로 검색해 관리해 주세요.",
    );
    setProductOrderSaving(false);
  };

  const getGrantFailureMessage = (error: any, mode: GrantMode) => {
    const errorCode = normalizeValue(error?.code).toLowerCase();
    const rawMessage = normalizeValue(error?.message);
    const normalizedMessage = rawMessage.toLowerCase();

    if (
      errorCode === "functions/permission-denied" ||
      normalizedMessage.includes("permission is required") ||
      normalizedMessage.includes("cannot use westory point functions")
    ) {
      return "위스 관리 권한을 확인한 뒤 다시 시도해 주세요.";
    }

    if (
      errorCode === "functions/not-found" ||
      normalizedMessage.includes("user profile is missing") ||
      normalizedMessage.includes("target uid is required")
    ) {
      return "학생 정보를 다시 불러온 뒤 다시 시도해 주세요.";
    }

    if (
      errorCode === "functions/failed-precondition" ||
      errorCode === "functions/invalid-argument"
    ) {
      if (normalizedMessage.includes("manual point adjustment is disabled")) {
        return "현재 위스 정책에서 지급 및 환수가 잠겨 있습니다. 정책 설정을 확인해 주세요.";
      }
      if (
        normalizedMessage.includes("insufficient point balance") ||
        normalizedMessage.includes("balance is insufficient")
      ) {
        return "환수할 위스가 부족합니다. 현재 보유 위스를 확인한 뒤 다시 시도해 주세요.";
      }
      if (normalizedMessage.includes("reason is required")) {
        return mode === "grant"
          ? "위스 지급 사유를 입력해 주세요."
          : "위스 환수 사유를 입력해 주세요.";
      }
      if (
        normalizedMessage.includes(
          "point delta must be a non-zero finite number",
        ) ||
        normalizedMessage.includes(
          "manual adjustment mode does not match the point delta",
        )
      ) {
        return "위스 수량을 다시 확인한 뒤 다시 시도해 주세요.";
      }
    }

    if (
      errorCode === "functions/unavailable" ||
      errorCode === "functions/deadline-exceeded"
    ) {
      return "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
    }

    if (
      !rawMessage ||
      normalizedMessage === "internal" ||
      errorCode === "functions/internal"
    ) {
      return mode === "grant"
        ? "위스 지급 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
        : "위스 환수 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    }

    if (
      rawMessage.startsWith("functions/") ||
      /^[a-z0-9 _.'-]+$/i.test(rawMessage)
    ) {
      return mode === "grant"
        ? "위스 지급 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
        : "위스 환수 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    }

    return rawMessage;
  };

  const handleSaveGrant = async (
    event: React.FormEvent,
    mode: GrantMode = "grant",
  ) => {
    event.preventDefault();
    if (!selectedGrantStudent || !canManage || grantSubmittingMode) return;

    const numericAmount = Number(grantAmount);
    if (!numericAmount || numericAmount < 1) {
      setGrantFeedback("위스 수량은 1 이상으로 입력해 주세요.");
      return;
    }
    if (!grantReason.trim()) {
      setGrantFeedback(
        mode === "grant"
          ? "위스 지급 사유를 입력해 주세요."
          : "위스 환수 사유를 입력해 주세요.",
      );
      return;
    }

    const actionLabel = mode === "grant" ? "지급" : "환수";
    const intentSignature = [
      selectedGrantStudent.uid,
      mode,
      numericAmount,
      grantReason.trim(),
    ].join("|");
    const actionKey =
      grantMutationIntentRef.current?.signature === intentSignature
        ? grantMutationIntentRef.current.actionKey
        : createStableLegacyMutationActionKey("teacher-wis-adjust", {
            actorUid: actor.uid,
            semesterId: `${String(config?.year || "")}-${String(
              config?.semester || "",
            )}`,
            studentUid: selectedGrantStudent.uid,
            mode,
            amount: numericAmount,
            reason: grantReason.trim(),
          });
    grantMutationIntentRef.current = { signature: intentSignature, actionKey };
    setGrantSubmittingMode(mode);
    setGrantFeedback("");
    try {
      await adjustPoints({
        config,
        uid: selectedGrantStudent.uid,
        delta: mode === "reclaim" ? -numericAmount : numericAmount,
        sourceLabel: grantReason.trim(),
        mode,
        actionKey,
      });
      grantMutationIntentRef.current = null;
      setGrantAmount("");
      setGrantReason("");
      setGrantFeedback(
        mode === "grant" ? "지급되었습니다." : "환수되었습니다.",
      );

      try {
        const nextWallets = await listPointWallets(config);
        const nextRankManualAdjustEarnedPointsByUid = nextWallets.some(
          (wallet) => needsPointRankLegacyFallback(wallet),
        )
          ? await getPointRankManualAdjustEarnedPointsMap(config)
          : {};
        setWallets(nextWallets);
        setRankManualAdjustEarnedPointsByUid(
          nextRankManualAdjustEarnedPointsByUid,
        );

        const nextSelectedUid = nextWallets.some(
          (wallet) => wallet.uid === selectedGrantStudent.uid,
        )
          ? selectedGrantStudent.uid
          : selectedUid &&
              nextWallets.some((wallet) => wallet.uid === selectedUid)
            ? selectedUid
            : nextWallets[0]?.uid || "";
        setSelectedUid(nextSelectedUid);
        await loadTransactionsForWallet(nextSelectedUid);
        showToast({
          tone: "success",
          title: `${actionLabel}되었습니다.`,
          message: `${selectedGrantStudent.studentName} 학생의 위스 현황을 최신 상태로 반영했습니다.`,
        });
      } catch (refreshError) {
        console.error(
          "Wis adjustment succeeded, but refreshing Wis state failed:",
          refreshError,
        );
        setGrantFeedback(
          `${actionLabel}은 완료되었습니다. 최신 위스 현황을 불러오지 못했습니다. 페이지를 새로고침해 주세요.`,
        );
        showToast({
          tone: "warning",
          title: `위스 ${actionLabel}은 완료되었습니다.`,
          message:
            "최신 위스 현황을 불러오지 못했습니다. 페이지를 새로고침해 확인해 주세요.",
        });
      }
    } catch (error: any) {
      console.error("Failed to adjust points:", error);
      const failureMessage = getGrantFailureMessage(error, mode);
      setGrantFeedback(failureMessage);
      showToast({
        tone: "error",
        title: `위스 ${actionLabel}에 실패했습니다.`,
        message: failureMessage,
      });
    } finally {
      setGrantSubmittingMode(null);
    }
  };

  const handleSavePolicy = async () => {
    if (!canManage) return;

    const sanitizedPolicy: PointPolicy = {
      ...savedPolicy,
      ...policyDraft,
      rankPolicy: savedPolicy.rankPolicy,
    };

    try {
      await upsertPointPolicy(config, sanitizedPolicy, actor);
      const confirmedPolicy = await getPointPolicy(config);
      applyConfirmedPolicy(confirmedPolicy);
      setPolicyDraft(confirmedPolicy);
      setPolicyDirty(false);
      setPolicyFeedbackTone("success");
      setPolicyFeedbackMessage("운영 정책이 저장되었습니다.");
    } catch (error: any) {
      console.error("Failed to save point policy:", error);
      setPolicyFeedbackTone("error");
      setPolicyFeedbackMessage(
        error?.message ||
          "저장 중 문제가 발생했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.",
      );
    }
  };

  const handleSaveRankTheme = async () => {
    if (!canManage) return;

    const mergedRankPolicy = resolvePointRankPolicyDraft({
      ...savedRankPolicy,
      activeThemeId: rankThemeDraft.activeThemeId,
      themeId: rankThemeDraft.activeThemeId,
    });

    try {
      await upsertPointPolicy(
        config,
        {
          ...savedPolicy,
          rankPolicy: mergedRankPolicy,
        },
        actor,
      );
      const confirmedPolicy = await getPointPolicy(config);
      applyConfirmedPolicy(confirmedPolicy, { resetThemeDraft: true });
      setRankThemeDirty(false);
      setRankThemeFeedbackTone("success");
      setRankThemeFeedbackMessage("테마 설정이 저장되었습니다.");
    } catch (error: any) {
      console.error("Failed to save rank theme:", error);
      setRankThemeFeedbackTone("error");
      setRankThemeFeedbackMessage(
        error?.message || "테마 설정 저장에 실패했습니다. 다시 시도해 주세요.",
      );
    }
  };

  const handleSaveRankSettings = async () => {
    if (!canManage) return;

    const nextTiers = cloneRankTiers(rankSettingsDraft.tiers);
    const nextThemes = cloneRankThemes(rankSettingsDraft.themes);
    const mergedRankPolicy = resolvePointRankPolicyDraft({
      ...savedRankPolicy,
      tiers: nextTiers,
      themes: nextThemes,
      celebrationPolicy: {
        ...rankSettingsDraft.celebrationPolicy,
      },
      emojiRegistry: syncRankEmojiUnlockTierCodes(
        nextTiers,
        savedRankPolicy.emojiRegistry,
      ),
    });
    const validationError = getPointRankPolicyValidationError(mergedRankPolicy);
    if (validationError) {
      setRankSettingsFeedbackTone("warning");
      setRankSettingsFeedbackMessage(
        `저장 전에 확인해 주세요. ${validationError}`,
      );
      return;
    }

    try {
      await upsertPointPolicy(
        config,
        {
          ...savedPolicy,
          rankPolicy: mergedRankPolicy,
        },
        actor,
      );
      const confirmedPolicy = await getPointPolicy(config);
      applyConfirmedPolicy(confirmedPolicy, { resetRankSettingsDraft: true });
      setRankSettingsDirty(false);
      setRankSettingsFeedbackTone("success");
      setRankSettingsFeedbackMessage("등급 관리가 저장되었습니다.");
    } catch (error: any) {
      console.error("Failed to save rank settings:", error);
      setRankSettingsFeedbackTone("error");
      setRankSettingsFeedbackMessage(
        error?.message || "등급 관리 저장에 실패했습니다. 다시 시도해 주세요.",
      );
    }
  };

  const handleSaveRankEmojiCollection = async () => {
    if (!canManage) return;

    const mergedRankPolicy = resolvePointRankPolicyDraft({
      ...savedRankPolicy,
      tiers: cloneRankTiers(rankEmojiDraft.tiers),
      emojiRegistry: syncRankEmojiUnlockTierCodes(
        cloneRankTiers(rankEmojiDraft.tiers),
        cloneRankEmojiRegistry(rankEmojiDraft.emojiRegistry),
      ),
    });
    const validationError = getPointRankPolicyValidationError(mergedRankPolicy);
    if (validationError) {
      setRankEmojiFeedbackTone("warning");
      setRankEmojiFeedbackMessage(
        `저장 전에 확인해 주세요. ${validationError}`,
      );
      return;
    }

    try {
      await upsertPointPolicy(
        config,
        {
          ...savedPolicy,
          rankPolicy: mergedRankPolicy,
        },
        actor,
      );
      const confirmedPolicy = await getPointPolicy(config);
      applyConfirmedPolicy(confirmedPolicy, { resetEmojiDraft: true });
      setRankEmojiDirty(false);
      setRankEmojiFeedbackTone("success");
      setRankEmojiFeedbackMessage("이모지 모음이 저장되었습니다.");
    } catch (error: any) {
      console.error("Failed to save rank emoji collection:", error);
      setRankEmojiFeedbackTone("error");
      setRankEmojiFeedbackMessage(
        error?.message ||
          "이모지 모음 저장에 실패했습니다. 다시 시도해 주세요.",
      );
    }
  };

  const handleProductImageChange = (file: File | null) => {
    setProductFeedback("");
    setProductImageFile(file);
    setProductImagePreviewUrl((prev) => {
      if (prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return file
        ? URL.createObjectURL(file)
        : productForm.previewImageUrl || productForm.imageUrl || "";
    });
  };

  const handleSaveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    if (!productForm.name.trim()) {
      setProductFeedback("상품명을 입력해 주세요.");
      return;
    }

    try {
      const sortOrder = resolveProductSortOrder(
        productForm.id,
        productForm.sortOrder,
      );
      const savedProduct: PointProduct = {
        id: productForm.id || crypto.randomUUID(),
        name: productForm.name.trim(),
        description: productForm.description.trim(),
        price: Number(productForm.price || 0),
        stock: Number(productForm.stock || 0),
        imageUrl: productForm.imageUrl.trim(),
        previewImageUrl: productForm.previewImageUrl.trim(),
        imageStoragePath: productForm.imageStoragePath.trim(),
        previewStoragePath: productForm.previewStoragePath.trim(),
        sortOrder,
        isActive: productForm.isActive,
      };
      await upsertPointProduct(
        config,
        {
          ...savedProduct,
          id: productForm.id || undefined,
        },
        actor,
      );
      setProductForm(createEmptyProductForm());
      setProductFeedback("상품 정보를 저장했습니다.");
      setProducts((prev) => mergePointProductIntoList(prev, savedProduct));
    } catch (error: any) {
      console.error("Failed to save point product:", error);
      setProductFeedback(error?.message || "상품 저장에 실패했습니다.");
    }
  };

  const handleSaveProductWithUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    if (!productForm.name.trim()) {
      setProductFeedback("상품명을 입력해 주세요.");
      return;
    }

    try {
      const productId = productForm.id || crypto.randomUUID();
      const sortOrder = resolveProductSortOrder(
        productForm.id,
        productForm.sortOrder,
      );
      const imagePayload = {
        imageUrl: productForm.imageUrl.trim(),
        previewImageUrl: productForm.previewImageUrl.trim(),
        imageStoragePath: productForm.imageStoragePath.trim(),
        previewStoragePath: productForm.previewStoragePath.trim(),
      };

      if (productImageFile) {
        setProductFeedback(
          "현재 위스 원장은 상품 이미지 업로드를 지원하지 않습니다. 선택한 이미지를 제거한 뒤 저장해 주세요.",
        );
        return;
      }

      await upsertPointProduct(
        config,
        {
          id: productId,
          name: productForm.name.trim(),
          description: productForm.description.trim(),
          price: Number(productForm.price || 0),
          stock: Number(productForm.stock || 0),
          imageUrl: imagePayload.imageUrl,
          previewImageUrl: imagePayload.previewImageUrl,
          imageStoragePath: imagePayload.imageStoragePath,
          previewStoragePath: imagePayload.previewStoragePath,
          sortOrder,
          isActive: productForm.isActive,
        },
        actor,
      );
      setProductForm(createEmptyProductForm());
      setProductImageFile(null);
      setProductImagePreviewUrl("");
      setProductFeedback("상품 정보를 저장했습니다.");
      setProducts((prev) =>
        mergePointProductIntoList(prev, {
          id: productId,
          name: productForm.name.trim(),
          description: productForm.description.trim(),
          price: Number(productForm.price || 0),
          stock: Number(productForm.stock || 0),
          imageUrl: imagePayload.imageUrl,
          previewImageUrl: imagePayload.previewImageUrl,
          imageStoragePath: imagePayload.imageStoragePath,
          previewStoragePath: imagePayload.previewStoragePath,
          sortOrder,
          isActive: productForm.isActive,
        }),
      );
    } catch (error: any) {
      console.error("Failed to save point product with upload:", error);
      setProductFeedback(error?.message || "상품 저장에 실패했습니다.");
    } finally {
      setProductImageUploading(false);
    }
  };

  const handleToggleProduct = async (product: PointProduct) => {
    if (!canManage) return;

    try {
      await upsertPointProduct(
        config,
        {
          ...product,
          isActive: !product.isActive,
        },
        actor,
      );
      setProducts((prev) =>
        prev.map((item) =>
          item.id === product.id
            ? {
                ...item,
                isActive: !product.isActive,
              }
            : item,
        ),
      );
      setProductFeedback(
        product.isActive
          ? "상품을 비활성화했습니다."
          : "상품을 다시 노출했습니다.",
      );
    } catch (error: any) {
      console.error("Failed to toggle point product:", error);
      setProductFeedback(error?.message || "상품 상태 변경에 실패했습니다.");
    }
  };

  const handleDeleteProduct = async (product: PointProduct) => {
    if (!canManage) return;

    const stock = Math.max(0, Math.floor(Number(product.stock || 0)));
    if (stock > 0) {
      setProductFeedback("재고가 0개인 상품만 삭제할 수 있습니다.");
      return;
    }

    if (
      !window.confirm(
        `"${product.name}" 상품을 삭제할까요?\n삭제한 상품은 학생 상점과 상품 관리 목록에서 사라집니다.`,
      )
    ) {
      return;
    }

    try {
      await deletePointProduct(config, product.id);
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      if (productForm.id === product.id) {
        setProductForm(createEmptyProductForm());
        setProductImageFile(null);
        setProductImagePreviewUrl("");
      }
      setProductFeedback("재고가 없는 상품을 삭제했습니다.");
    } catch (error: any) {
      console.error("Failed to delete point product:", error);
      setProductFeedback(error?.message || "상품 삭제에 실패했습니다.");
    }
  };

  const handleSaveOrder = async (nextStatus: PointOrderStatus) => {
    if (!selectedOrder || !canManage || orderSavingStatus) return;

    const orderId = selectedOrder.id;
    const memo = orderMemo.trim();
    try {
      setOrderSavingOrderId(orderId);
      setOrderSavingStatus(nextStatus);
      setOrderFeedback("구매 요청 상태를 반영하는 중입니다.");
      const result = await reviewPointOrder({
        config,
        orderId,
        nextStatus,
        actor,
        memo,
      });
      setOrders((prev) =>
        prev.map((order) =>
          order.id === result.orderId
            ? {
                ...order,
                status: result.status,
                stockDeducted:
                  result.status === "approved" || result.status === "fulfilled",
                reviewedAt: createLocalPointTimestamp(),
                reviewedBy: actor.uid,
                memo: memo || order.memo || "",
              }
            : order,
        ),
      );
      setOrderFeedback("구매 요청 상태를 반영했습니다.");
      void listPointOrders(config, { limitCount: 200 })
        .then((nextOrders) => setOrders(nextOrders))
        .catch((error) => {
          console.warn("Failed to refresh point orders after review:", error);
        });
    } catch (error: any) {
      console.error("Failed to review point order:", error);
      setOrderFeedback(error?.message || "요청 상태 변경에 실패했습니다.");
    } finally {
      setOrderSavingOrderId("");
      setOrderSavingStatus(null);
    }
  };

  const handleSelectEditableTransaction = (transactionId: string) => {
    setAdjustmentFeedback("");
    setSelectedEditableTransactionId(transactionId);
  };

  const refreshOverviewData = async () => {
    const nextWallets = await listPointWallets(config);
    const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) =>
      needsPointRankLegacyFallback(wallet),
    )
      ? await getPointRankManualAdjustEarnedPointsMap(config)
      : {};
    setWallets(nextWallets);
    setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);
    if (selectedUid) {
      await loadTransactionsForWallet(selectedUid);
    }
  };

  const handleSubmitAdjustmentUpdate = async () => {
    if (!selectedEditableTransaction || !selectedUid || !canManage) return;

    const nextDelta = Number(adjustmentDraftValue);
    if (!Number.isFinite(nextDelta) || nextDelta === 0) {
      setAdjustmentFeedback("수정 위스는 0이 아닌 숫자로 입력해 주세요.");
      return;
    }

    try {
      setAdjustmentSaving(true);
      setAdjustmentFeedback("");
      await updatePointAdjustment({
        config,
        transactionId: selectedEditableTransaction.id,
        action: "update",
        nextDelta,
      });
      await refreshOverviewData();
      setAdjustmentFeedback("직접 조정 위스를 수정했습니다.");
    } catch (error: any) {
      console.error("Failed to update point adjustment:", error);
      setAdjustmentFeedback(
        error?.message || "직접 조정 위스 수정에 실패했습니다.",
      );
    } finally {
      setAdjustmentSaving(false);
    }
  };

  const handleSubmitAdjustmentCancel = async () => {
    if (!selectedEditableTransaction || !selectedUid || !canManage) return;

    try {
      setAdjustmentSaving(true);
      setAdjustmentFeedback("");
      await updatePointAdjustment({
        config,
        transactionId: selectedEditableTransaction.id,
        action: "cancel",
      });
      await refreshOverviewData();
      setSelectedEditableTransactionId("");
      setAdjustmentDraftValue("");
      setAdjustmentFeedback("직접 조정 내역을 취소했습니다.");
    } catch (error: any) {
      console.error("Failed to cancel point adjustment:", error);
      setAdjustmentFeedback(error?.message || "직접 조정 취소에 실패했습니다.");
    } finally {
      setAdjustmentSaving(false);
    }
  };

  if (!canRead) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm font-bold text-red-700">
            위스 관리 화면을 볼 권한이 없습니다.
          </div>
        </div>
      </div>
    );
  }

  const usesSharedPanelFrame =
    activeTab !== "policy" &&
    activeTab !== "ranks" &&
    activeTab !== "hall-of-fame";
  const dataReady = !loading && !loadErrorMessage;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div
        className={[
          "mx-auto flex w-full flex-1 flex-col px-4 py-6",
          activeTab === "hall-of-fame" ? "max-w-[96rem] 2xl:px-6" : "max-w-7xl",
        ].join(" ")}
      >
        <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
          {(Object.keys(TEACHER_POINT_TAB_LABELS) as TeacherPointTab[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={`border-b-2 px-6 py-3 text-sm font-bold transition whitespace-nowrap ${
                  activeTab === tab
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                {TEACHER_POINT_TAB_LABELS[tab]}
              </button>
            ),
          )}
        </div>

        {!canManage && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            읽기 전용 권한으로 접속 중입니다.
          </div>
        )}

        <div
          className={
            usesSharedPanelFrame
              ? "rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6"
              : ""
          }
        >
          {loading && <PageDataLoading />}

          {!loading && !!loadErrorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
              {loadErrorMessage}
            </div>
          )}

          {dataReady && activeTab === "overview" && (
            <PointsOverviewTab
              wallets={paginatedWallets}
              totalWalletCount={sortedWallets.length}
              currentPage={currentOverviewPage}
              totalPages={overviewTotalPages}
              sortKey={overviewSortKey}
              sortDirection={overviewSortDirection}
              selectedWallet={selectedWallet}
              selectedUid={selectedUid}
              rankPolicy={savedPolicy.rankPolicy}
              rankManualAdjustEarnedPointsByUid={
                rankManualAdjustEarnedPointsByUid
              }
              gradeFilter={gradeFilter}
              classFilter={classFilter}
              numberFilter={numberFilter}
              nameSearch={nameSearch}
              gradeOptions={gradeOptions}
              classOptions={classOptions}
              numberOptions={numberOptions}
              transactions={transactions}
              canManage={canManage}
              selectedEditableTransactionId={selectedEditableTransactionId}
              adjustmentDraftValue={adjustmentDraftValue}
              adjustmentFeedback={adjustmentFeedback}
              adjustmentSaving={adjustmentSaving}
              onGradeFilterChange={setGradeFilter}
              onClassFilterChange={setClassFilter}
              onNumberFilterChange={setNumberFilter}
              onNameSearchChange={setNameSearch}
              onSortChange={handleOverviewSortChange}
              onPageChange={handleOverviewPageChange}
              onSelectWallet={setSelectedUid}
              onSelectEditableTransaction={handleSelectEditableTransaction}
              onAdjustmentDraftChange={setAdjustmentDraftValue}
              onSubmitAdjustmentUpdate={handleSubmitAdjustmentUpdate}
              onSubmitAdjustmentCancel={handleSubmitAdjustmentCancel}
            />
          )}

          {dataReady && activeTab === "grant" && (
            <PointGrantTab
              students={filteredGrantStudents}
              selectedStudent={selectedGrantStudent}
              selectedUid={grantSelectedUid}
              rankPolicy={savedPolicy.rankPolicy}
              rankManualAdjustEarnedPointsByUid={
                rankManualAdjustEarnedPointsByUid
              }
              canManage={canManage}
              manualAdjustEnabled={savedPolicy.manualAdjustEnabled}
              allowNegativeBalance={savedPolicy.allowNegativeBalance}
              loading={grantLoading}
              gradeFilter={grantGradeFilter}
              classFilter={grantClassFilter}
              numberFilter={grantNumberFilter}
              nameSearch={grantNameSearch}
              gradeOptions={grantGradeOptions.map((option) => option.value)}
              classOptions={grantClassOptions.map((option) => option.value)}
              numberOptions={grantNumberOptions}
              amount={grantAmount}
              reason={grantReason}
              feedback={grantFeedback}
              submittingMode={grantSubmittingMode}
              onGradeFilterChange={setGrantGradeFilter}
              onClassFilterChange={setGrantClassFilter}
              onNumberFilterChange={setGrantNumberFilter}
              onNameSearchChange={setGrantNameSearch}
              onSelectStudent={setGrantSelectedUid}
              onAmountChange={setGrantAmount}
              onReasonChange={setGrantReason}
              onSubmit={handleSaveGrant}
            />
          )}

          {dataReady && activeTab === "policy" && (
            <PointPolicyTab
              policy={policyDraft}
              canManage={canManage}
              hasUnsavedChanges={policyDirty}
              saveFeedbackMessage={policyFeedbackMessage}
              saveFeedbackTone={policyFeedbackTone}
              onPolicyChange={updatePolicyDraft}
              onSubmit={handleSavePolicy}
            />
          )}

          {dataReady && activeTab === "ranks" && (
            <PointRanksTab
              savedRankPolicy={savedRankPolicy}
              canManage={canManage}
              themeDraft={rankThemeDraft}
              themeHasUnsavedChanges={rankThemeDirty}
              themeSaveFeedbackMessage={rankThemeFeedbackMessage}
              themeSaveFeedbackTone={rankThemeFeedbackTone}
              onThemeDraftChange={updateRankThemeDraft}
              onThemeSave={handleSaveRankTheme}
              rankSettingsDraft={rankSettingsDraft}
              rankSettingsHasUnsavedChanges={rankSettingsDirty}
              rankSettingsSaveFeedbackMessage={rankSettingsFeedbackMessage}
              rankSettingsSaveFeedbackTone={rankSettingsFeedbackTone}
              onRankSettingsDraftChange={updateRankSettingsDraft}
              onRankSettingsSave={handleSaveRankSettings}
              emojiDraft={rankEmojiDraft}
              emojiHasUnsavedChanges={rankEmojiDirty}
              emojiSaveFeedbackMessage={rankEmojiFeedbackMessage}
              emojiSaveFeedbackTone={rankEmojiFeedbackTone}
              onEmojiDraftChange={updateRankEmojiDraft}
              onEmojiSave={handleSaveRankEmojiCollection}
            />
          )}

          {dataReady && activeTab === "hall-of-fame" && (
            <HallOfFameManagementTab
              config={config}
              interfaceConfig={interfaceConfig}
              canManage={canManage}
              onLoadHallOfFameState={loadHallOfFameState}
              onSaveHallOfFameConfig={saveHallOfFameConfig}
            />
          )}

          {dataReady && activeTab === "products" && (
            <PointProductsTab
              products={products}
              productForm={productForm}
              productFeedback={productFeedback}
              canManage={canManage}
              productImagePreviewUrl={productImagePreviewUrl}
              productImageUploading={productImageUploading}
              onProductFormChange={(updater) =>
                setProductForm((prev) => updater(prev))
              }
              onProductImageChange={handleProductImageChange}
              onEditProduct={(product) => {
                setProductForm({
                  id: product.id,
                  name: product.name || "",
                  description: product.description || "",
                  price: String(product.price || 0),
                  stock: String(product.stock || 0),
                  imageUrl: product.imageUrl || "",
                  previewImageUrl: product.previewImageUrl || "",
                  imageStoragePath: product.imageStoragePath || "",
                  previewStoragePath: product.previewStoragePath || "",
                  sortOrder: String(product.sortOrder || 0),
                  isActive: product.isActive !== false,
                });
                setProductImageFile(null);
                setProductImagePreviewUrl(
                  product.previewImageUrl || product.imageUrl || "",
                );
                setProductFeedback("");
              }}
              onResetForm={() => {
                setProductForm(createEmptyProductForm());
                setProductImageFile(null);
                setProductImagePreviewUrl("");
                setProductFeedback("");
              }}
              onToggleProduct={(product) => void handleToggleProduct(product)}
              onDeleteProduct={(product) => void handleDeleteProduct(product)}
              productOrderDirty={productOrderDirty}
              productOrderSaving={productOrderSaving}
              productOrderFeedback={productOrderFeedback}
              onReorderProducts={handleReorderProducts}
              onSaveProductOrder={handleSaveProductOrder}
              onSubmit={handleSaveProductWithUpload}
            />
          )}

          {dataReady && activeTab === "requests" && (
            <PointRequestsTab
              orders={filteredOrders}
              orderFilter={orderFilter}
              selectedOrderId={selectedOrderId}
              selectedOrder={selectedOrder}
              orderMemo={orderMemo}
              orderFeedback={orderFeedback}
              orderSavingOrderId={orderSavingOrderId}
              orderSavingStatus={orderSavingStatus}
              canManage={canManage}
              onFilterChange={setOrderFilter}
              onSelectOrder={setSelectedOrderId}
              onOrderMemoChange={setOrderMemo}
              onSaveOrder={(status) => void handleSaveOrder(status)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const ManagePoints: React.FC = () => {
  const { currentUser, config } = useAuth();
  // Drafts and outstanding reads belong to exactly one account and semester.
  // Tab changes retain edits; changing scope remounts the complete editor.
  return (
    <ManagePointsScope
      key={`${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}`}
    />
  );
};

export default ManagePoints;
