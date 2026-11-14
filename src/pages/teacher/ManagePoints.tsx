import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "../../lib/firebase";
import { ensureSensitiveOperation } from "../../lib/sensitiveOperation";
import { latestWisWallet } from "../../lib/wisEconomyClient";
import {
  getPendingCanonicalPointAdjustment,
  getCanonicalPointTransactionPage,
  getCanonicalPointWalletPage,
  getCanonicalPointWallet,
} from "../../lib/pointEconomyAdapter";
import { Link, useSearchParams } from "react-router-dom";
import { TEACHER_POINT_TAB_LABELS } from "../../constants/pointLabels";
import { useAppToast } from "../../components/common/AppToastProvider";
import { InlineLoading } from "../../components/common/LoadingState";
import { useAuth } from "../../contexts/AuthContext";
import { subscribePointsUpdated } from "../../lib/appEvents";
import {
  adjustPoints,
  deletePointProduct,
  getPointSchoolOptions,
  getPointPolicy,
  getPointRankManualAdjustEarnedPointsMap,
  listPointOrders,
  listPointProducts,
  POINT_POLICY_FALLBACK,
  reviewPointOrder,
  updatePointAdjustment,
  upsertPointPolicy,
  upsertPointProduct,
} from "../../lib/points";
import {
  getPointRankPolicyValidationError,
  needsPointRankLegacyFallback,
  resolvePointRankPolicyDraft,
} from "../../lib/pointRanks";
import { canManagePoints, canReadPoints } from "../../lib/permissions";
import { isSemesterArchive } from "../../lib/semesterArchive";
import {
  readArchivedShopProducts,
  readArchivedShopOrders,
} from "../../lib/pointShopArchive";
import { optimizeProductImage } from "../../lib/pointProductImages";
import { getYearSemester } from "../../lib/semesterScope";
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
import TeacherWisStocks from "./components/points/TeacherWisStocks";
import TeacherAvatarShopPage from "./components/points/TeacherAvatarShopPage";
import TeacherWisVillage from "./components/points/TeacherWisVillage";
import PortalSubNavigation from "../../components/common/PortalSubNavigation";
import { isTeacherAvatarShop } from "../../lib/avatarRoutes";

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
const OVERVIEW_PAGE_SIZE = 20;
const useDebouncedWisSearch = (value: string) => {
  const [debounced, setDebounced] = useState(value.trim());
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [value]);
  return debounced;
};
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

const ManagePoints: React.FC = () => {
  const {
    config,
    configReady,
    currentUser,
    authGeneration,
    userData,
    interfaceConfig,
    refreshInterfaceConfig,
  } = useAuth();
  const { showToast } = useAppToast();
  const [searchParams] = useSearchParams();

  const canRead = canReadPoints(userData, currentUser?.email);
  const canManage =
    !isSemesterArchive && canManagePoints(userData, currentUser?.email);

  const requestedTab = searchParams.get("tab");
  const activeTab: TeacherPointTab =
    requestedTab &&
    Object.prototype.hasOwnProperty.call(TEACHER_POINT_TAB_LABELS, requestedTab)
      ? (requestedTab as TeacherPointTab)
      : "overview";
  const isVillage = ["products", "requests", "stocks"].includes(activeTab);
  const [pointLoading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState<object | null>(null);
  const [loadedView, setLoadedView] = useState("");
  const [hallRefresh, setHallRefresh] = useState(0);
  const loadInFlightRef = useRef<{ scope: object; view: string } | null>(null);
  const policyLoadedScopeRef = useRef<object | null>(null);
  const schoolLoadedScopeRef = useRef<object | null>(null);
  const walletListRequestRef = useRef<object | null>(null);
  const scopeReady = Boolean(
    currentUser && configReady && config?.year && config?.semester,
  );
  const requestScope = useMemo(
    () => ({}),
    [
      currentUser,
      authGeneration,
      configReady,
      config?.year,
      config?.semester,
      canRead,
      canManage,
    ],
  );
  const currentScopeRef = useRef(requestScope);
  const scopeGenerationRef = useRef(0);
  if (currentScopeRef.current !== requestScope) scopeGenerationRef.current++;
  currentScopeRef.current = requestScope;
  const isCurrentScope = () => currentScopeRef.current === requestScope;
  const [wallets, setWallets] = useState<PointWallet[]>([]);
  const [students, setStudents] = useState<PointStudentTarget[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [selectedUid, setSelectedUid] = useState("");
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [transactionCursor, setTransactionCursor] = useState("");
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const transactionRequestRef = useRef<object | null>(null);
  const selectedUidRef = useRef(selectedUid);
  selectedUidRef.current = selectedUid;
  const walletRefreshRef = useRef(new Map<string, object>());
  const walletRevisionsRef = useRef(new Map<string, number>());
  const walletSnapshotsRef = useRef(new Map<string, PointWallet>());
  for (const wallet of wallets) {
    walletSnapshotsRef.current.set(
      wallet.uid,
      latestWisWallet(
        walletSnapshotsRef.current.get(wallet.uid) || null,
        wallet,
      )!,
    );
    walletRevisionsRef.current.set(
      wallet.uid,
      Math.max(
        walletRevisionsRef.current.get(wallet.uid) || 0,
        Number(wallet.revision || 0),
      ),
    );
  }
  const [savedPolicy, setSavedPolicy] = useState<PointPolicy>(EMPTY_POLICY);
  const [policyDraft, setPolicyDraft] = useState<PointPolicy>(EMPTY_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [rankThemeDraft, setRankThemeDraft] = useState<RankThemeDraft>(() =>
    createRankThemeDraft(EMPTY_POLICY.rankPolicy),
  );
  const [rankThemeDirty, setRankThemeDirty] = useState(false);
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
  const [overviewPages, setOverviewPages] = useState({
    key: "",
    cursors: [""],
    page: 1,
  });
  const [overviewNextCursor, setOverviewNextCursor] = useState("");
  const [grantGradeFilter, setGrantGradeFilter] = useState("all");
  const [grantClassFilter, setGrantClassFilter] = useState("all");
  const [grantNumberFilter, setGrantNumberFilter] = useState("all");
  const [grantNameSearch, setGrantNameSearch] = useState("");
  const debouncedNameSearch = useDebouncedWisSearch(nameSearch);
  const debouncedGrantNameSearch = useDebouncedWisSearch(grantNameSearch);
  const [grantPages, setGrantPages] = useState({
    key: "",
    cursors: [""],
    page: 1,
  });
  const [grantNextCursor, setGrantNextCursor] = useState("");
  const [grantReadError, setGrantReadError] = useState("");
  const [grantReadRefresh, setGrantReadRefresh] = useState(0);
  const [grantSelectedUid, setGrantSelectedUid] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const grantIntentRef = useRef<{ key: string; sourceId: string } | null>(null);
  const [grantFeedback, setGrantFeedback] = useState("");
  const [grantSubmittingMode, setGrantSubmittingMode] =
    useState<GrantMode | null>(null);
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
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("requested");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderMemo, setOrderMemo] = useState("");
  const [shopLoadError, setShopLoadError] = useState("");
  const [orderFeedback, setOrderFeedback] = useState("");
  const [orderSavingOrderId, setOrderSavingOrderId] = useState("");
  const [orderSavingStatus, setOrderSavingStatus] =
    useState<PointOrderStatus | null>(null);
  const [selectedEditableTransactionId, setSelectedEditableTransactionId] =
    useState("");
  const [adjustmentDraftValue, setAdjustmentDraftValue] = useState("");
  const [adjustmentFeedback, setAdjustmentFeedback] = useState("");
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const overviewSelection = {
    grade: gradeFilter === "all" ? "" : gradeFilter,
    classNumber:
      gradeFilter === "all" || classFilter === "all" ? "" : classFilter,
    studentNumber:
      classFilter === "all" || numberFilter === "all" ? "" : numberFilter,
    namePrefix: debouncedNameSearch,
    sortField:
      overviewSortKey === "earnedTotal"
        ? ("earnedTotal" as const)
        : overviewSortKey === "spentTotal"
          ? ("spentTotal" as const)
          : ("balance" as const),
    direction: overviewSortDirection,
  };
  const overviewSelectionKey = JSON.stringify(overviewSelection);
  const currentOverviewPage =
    overviewPages.key === overviewSelectionKey ? overviewPages.page : 1;
  const overviewCursor =
    overviewPages.key === overviewSelectionKey
      ? overviewPages.cursors[currentOverviewPage - 1]
      : "";
  const viewKey =
    activeTab === "overview"
      ? `${activeTab}:${overviewSelectionKey}:${overviewCursor}`
      : activeTab;
  const currentViewRef = useRef(viewKey);
  currentViewRef.current = viewKey;
  const loading =
    activeTab !== "hall-of-fame" &&
    activeTab !== "stocks" &&
    (pointLoading || loadedScope !== requestScope || loadedView !== viewKey);
  const grantSelection = {
    grade: grantGradeFilter === "all" ? "" : grantGradeFilter,
    classNumber:
      grantGradeFilter === "all" || grantClassFilter === "all"
        ? ""
        : grantClassFilter,
    studentNumber:
      grantClassFilter === "all" || grantNumberFilter === "all"
        ? ""
        : grantNumberFilter,
    namePrefix: debouncedGrantNameSearch,
    sortField: "balance" as const,
    direction: "desc" as const,
  };
  const grantSelectionKey = JSON.stringify(grantSelection);
  const currentGrantPage =
    grantPages.key === grantSelectionKey ? grantPages.page : 1;
  const grantCursor =
    grantPages.key === grantSelectionKey
      ? grantPages.cursors[currentGrantPage - 1]
      : "";

  const actor = useMemo(
    () => ({
      uid: currentUser?.uid || "",
      name: userData?.name || currentUser?.displayName || "",
    }),
    [currentUser?.displayName, currentUser?.uid, userData?.name, userData?.uid],
  );
  const savedRankPolicy = useMemo(
    () => resolvePointRankPolicyDraft(savedPolicy.rankPolicy),
    [savedPolicy.rankPolicy],
  );
  const [pendingAdjustment, setPendingAdjustment] = useState(() =>
    getPendingCanonicalPointAdjustment(config),
  );
  useEffect(() => {
    setPendingAdjustment(getPendingCanonicalPointAdjustment(config));
  }, [actor.uid, config?.year, config?.semester]);

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

  const gradeOptions = grantGradeOptions.map((option) => option.value);
  const classOptions = grantClassOptions.map((option) => option.value);
  const numberOptions: string[] = [];
  // The server owns filtering and ordering. This array is exactly one page.
  const filteredWallets = wallets;
  const sortedWallets = wallets;
  const paginatedWallets = wallets;
  const overviewTotalPages = currentOverviewPage + (overviewNextCursor ? 1 : 0);

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
  const isGlobalGrantSearch = debouncedGrantNameSearch.length > 0;

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
      students.map((student) => ({
        ...student,
        wallet: walletMap.get(student.uid) || null,
      })),
    [students, walletMap],
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

  const loadTransactionsForWallet = async (uid: string, append = false) => {
    if (!isCurrentScope()) return;
    if (!uid) {
      setTransactions([]);
      setTransactionCursor("");
      return;
    }
    if (append && (!transactionCursor || transactionsLoading)) return;
    const request = {};
    transactionRequestRef.current = request;
    setTransactionsLoading(true);
    setTransactionsError("");
    if (!append) {
      setTransactions([]);
      setTransactionCursor("");
    }
    try {
      const page = await getCanonicalPointTransactionPage(
        config,
        uid,
        append ? transactionCursor : "",
      );
      if (
        !isCurrentScope() ||
        transactionRequestRef.current !== request ||
        selectedUidRef.current !== uid
      )
        return;
      if (
        Number(page.wallet?.revision || 0) <
        (walletRevisionsRef.current.get(uid) || 0)
      ) {
        setTransactionsError(
          "새 위스 내역이 반영되었습니다. 새로고침해 주세요.",
        );
        return;
      }
      walletRevisionsRef.current.set(uid, Number(page.wallet?.revision || 0));
      if (append && page.wallet?.revision !== selectedWallet?.revision) {
        void loadTransactionsForWallet(uid);
        return;
      }
      setTransactions((previous) =>
        append
          ? [
              ...new Map(
                [...previous, ...page.transactions].map((entry) => [
                  entry.id,
                  entry,
                ]),
              ).values(),
            ]
          : page.transactions,
      );
      setTransactionCursor(page.nextCursor);
      if (!append && page.wallet)
        setWallets((previous) =>
          previous.map((wallet) =>
            wallet.uid === uid ? latestWisWallet(wallet, page.wallet)! : wallet,
          ),
        );
    } catch (error) {
      if (
        isCurrentScope() &&
        transactionRequestRef.current === request &&
        selectedUidRef.current === uid
      )
        setTransactionsError(
          "위스 내역을 불러오지 못했습니다. 다시 불러와 주세요.",
        );
    } finally {
      if (isCurrentScope() && transactionRequestRef.current === request) {
        transactionRequestRef.current = null;
        setTransactionsLoading(false);
      }
    }
  };

  const commitWalletList = (nextWallets: PointWallet[], request: object) => {
    if (!isCurrentScope() || walletListRequestRef.current !== request)
      return false;
    setWallets((current) => {
      if (!isCurrentScope() || walletListRequestRef.current !== request)
        return current;
      const currentByUid = new Map(
        current.map((wallet) => [wallet.uid, wallet]),
      );
      return nextWallets.map(
        (wallet) =>
          latestWisWallet(
            currentByUid.get(wallet.uid) ||
              walletSnapshotsRef.current.get(wallet.uid) ||
              null,
            wallet,
          )!,
      );
    });
    return true;
  };

  const refreshOrders = async () => {
    if (
      !canRead ||
      !scopeReady ||
      !isCurrentScope() ||
      activeTab !== "requests" ||
      currentViewRef.current !== "requests"
    )
      return;
    if (
      loadInFlightRef.current?.scope === requestScope &&
      loadInFlightRef.current.view === "requests"
    )
      return;
    const loadRequest = { scope: requestScope, view: "requests" };
    loadInFlightRef.current = loadRequest;
    const current = () =>
      isCurrentScope() &&
      currentViewRef.current === "requests" &&
      loadInFlightRef.current === loadRequest;
    setShopLoadError("");
    try {
      const nextOrders = isSemesterArchive
        ? await readArchivedShopOrders()
        : await listPointOrders(config, { limitCount: 200 });
      if (current()) setOrders(nextOrders);
    } catch (error: any) {
      if (current())
        setShopLoadError(
          error?.message ||
            "주문 내역을 불러오지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (loadInFlightRef.current === loadRequest)
        loadInFlightRef.current = null;
    }
  };

  const loadAll = async (force = true) => {
    if (!isCurrentScope()) return;
    if (
      !canRead ||
      !scopeReady ||
      activeTab === "hall-of-fame" ||
      activeTab === "stocks"
    ) {
      setLoading(false);
      return;
    }
    if (
      loadInFlightRef.current?.scope === requestScope &&
      loadInFlightRef.current.view === viewKey
    )
      return;
    const loadRequest = { scope: requestScope, view: viewKey };
    loadInFlightRef.current = loadRequest;
    const current = () =>
      isCurrentScope() &&
      currentViewRef.current === viewKey &&
      loadInFlightRef.current === loadRequest;
    const walletListRequest = {};
    walletListRequestRef.current = walletListRequest;

    setLoading(true);
    setShopLoadError("");
    if (activeTab === "overview") {
      setWallets([]);
      setSelectedUid("");
      setOverviewNextCursor("");
    }
    try {
      if (
        isSemesterArchive &&
        ["products", "requests"].includes(searchParams.get("tab") || "")
      ) {
        if (searchParams.get("tab") === "products") {
          const nextProducts = await readArchivedShopProducts();
          if (current()) setProducts(nextProducts);
        } else {
          const nextOrders = await readArchivedShopOrders();
          if (current()) setOrders(nextOrders);
        }
        return;
      }
      const needsSchool = ["overview", "grant"].includes(activeTab);
      const needsPolicy = ["overview", "grant", "policy", "ranks"].includes(
        activeTab,
      );
      const [
        walletPage,
        nextSchoolOptions,
        nextPolicy,
        nextProducts,
        nextOrders,
      ] = await Promise.all([
        activeTab === "overview"
          ? getCanonicalPointWalletPage(
              config,
              overviewSelection,
              overviewCursor,
              OVERVIEW_PAGE_SIZE,
            )
          : null,
        needsSchool && (force || schoolLoadedScopeRef.current !== requestScope)
          ? getPointSchoolOptions()
          : null,
        needsPolicy && (force || policyLoadedScopeRef.current !== requestScope)
          ? getPointPolicy(config)
          : null,
        activeTab === "products" ? listPointProducts(config, false) : null,
        activeTab === "requests" ? listPointOrders(config) : null,
      ]);
      if (!current()) return;
      const nextWallets = walletPage?.wallets || [];
      const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) =>
        needsPointRankLegacyFallback(wallet),
      )
        ? await getPointRankManualAdjustEarnedPointsMap(config)
        : {};

      if (!current()) return;
      const walletListCommitted =
        walletPage && commitWalletList(nextWallets, walletListRequest);
      if (nextSchoolOptions) {
        setGrantGradeOptions(nextSchoolOptions.grades);
        setGrantClassOptions(nextSchoolOptions.classes);
        schoolLoadedScopeRef.current = requestScope;
      }
      if (nextPolicy) {
        applyConfirmedPolicy(nextPolicy);
        policyLoadedScopeRef.current = requestScope;
      }
      if (nextProducts) {
        setProducts(nextProducts);
        setProductOrderDirty(false);
        setProductOrderSaving(false);
      }
      if (nextOrders) setOrders(nextOrders);
      if (walletListCommitted) {
        setOverviewNextCursor(walletPage.nextCursor);
        setRankManualAdjustEarnedPointsByUid(
          nextRankManualAdjustEarnedPointsByUid,
        );
        setSelectedUid((current) =>
          current && nextWallets.some((wallet) => wallet.uid === current)
            ? current
            : nextWallets[0]?.uid || "",
        );
      }
    } catch (error: any) {
      if (
        current() &&
        activeTab === "overview" &&
        overviewCursor &&
        error?.details?.reason === "WIS_OVERVIEW_PAGE_CHANGED"
      ) {
        setOverviewPages({ key: overviewSelectionKey, cursors: [""], page: 1 });
        return;
      }
      if (current())
        setShopLoadError(
          error?.message ||
            "위스 자료를 불러오지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      if (current()) {
        setLoadedScope(requestScope);
        setLoadedView(viewKey);
        setLoading(false);
      }
      if (loadInFlightRef.current === loadRequest)
        loadInFlightRef.current = null;
    }
  };

  useEffect(() => {
    setGrantFeedback("");
    setProductFeedback("");
    setOrderFeedback("");
  }, [searchParams]);

  useEffect(() => {
    setWallets([]);
    setStudents([]);
    setTransactions([]);
    setTransactionCursor("");
    setTransactionsError("");
    setTransactionsLoading(false);
    transactionRequestRef.current = null;
    loadInFlightRef.current = null;
    policyLoadedScopeRef.current = null;
    schoolLoadedScopeRef.current = null;
    walletListRequestRef.current = null;
    walletRefreshRef.current.clear();
    walletRevisionsRef.current.clear();
    walletSnapshotsRef.current.clear();
    setProducts([]);
    setOrders([]);
    setSelectedUid("");
    setSavedPolicy(EMPTY_POLICY);
    setPolicyDraft(EMPTY_POLICY);
    setPolicyDirty(false);
    setRankThemeDraft(createRankThemeDraft(EMPTY_POLICY.rankPolicy));
    setRankSettingsDraft(createRankSettingsDraft(EMPTY_POLICY.rankPolicy));
    setRankEmojiDraft(createRankEmojiCollectionDraft(EMPTY_POLICY.rankPolicy));
    setRankManualAdjustEarnedPointsByUid({});
    setLoadedScope(null);
    setLoadedView("");
    setOverviewPages({ key: "", cursors: [""], page: 1 });
    setOverviewNextCursor("");
    setGrantPages({ key: "", cursors: [""], page: 1 });
    setGrantNextCursor("");
    setGrantReadError("");
    setShopLoadError("");
  }, [requestScope]);

  useEffect(() => {
    if (activeTab === "hall-of-fame" || activeTab === "stocks" || !scopeReady)
      return;
    if (
      loadedScope !== requestScope ||
      loadedView !== viewKey ||
      (isSemesterArchive && ["products", "requests"].includes(activeTab))
    )
      void loadAll(false);
  }, [canRead, requestScope, viewKey]);

  useEffect(() => {
    if (!scopeReady || !canRead || activeTab !== "hall-of-fame") return;
    return subscribePointsUpdated(() => {
      setHallRefresh((value) => value + 1);
    });
  }, [canRead, requestScope, activeTab]);

  useEffect(() => {
    if (
      !scopeReady ||
      !canRead ||
      activeTab !== "overview" ||
      loadedScope !== requestScope ||
      loadedView !== viewKey ||
      pointLoading ||
      !!shopLoadError
    )
      return;
    if (!selectedUid) {
      setTransactions([]);
      return;
    }

    void loadTransactionsForWallet(selectedUid);
    return () => {
      transactionRequestRef.current = null;
    };
  }, [
    requestScope,
    selectedUid,
    activeTab,
    loadedScope,
    loadedView,
    pointLoading,
    shopLoadError,
    canRead,
  ]);

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
    if (activeTab !== "overview") return;
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
  }, [
    activeTab,
    filteredWallets,
    paginatedWallets,
    selectedUid,
    sortedWallets,
  ]);

  useEffect(() => {
    if (
      grantClassFilter !== "all" &&
      !grantClassOptions.some((option) => option.value === grantClassFilter)
    )
      setGrantClassFilter("all");
  }, [grantClassFilter, grantClassOptions]);

  useEffect(() => {
    if (
      grantSelectedUid &&
      !filteredGrantStudents.some((student) => student.uid === grantSelectedUid)
    ) {
      setGrantSelectedUid(filteredGrantStudents[0]?.uid || "");
    }
  }, [filteredGrantStudents, grantSelectedUid]);

  useEffect(() => {
    if (!scopeReady || !canRead || activeTab !== "grant") return;
    if (
      !isGlobalGrantSearch &&
      (grantGradeFilter === "all" || grantClassFilter === "all")
    ) {
      setStudents([]);
      setGrantSelectedUid("");
      setGrantNextCursor("");
      setGrantLoading(false);
      return;
    }

    let cancelled = false;
    const loadGrantStudents = async () => {
      setGrantLoading(true);
      setGrantReadError("");
      setStudents([]);
      setGrantSelectedUid("");
      setGrantNextCursor("");
      try {
        const page = await getCanonicalPointWalletPage(
          config,
          grantSelection,
          grantCursor,
          OVERVIEW_PAGE_SIZE,
        );
        if (cancelled || !isCurrentScope()) return;
        const nextStudents = page.wallets.map((wallet) => ({
          uid: wallet.uid,
          studentName: wallet.studentName,
          grade: wallet.grade,
          class: wallet.class,
          number: wallet.number,
          email: "",
        }));
        setWallets(
          page.wallets.map(
            (wallet) =>
              latestWisWallet(
                walletSnapshotsRef.current.get(wallet.uid) || null,
                wallet,
              )!,
          ),
        );
        setGrantNextCursor(page.nextCursor);
        setStudents(nextStudents);
        setGrantSelectedUid((prev) =>
          prev && nextStudents.some((student) => student.uid === prev)
            ? prev
            : nextStudents[0]?.uid || "",
        );
      } catch (error: any) {
        if (
          !cancelled &&
          isCurrentScope() &&
          grantCursor &&
          error?.details?.reason === "WIS_OVERVIEW_PAGE_CHANGED"
        ) {
          setGrantPages({ key: grantSelectionKey, cursors: [""], page: 1 });
          return;
        }
        if (!cancelled && isCurrentScope())
          setGrantReadError(
            error?.message ||
              "학생 명단을 불러오지 못했습니다. 다시 시도해 주세요.",
          );
      } finally {
        if (!cancelled) setGrantLoading(false);
      }
    };

    void loadGrantStudents();
    return () => {
      cancelled = true;
    };
  }, [
    requestScope,
    activeTab,
    canRead,
    grantSelectionKey,
    grantCursor,
    grantReadRefresh,
  ]);

  useEffect(() => {
    setOrderMemo(selectedOrder?.reviewReason || "");
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
    setOverviewSortKey(sortKey);
    setOverviewSortDirection(nextSortDirection);
  };

  const handleOverviewPageChange = (page: number) => {
    if (pointLoading || (page > currentOverviewPage && !overviewNextCursor))
      return;
    setOverviewPages((previous) => {
      const cursors =
        previous.key === overviewSelectionKey ? [...previous.cursors] : [""];
      if (page === currentOverviewPage + 1)
        cursors[currentOverviewPage] = overviewNextCursor;
      return {
        key: overviewSelectionKey,
        cursors,
        page: Math.max(1, Math.min(page, cursors.length)),
      };
    });
  };
  const handleGrantPageChange = (page: number) => {
    if (grantLoading || (page > currentGrantPage && !grantNextCursor)) return;
    setGrantPages((previous) => {
      const cursors =
        previous.key === grantSelectionKey ? [...previous.cursors] : [""];
      if (page === currentGrantPage + 1)
        cursors[currentGrantPage] = grantNextCursor;
      return {
        key: grantSelectionKey,
        cursors,
        page: Math.max(1, Math.min(page, cursors.length)),
      };
    });
  };

  const updatePolicyDraft = (updater: (prev: PointPolicy) => PointPolicy) => {
    setPolicyDraft((prev) => updater(prev));
    setPolicyDirty(true);
  };

  const updateRankThemeDraft = (
    updater: (prev: RankThemeDraft) => RankThemeDraft,
  ) => {
    setRankThemeDraft((prev) => updater(prev));
    setRankThemeDirty(true);
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
  };

  const handleSaveProductOrder = async () => {
    if (!canManage || !productOrderDirty || productOrderSaving) return;

    const orderedProducts = resequencePointProducts(
      sortPointProducts(products),
    );
    setProductOrderSaving(true);

    try {
      await Promise.all(
        orderedProducts.map((product) =>
          upsertPointProduct(
            config,
            {
              ...product,
              sortOrder: product.sortOrder,
            },
            actor,
          ),
        ),
      );
      setProducts(orderedProducts);
      setProductOrderDirty(false);
      showToast({
        tone: "success",
        title: "상품 순서 저장",
        message: "상품 순서를 저장했습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save product order:", error);
      showToast({
        tone: "error",
        title: "상품 순서 저장 실패",
        message: error?.message || "상품 순서 저장에 실패했습니다.",
      });
    } finally {
      setProductOrderSaving(false);
    }
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
      if (normalizedMessage.includes("insufficient point balance")) {
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
    setGrantSubmittingMode(mode);
    setGrantFeedback("");
    try {
      const intentKey = JSON.stringify([
        actor.uid,
        config?.year,
        config?.semester,
        selectedGrantStudent.uid,
        mode,
        numericAmount,
        grantReason.trim(),
      ]);
      if (grantIntentRef.current?.key !== intentKey)
        grantIntentRef.current = {
          key: intentKey,
          sourceId: `manual_${crypto.randomUUID()}`,
        };
      const result = await adjustPoints({
        config,
        uid: selectedGrantStudent.uid,
        delta: mode === "reclaim" ? -numericAmount : numericAmount,
        sourceId: grantIntentRef.current.sourceId,
        sourceLabel: grantReason.trim(),
        mode,
        actor,
      });
      if (!isCurrentScope()) return;
      grantIntentRef.current = null;
      setGrantAmount("");
      setGrantReason("");
      const grantedUid = selectedGrantStudent.uid;
      walletRevisionsRef.current.set(
        grantedUid,
        Math.max(
          walletRevisionsRef.current.get(grantedUid) || 0,
          Number(result.accountRevision || 0),
        ),
      );
      // Only use the committed server balance. A later read failure must never
      // turn an acknowledged grant into a failed grant or prompt a second one.
      setWallets((previous) =>
        previous.map((wallet) =>
          wallet.uid === grantedUid
            ? latestWisWallet(wallet, {
                ...wallet,
                balance: result.balance,
                revision: result.accountRevision,
              })!
            : wallet,
        ),
      );
      setSelectedUid(grantedUid);
      showToast({
        tone: "success",
        title: `${actionLabel}되었습니다.`,
        message: `${selectedGrantStudent.studentName} · 잔액 ${Number(result.balance).toLocaleString("ko-KR")} 위스`,
      });
      const refreshToken = {};
      walletRefreshRef.current.set(grantedUid, refreshToken);
      void getCanonicalPointWallet(config, grantedUid)
        .then((nextWallet) => {
          if (
            !isCurrentScope() ||
            walletRefreshRef.current.get(grantedUid) !== refreshToken
          )
            return;
          if (
            Number(nextWallet?.revision || 0) <
            (walletRevisionsRef.current.get(grantedUid) || 0)
          )
            return;
          walletRevisionsRef.current.set(
            grantedUid,
            Number(nextWallet?.revision || 0),
          );
          if (nextWallet)
            setWallets((previous) =>
              previous.map((wallet) =>
                wallet.uid === grantedUid
                  ? latestWisWallet(wallet, nextWallet)!
                  : wallet,
              ),
            );
        })
        .catch(() => {
          if (
            !isCurrentScope() ||
            walletRefreshRef.current.get(grantedUid) !== refreshToken
          )
            return;
          setGrantFeedback(
            `${actionLabel}은 완료되었습니다. 최신 내역은 위스 현황에서 다시 불러와 주세요.`,
          );
        });
    } catch (error: any) {
      console.error("Failed to adjust points:", error);
      if (!isCurrentScope()) return;
      const failureMessage = getGrantFailureMessage(error, mode);
      showToast({
        tone: "error",
        title: `위스 ${actionLabel}에 실패했습니다.`,
        message: failureMessage,
      });
    } finally {
      if (isCurrentScope()) setGrantSubmittingMode(null);
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
      showToast({
        tone: "success",
        title: "운영 정책 저장",
        message: "운영 정책이 저장되었습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save point policy:", error);
      showToast({
        tone: "error",
        title: "운영 정책 저장 실패",
        message:
          "저장 중 문제가 발생했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.",
      });
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
      showToast({
        tone: "success",
        title: "테마 설정 저장",
        message: "테마 설정이 저장되었습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save rank theme:", error);
      showToast({
        tone: "error",
        title: "테마 설정 저장 실패",
        message: "테마 설정 저장에 실패했습니다. 다시 시도해 주세요.",
      });
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
      setRankSettingsFeedbackTone(null);
      setRankSettingsFeedbackMessage("");
      showToast({
        tone: "success",
        title: "등급 관리 저장",
        message: "등급 관리가 저장되었습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save rank settings:", error);
      setRankSettingsFeedbackTone(null);
      setRankSettingsFeedbackMessage("");
      showToast({
        tone: "error",
        title: "등급 관리 저장 실패",
        message: "등급 관리 저장에 실패했습니다. 다시 시도해 주세요.",
      });
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
      setRankEmojiFeedbackTone(null);
      setRankEmojiFeedbackMessage("");
      showToast({
        tone: "success",
        title: "이모지 모음 저장",
        message: "이모지 모음이 저장되었습니다.",
      });
    } catch (error: any) {
      console.error("Failed to save rank emoji collection:", error);
      setRankEmojiFeedbackTone(null);
      setRankEmojiFeedbackMessage("");
      showToast({
        tone: "error",
        title: "이모지 모음 저장 실패",
        message: "이모지 모음 저장에 실패했습니다. 다시 시도해 주세요.",
      });
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
    if (!canManage || productImageUploading) return;
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
      const canonicalProduct = await upsertPointProduct(
        config,
        {
          ...savedProduct,
          id: productForm.id || undefined,
        },
        actor,
      );
      setProductForm(createEmptyProductForm());
      setProductFeedback("");
      showToast({
        tone: "success",
        title: "상품 저장 완료",
        message: "상품 정보를 저장했습니다.",
      });
      setProducts((prev) => mergePointProductIntoList(prev, canonicalProduct));
    } catch (error: any) {
      console.error("Failed to save point product:", error);
      setProductFeedback("");
      showToast({
        tone: "error",
        title: "상품 저장 실패",
        message: error?.message || "상품 저장에 실패했습니다.",
      });
    }
  };

  const handleSaveProductWithUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || productImageUploading) return;
    if (!productForm.name.trim()) {
      setProductFeedback("상품명을 입력해 주세요.");
      return;
    }

    try {
      setProductImageUploading(true);
      const productId = productForm.id || crypto.randomUUID();
      const sortOrder = resolveProductSortOrder(
        productForm.id,
        productForm.sortOrder,
      );
      let imagePayload = {
        imageUrl: productForm.imageUrl.trim(),
        previewImageUrl: productForm.previewImageUrl.trim(),
        imageStoragePath: productForm.imageStoragePath.trim(),
        previewStoragePath: productForm.previewStoragePath.trim(),
      };

      if (productImageFile) {
        setProductImageUploading(true);
        await ensureSensitiveOperation();
        const { year, semester } = getYearSemester(config);
        const basePath = `years/${year}/semesters/${semester}/point_products/${productId}`;
        const [compressedBlob, previewBlob] = await Promise.all([
          optimizeProductImage(productImageFile, "detail"),
          optimizeProductImage(productImageFile, "preview"),
        ]);
        const imageVersion = crypto.randomUUID();
        const storage = await getFirebaseStorage();
        const imageRef = ref(
          storage,
          `${basePath}/image-1200-${imageVersion}.${compressedBlob.type === "image/webp" ? "webp" : "jpg"}`,
        );
        const previewRef = ref(
          storage,
          `${basePath}/preview-640-${imageVersion}.${previewBlob.type === "image/webp" ? "webp" : "jpg"}`,
        );

        await uploadBytes(imageRef, compressedBlob, {
          contentType: compressedBlob.type || "image/jpeg",
          cacheControl: "public,max-age=31536000,immutable",
        });
        await uploadBytes(previewRef, previewBlob, {
          contentType: previewBlob.type || "image/jpeg",
          cacheControl: "public,max-age=31536000,immutable",
        });

        imagePayload = {
          imageUrl: await getDownloadURL(imageRef),
          previewImageUrl: await getDownloadURL(previewRef),
          imageStoragePath: imageRef.fullPath,
          previewStoragePath: previewRef.fullPath,
        };
        setProductForm((previous) => ({ ...previous, ...imagePayload }));
        setProductImageFile(null);
      }

      const savedProduct = await upsertPointProduct(
        config,
        {
          id: productForm.id || undefined,
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
      setProductFeedback("");
      showToast({
        tone: "success",
        title: "상품 저장 완료",
        message: "상품 정보를 저장했습니다.",
      });
      setProducts((prev) => mergePointProductIntoList(prev, savedProduct));
    } catch (error: any) {
      console.error("Failed to save point product with upload:", error);
      setProductFeedback("");
      showToast({
        tone: "error",
        title: "상품 저장 실패",
        message: error?.message || "상품 저장에 실패했습니다.",
      });
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
      setProductFeedback("");
      showToast({
        tone: "success",
        title: "상품 상태 변경",
        message: product.isActive
          ? "상품을 비활성화했습니다."
          : "상품을 다시 노출했습니다.",
      });
    } catch (error: any) {
      console.error("Failed to toggle point product:", error);
      setProductFeedback("");
      showToast({
        tone: "error",
        title: "상품 상태 변경 실패",
        message: error?.message || "상품 상태 변경에 실패했습니다.",
      });
    }
  };

  const handleDeleteProduct = async (product: PointProduct) => {
    if (!canManage) return;

    const stock =
      Math.max(0, Number(product.availableStock ?? product.stock)) +
      Number(product.reservedStock || 0);
    if (stock > 0) {
      setProductFeedback("재고가 0개인 상품만 보관할 수 있습니다.");
      return;
    }

    if (
      !window.confirm(
        `"${product.name}" 상품을 보관할까요?\n학생 상점에서 숨겨집니다.`,
      )
    ) {
      return;
    }

    try {
      await deletePointProduct(config, product.id);
      setProducts((prev) =>
        prev.map((item) =>
          item.id === product.id ? { ...item, isActive: false } : item,
        ),
      );
      if (productForm.id === product.id) {
        setProductForm(createEmptyProductForm());
        setProductImageFile(null);
        setProductImagePreviewUrl("");
      }
      setProductFeedback("");
      showToast({
        tone: "success",
        title: "상품 보관 완료",
        message: "재고가 없는 상품을 보관했습니다.",
      });
    } catch (error: any) {
      console.error("Failed to delete point product:", error);
      setProductFeedback("");
      showToast({
        tone: "error",
        title: "상품 보관 실패",
        message: error?.message || "상품 삭제에 실패했습니다.",
      });
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
                reviewReason: memo,
              }
            : order,
        ),
      );
      setOrderFeedback("");
      showToast({
        tone: "success",
        title: "주문 상태 변경",
        message: "구매 요청 상태를 반영했습니다.",
      });
      void listPointOrders(config)
        .then((nextOrders) => {
          if (!isCurrentScope() || currentViewRef.current !== "requests")
            return;
          setOrders(nextOrders);
        })
        .catch((error) => {
          console.warn("Failed to refresh point orders after review:", error);
        });
    } catch (error: any) {
      console.error("Failed to review point order:", error);
      setOrderFeedback("");
      showToast({
        tone: "error",
        title: "주문 상태 변경 실패",
        message: error?.message || "요청 상태 변경에 실패했습니다.",
      });
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
    if (!isCurrentScope()) return;
    const request = {};
    walletListRequestRef.current = request;
    const page = await getCanonicalPointWalletPage(
      config,
      overviewSelection,
      overviewCursor,
      OVERVIEW_PAGE_SIZE,
    );
    const nextWallets = page.wallets;
    if (
      !isCurrentScope() ||
      currentViewRef.current !== viewKey ||
      walletListRequestRef.current !== request
    )
      return;
    const nextRankManualAdjustEarnedPointsByUid = nextWallets.some((wallet) =>
      needsPointRankLegacyFallback(wallet),
    )
      ? await getPointRankManualAdjustEarnedPointsMap(config)
      : {};
    if (!commitWalletList(nextWallets, request)) return;
    setOverviewNextCursor(page.nextCursor);
    setRankManualAdjustEarnedPointsByUid(nextRankManualAdjustEarnedPointsByUid);
    if (selectedUidRef.current) {
      await loadTransactionsForWallet(selectedUidRef.current);
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
      setAdjustmentFeedback("");
      showToast({
        tone: "success",
        title: "위스 조정 수정",
        message: "직접 조정 위스를 수정했습니다.",
      });
    } catch (error: any) {
      console.error("Failed to update point adjustment:", error);
      const message = error?.message || "직접 조정 위스 수정에 실패했습니다.";
      setAdjustmentFeedback(
        getPendingCanonicalPointAdjustment(config) ? message : "",
      );
      showToast({
        tone: "error",
        title: "위스 조정 수정 실패",
        message: message,
      });
    } finally {
      setAdjustmentSaving(false);
      setPendingAdjustment(getPendingCanonicalPointAdjustment(config));
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
      setAdjustmentFeedback("");
      showToast({
        tone: "success",
        title: "위스 조정 취소",
        message: "직접 조정 내역을 취소했습니다.",
      });
    } catch (error: any) {
      console.error("Failed to cancel point adjustment:", error);
      const message = error?.message || "직접 조정 취소에 실패했습니다.";
      setAdjustmentFeedback(
        getPendingCanonicalPointAdjustment(config) ? message : "",
      );
      showToast({
        tone: "error",
        title: "위스 조정 취소 실패",
        message: message,
      });
    } finally {
      setAdjustmentSaving(false);
      setPendingAdjustment(getPendingCanonicalPointAdjustment(config));
    }
  };

  const resumePendingAdjustment = async () => {
    if (!canManage || !pendingAdjustment || adjustmentSaving) return;
    setAdjustmentSaving(true);
    try {
      await updatePointAdjustment({ config, ...pendingAdjustment });
      await refreshOverviewData();
      setAdjustmentFeedback("");
      showToast({
        tone: "success",
        title: "위스 조정 완료",
        message: "이전 조정 처리를 완료했습니다.",
      });
    } catch (error: any) {
      const message = error?.message || "조정 결과를 확인하지 못했습니다.";
      setAdjustmentFeedback(
        getPendingCanonicalPointAdjustment(config) ? message : "",
      );
      showToast({
        tone: "error",
        title: "위스 조정 확인 실패",
        message: message,
      });
    } finally {
      setAdjustmentSaving(false);
      setPendingAdjustment(getPendingCanonicalPointAdjustment(config));
    }
  };

  if (!canRead) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <main className="ws-page flex-1">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm font-bold text-red-700">
            위스 관리 화면을 볼 권한이 없습니다.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className={
        isVillage
          ? "flex min-w-0 flex-col bg-gray-50"
          : "flex min-h-screen flex-col bg-gray-50"
      }
    >
      <main
        className={
          isVillage || activeTab === "policy" || activeTab === "ranks"
            ? "flex w-full flex-1 flex-col"
            : "ws-page flex flex-1 flex-col"
        }
      >
        <TeacherWisVillage
          active={
            activeTab === "stocks"
              ? "stocks"
              : activeTab === "products" || activeTab === "requests"
                ? "products"
                : undefined
          }
        >
          {!canManage && activeTab !== "policy" && activeTab !== "ranks" && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              읽기 전용 권한으로 접속 중입니다.
            </div>
          )}
          {(activeTab === "products" || activeTab === "requests") && (
            <PortalSubNavigation
              title="위스 상점"
              activeLabel={TEACHER_POINT_TAB_LABELS[activeTab]}
              variant="tabs"
            >
              {(["products", "requests"] as const).map((tab) => (
                <Link
                  key={tab}
                  to={`/teacher/points?tab=${tab}`}
                  className={`teacher-settings-menu-item ${activeTab === tab ? "is-active" : ""}`}
                  aria-current={activeTab === tab ? "page" : undefined}
                >
                  {TEACHER_POINT_TAB_LABELS[tab]}
                </Link>
              ))}
            </PortalSubNavigation>
          )}
          {loading && (
            <InlineLoading
              message="위스 정보를 불러오는 중입니다."
              showWarning
            />
          )}

          {!loading &&
            activeTab !== "stocks" &&
            canManage &&
            pendingAdjustment && (
              <div
                role="status"
                className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900"
              >
                <span>
                  {adjustmentFeedback || "완료되지 않은 위스 조정이 있습니다."}
                </span>
                <button
                  type="button"
                  disabled={adjustmentSaving}
                  onClick={() => void resumePendingAdjustment()}
                  className="min-h-11 rounded-lg border border-amber-300 bg-white px-4 font-bold disabled:opacity-50"
                >
                  {adjustmentSaving ? "확인 중..." : "이전 조정 이어서 처리"}
                </button>
              </div>
            )}
          {activeTab === "stocks" && scopeReady && (
            <TeacherWisStocks config={config} canManage={canManage} />
          )}
          {activeTab === "overview" && (
            <PointsOverviewTab
              wallets={loading ? [] : paginatedWallets}
              totalWalletCount={loading ? 0 : sortedWallets.length}
              loading={loading}
              currentPage={currentOverviewPage}
              totalPages={overviewTotalPages}
              sortKey={overviewSortKey}
              sortDirection={overviewSortDirection}
              selectedWallet={loading ? null : selectedWallet}
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
              transactionsLoading={transactionsLoading}
              transactionsError={transactionsError}
              transactionsHasMore={!!transactionCursor}
              onLoadMoreTransactions={() =>
                void loadTransactionsForWallet(selectedUid, true)
              }
              onReloadTransactions={() =>
                loadTransactionsForWallet(selectedUid)
              }
              canManage={canManage}
              selectedEditableTransactionId={selectedEditableTransactionId}
              adjustmentDraftValue={adjustmentDraftValue}
              adjustmentFeedback={adjustmentFeedback}
              adjustmentSaving={adjustmentSaving}
              onGradeFilterChange={(value) => {
                setGradeFilter(value);
                setClassFilter("all");
                setNumberFilter("all");
              }}
              onClassFilterChange={(value) => {
                setClassFilter(value);
                setNumberFilter("all");
              }}
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

          {!loading && activeTab === "grant" && (
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
              currentPage={currentGrantPage}
              hasNextPage={!!grantNextCursor}
              onPageChange={handleGrantPageChange}
              readError={grantReadError}
              onRetry={() => setGrantReadRefresh((value) => value + 1)}
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
              onGradeFilterChange={(value) => {
                setGrantGradeFilter(value);
                setGrantClassFilter("all");
                setGrantNumberFilter("all");
              }}
              onClassFilterChange={(value) => {
                setGrantClassFilter(value);
                setGrantNumberFilter("all");
              }}
              onNumberFilterChange={setGrantNumberFilter}
              onNameSearchChange={setGrantNameSearch}
              onSelectStudent={setGrantSelectedUid}
              onAmountChange={setGrantAmount}
              onReasonChange={setGrantReason}
              onSubmit={handleSaveGrant}
            />
          )}

          {!loading && activeTab !== "stocks" && (
            <div hidden={activeTab !== "policy"}>
              <PointPolicyTab
                config={config}
                active={activeTab === "policy"}
                requestedSectionId={searchParams.get("section")}
                policy={policyDraft}
                canManage={canManage}
                hasUnsavedChanges={policyDirty}
                saveFeedbackMessage=""
                saveFeedbackTone={null}
                onPolicyChange={updatePolicyDraft}
                onSubmit={handleSavePolicy}
              />
            </div>
          )}

          {!loading && activeTab === "ranks" && (
            <PointRanksTab
              savedRankPolicy={savedRankPolicy}
              canManage={canManage}
              themeDraft={rankThemeDraft}
              themeHasUnsavedChanges={rankThemeDirty}
              themeSaveFeedbackMessage=""
              themeSaveFeedbackTone={null}
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

          {activeTab === "hall-of-fame" && !scopeReady && (
            <InlineLoading
              message="명예의 전당을 불러오는 중입니다."
              showWarning
            />
          )}
          {activeTab === "hall-of-fame" && scopeReady && (
            <HallOfFameManagementTab
              key={scopeGenerationRef.current}
              refreshKey={hallRefresh}
              config={config}
              interfaceConfig={interfaceConfig}
              canManage={canManage}
              onInterfaceConfigRefresh={refreshInterfaceConfig}
            />
          )}

          {!loading &&
            shopLoadError &&
            !["stocks", "hall-of-fame"].includes(activeTab) && (
              <div role="alert" className="wis-shop-feedback">
                {shopLoadError}{" "}
                <button
                  className="wis-shop-button"
                  onClick={() => void loadAll()}
                >
                  다시 불러오기
                </button>
              </div>
            )}
          {!loading && activeTab === "products" && (
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
                  product.imageUrl || product.previewImageUrl || "",
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
              productOrderFeedback=""
              onReorderProducts={handleReorderProducts}
              onSaveProductOrder={handleSaveProductOrder}
              onSubmit={handleSaveProductWithUpload}
            />
          )}

          {!loading && activeTab === "requests" && (
            <PointRequestsTab
              orders={filteredOrders}
              allOrders={ordersWithStudentProfiles}
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
              onRefresh={refreshOrders}
            />
          )}
        </TeacherWisVillage>
      </main>
    </div>
  );
};

export default function TeacherPointsRoute() {
  const [params] = useSearchParams();
  // Item editing must not trigger unrelated class wallets, orders or policy reads.
  return isTeacherAvatarShop(params) ? (
    <TeacherAvatarShopPage />
  ) : (
    <ManagePoints />
  );
}
