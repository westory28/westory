import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cancelCanonicalPurchase } from "../../lib/pointEconomyAdapter";
import { useAppDialog } from "../../components/common/AppDialogProvider";
import { useAppToast } from "../../components/common/AppToastProvider";
import { InlineLoading } from "../../components/common/LoadingState";
import {
  POINT_HISTORY_FILTER_LABELS,
  STUDENT_POINT_TAB_LABELS,
} from "../../constants/pointLabels";
import { useAuth } from "../../contexts/AuthContext";
import { subscribePointsUpdated } from "../../lib/appEvents";
import {
  createSecurePurchaseRequest,
  getPointPolicy,
  getPointRankManualAdjustEarnedPointsByUid,
  POINT_POLICY_FALLBACK,
} from "../../lib/points";
import {
  getStudentPointWallet as getPointWalletByUid,
  listStudentPointOrders as listPointOrders,
  listStudentPointProducts as listPointProducts,
  listStudentPointTransactions as listPointTransactionsByUid,
  getStudentPointHallOfFame as getWisHallOfFameSnapshot,
} from "../../lib/studentWis";
import {
  getPointRankDisplay,
  needsPointRankLegacyFallback,
} from "../../lib/pointRanks";
import { findWisHallOfFameEntryByUid } from "../../lib/wisHallOfFame";
import type {
  PointOrder,
  PointOrderStatus,
  PointProduct,
  PointTransaction,
  PointWallet,
  WisHallOfFameSnapshot,
} from "../../types";
import StudentPointHallOfFameTab from "./components/points/StudentPointHallOfFameTab";
import StudentPointOrdersTab from "./components/points/StudentPointOrdersTab";
import StudentPointShopTab from "./components/points/StudentPointShopTab";
import StudentPointSummaryTab from "./components/points/StudentPointSummaryTab";

type StudentPointTab = keyof typeof STUDENT_POINT_TAB_LABELS;
type HistoryFilter = keyof typeof POINT_HISTORY_FILTER_LABELS;
type OrderFilter = "all" | PointOrderStatus;
type DeferredLoadOptions = { force?: boolean };
type CoreLoadOptions = {
  showLoading?: boolean;
  setTransactionsFromCore?: boolean;
};

const STUDENT_POINT_TRANSACTION_LIMIT = 100;

const DEFAULT_WALLET: PointWallet = {
  uid: "",
  studentName: "",
  grade: "",
  class: "",
  number: "",
  balance: 0,
  earnedTotal: 0,
  rankEarnedTotal: 0,
  spentTotal: 0,
  adjustedTotal: 0,
  rankSnapshot: null,
  lastTransactionAt: null,
};

const isPurchaseTransaction = (type: PointTransaction["type"]) =>
  type === "purchase_hold" ||
  type === "purchase_confirm" ||
  type === "purchase_cancel";

const getTransactionCategory = (transaction: PointTransaction) => {
  if (transaction.delta > 0) return "earned";
  if (transaction.delta < 0) return "spent";
  return "all";
};

const normalizeSchoolField = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const Points: React.FC = () => {
  const {
    config,
    configReady,
    currentUser,
    authGeneration,
    userData,
    interfaceConfig,
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: StudentPointTab =
    requestedTab === "hall-of-fame" ||
    requestedTab === "shop" ||
    requestedTab === "orders"
      ? requestedTab
      : "overview";
  const [wallet, setWallet] = useState<PointWallet | null>(null);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [products, setProducts] = useState<PointProduct[]>([]);
  const [orders, setOrders] = useState<PointOrder[]>([]);
  const [policy, setPolicy] = useState(POINT_POLICY_FALLBACK);
  const [hallOfFame, setHallOfFame] = useState<WisHallOfFameSnapshot | null>(
    null,
  );
  const [rankManualAdjustPoints, setRankManualAdjustPoints] = useState(0);
  const [coreLoading, setLoading] = useState(true);
  const [coreOwner, setCoreOwner] = useState<object | null>(null);
  const [hallOwner, setHallOwner] = useState<object | null>(null);
  const [hallLoading, setHallLoading] = useState(false);
  const [hallErrorMessage, setHallErrorMessage] = useState("");
  const [hallLoadMs, setHallLoadMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [shopLoading, setShopLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [shopLoaded, setShopLoaded] = useState(false);
  const [historyErrorMessage, setHistoryErrorMessage] = useState("");
  const [ordersErrorMessage, setOrdersErrorMessage] = useState("");
  const [shopErrorMessage, setShopErrorMessage] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [cancellingOrderId, setCancellingOrderId] = useState("");
  const { confirm } = useAppDialog();
  const [purchaseMemo, setPurchaseMemo] = useState("");
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [purchaseRequestKey, setPurchaseRequestKey] = useState("");
  const { showToast } = useAppToast();
  const coreLoadInFlightRef = useRef<object | null>(null);
  const hallLoadInFlightRef = useRef<object | null>(null);
  const historyLoadInFlightRef = useRef<object | null>(null);
  const ordersLoadInFlightRef = useRef<object | null>(null);
  const shopLoadInFlightRef = useRef<object | null>(null);

  const uid = currentUser?.uid || "";
  const scopeReady = Boolean(
    currentUser && configReady && config?.year && config?.semester,
  );
  const requestScope = useMemo(
    () => ({}),
    [currentUser, authGeneration, configReady, config?.year, config?.semester],
  );
  const currentScopeRef = useRef(requestScope);
  currentScopeRef.current = requestScope;
  const isCurrentScope = () => currentScopeRef.current === requestScope;

  useEffect(() => {
    if (requestedTab === "history") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("tab");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadCorePointData = async (includeTransactions: boolean) => {
    const [loadedWallet, loadedTransactions, loadedPolicy] = await Promise.all([
      getPointWalletByUid(config, uid),
      includeTransactions
        ? listPointTransactionsByUid(
            config,
            uid,
            STUDENT_POINT_TRANSACTION_LIMIT,
          )
        : Promise.resolve([]),
      getPointPolicy(config),
    ]);
    const loadedRankManualAdjustPoints =
      isCurrentScope() &&
      loadedWallet &&
      needsPointRankLegacyFallback(loadedWallet)
        ? await getPointRankManualAdjustEarnedPointsByUid(config, uid)
        : 0;

    return {
      loadedWallet,
      loadedTransactions,
      loadedPolicy,
      loadedRankManualAdjustPoints,
    };
  };

  const loadHallOfFameData = async () => {
    if (
      !scopeReady ||
      !isCurrentScope() ||
      hallLoadInFlightRef.current === requestScope
    )
      return;
    hallLoadInFlightRef.current = requestScope;
    setHallLoading(true);
    setHallErrorMessage("");
    setHallLoadMs(null);
    const started = performance.now();
    try {
      const snapshot = await getWisHallOfFameSnapshot(config);
      if (!isCurrentScope()) return;
      setHallOfFame(snapshot);
      setHallLoadMs(Math.round(performance.now() - started));
    } catch (error) {
      console.warn("Failed to load wis hall of fame snapshot:", error);
      if (isCurrentScope()) {
        setHallOfFame(null);
        setHallErrorMessage(
          "명예의 전당을 불러오지 못했습니다. 다시 시도해 주세요.",
        );
      }
    } finally {
      if (hallLoadInFlightRef.current === requestScope)
        hallLoadInFlightRef.current = null;
      if (isCurrentScope()) {
        setHallOwner(requestScope);
        setHallLoading(false);
      }
    }
  };

  const loadPointData = async ({
    showLoading = true,
    setTransactionsFromCore = true,
  }: CoreLoadOptions = {}) => {
    if (
      !scopeReady ||
      !isCurrentScope() ||
      coreLoadInFlightRef.current === requestScope
    )
      return;

    coreLoadInFlightRef.current = requestScope;
    if (showLoading) setLoading(true);
    setErrorMessage("");
    try {
      const {
        loadedWallet,
        loadedTransactions,
        loadedPolicy,
        loadedRankManualAdjustPoints,
      } = await loadCorePointData(setTransactionsFromCore);
      if (!isCurrentScope()) return;
      setWallet(loadedWallet);
      if (setTransactionsFromCore) {
        setTransactions(loadedTransactions);
        setHistoryLoaded(true);
        setHistoryErrorMessage("");
      }
      setPolicy(loadedPolicy);
      setRankManualAdjustPoints(loadedRankManualAdjustPoints);
    } catch (error) {
      console.error("Failed to load student point data:", error);
      if (isCurrentScope())
        setErrorMessage(
          "위스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
    } finally {
      if (coreLoadInFlightRef.current === requestScope)
        coreLoadInFlightRef.current = null;
      if (isCurrentScope()) {
        setCoreOwner(requestScope);
        if (showLoading) setLoading(false);
      }
    }
  };

  const loadHistoryData = async ({
    force = false,
  }: DeferredLoadOptions = {}) => {
    if (
      !scopeReady ||
      !isCurrentScope() ||
      (!force && historyLoaded) ||
      historyLoadInFlightRef.current === requestScope
    )
      return;

    historyLoadInFlightRef.current = requestScope;
    setHistoryLoading(true);
    setHistoryErrorMessage("");
    try {
      const loadedTransactions = await listPointTransactionsByUid(
        config,
        uid,
        STUDENT_POINT_TRANSACTION_LIMIT,
      );
      if (!isCurrentScope()) return;
      setTransactions(loadedTransactions);
      setHistoryLoaded(true);
    } catch (error) {
      console.error("Failed to load student point history:", error);
      if (isCurrentScope())
        setHistoryErrorMessage(
          "위스 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
    } finally {
      if (historyLoadInFlightRef.current === requestScope)
        historyLoadInFlightRef.current = null;
      if (isCurrentScope()) setHistoryLoading(false);
    }
  };

  const loadOrdersData = async ({
    force = false,
  }: DeferredLoadOptions = {}) => {
    if (
      !scopeReady ||
      !isCurrentScope() ||
      (!force && ordersLoaded) ||
      ordersLoadInFlightRef.current === requestScope
    )
      return;

    ordersLoadInFlightRef.current = requestScope;
    setOrdersLoading(true);
    setOrdersErrorMessage("");
    try {
      const loadedOrders = await listPointOrders(config, {
        uid,
        limitCount: 100,
      });
      if (!isCurrentScope()) return;
      setOrders(loadedOrders);
      setOrdersLoaded(true);
    } catch (error) {
      console.error("Failed to load student point orders:", error);
      if (isCurrentScope())
        setOrdersErrorMessage(
          "구매 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
    } finally {
      if (ordersLoadInFlightRef.current === requestScope)
        ordersLoadInFlightRef.current = null;
      if (isCurrentScope()) setOrdersLoading(false);
    }
  };

  const loadShopData = async ({ force = false }: DeferredLoadOptions = {}) => {
    if (
      !scopeReady ||
      !isCurrentScope() ||
      (!force && shopLoaded) ||
      shopLoadInFlightRef.current === requestScope
    )
      return;

    shopLoadInFlightRef.current = requestScope;
    setShopLoading(true);
    setShopErrorMessage("");
    try {
      const loadedProducts = await listPointProducts(config, true);
      if (!isCurrentScope()) return;
      setProducts(loadedProducts);
      setShopLoaded(true);
    } catch (error) {
      console.error("Failed to load student point products:", error);
      if (isCurrentScope())
        setShopErrorMessage(
          "상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
    } finally {
      if (shopLoadInFlightRef.current === requestScope)
        shopLoadInFlightRef.current = null;
      if (isCurrentScope()) setShopLoading(false);
    }
  };

  const refreshLoadedPointData = async () => {
    await loadPointData({
      showLoading: false,
      setTransactionsFromCore: !historyLoaded,
    });
    if (!isCurrentScope()) return;
    await Promise.all([
      historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
      ordersLoaded ? loadOrdersData({ force: true }) : Promise.resolve(),
      shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
    ]);
  };

  useEffect(() => {
    setWallet(null);
    setPolicy(POINT_POLICY_FALLBACK);
    setRankManualAdjustPoints(0);
    setHallOfFame(null);
    setCoreOwner(null);
    setHallOwner(null);
    setHallErrorMessage("");
    setHallLoadMs(null);
    setErrorMessage("");
    setHistoryLoading(false);
    setOrdersLoading(false);
    setShopLoading(false);
    setTransactions([]);
    setProducts([]);
    setOrders([]);
    setHistoryLoaded(false);
    setOrdersLoaded(false);
    setShopLoaded(false);
    setHistoryErrorMessage("");
    setOrdersErrorMessage("");
    setShopErrorMessage("");
    setSelectedProductId("");
    setPurchaseMemo("");
    setPurchaseRequestKey("");
    setPurchaseQuantity(1);
    setCancellingOrderId("");

    setLoading(false);
  }, [requestScope]);

  useEffect(() => {
    if (!scopeReady) return;
    if (activeTab === "hall-of-fame") {
      void loadHallOfFameData();
      return;
    }
    if (coreOwner !== requestScope)
      void loadPointData({ setTransactionsFromCore: true });
    if (activeTab === "orders") {
      void loadOrdersData({ force: true });
    } else if (activeTab === "shop") {
      void loadShopData({ force: true });
    }
  }, [activeTab, requestScope]);

  useEffect(() => {
    if (!scopeReady) return undefined;
    return subscribePointsUpdated(() => {
      if (activeTab === "hall-of-fame") void loadHallOfFameData();
      else void refreshLoadedPointData();
    });
  }, [requestScope, activeTab, historyLoaded, ordersLoaded, shopLoaded]);

  const safeWallet = wallet || DEFAULT_WALLET;
  const legacyUserData = (userData || null) as Record<string, unknown> | null;
  const currentHallOfFameEntry = useMemo(
    () =>
      currentUser?.uid
        ? findWisHallOfFameEntryByUid(hallOfFame, currentUser.uid)
        : null,
    [currentUser?.uid, hallOfFame],
  );
  const canonicalHallGradeKeys = Object.keys(
    hallOfFame?.gradeLeaderboardByGrade || {},
  );
  const canonicalHallClassKeys = Object.keys(
    hallOfFame?.classLeaderboardByClassKey || {},
  );
  const canonicalHallClassParts =
    canonicalHallClassKeys.length === 1
      ? canonicalHallClassKeys[0].split("-")
      : [];
  const [canonicalClassGrade, canonicalClass] =
    canonicalHallClassParts.length === 2 ? canonicalHallClassParts : [];
  const currentHallGrade = normalizeSchoolField(
    canonicalClassGrade ||
      (canonicalHallGradeKeys.length === 1 ? canonicalHallGradeKeys[0] : "") ||
      userData?.grade ||
      legacyUserData?.studentGrade ||
      safeWallet.grade ||
      currentHallOfFameEntry?.grade,
  );
  const currentHallClass = normalizeSchoolField(
    canonicalClass ||
      userData?.class ||
      legacyUserData?.studentClass ||
      safeWallet.class ||
      currentHallOfFameEntry?.class,
  );
  const rank = getPointRankDisplay({
    rankPolicy: policy.rankPolicy,
    wallet: safeWallet,
    earnedPointsFromTransactions: rankManualAdjustPoints,
  });
  const selectedProduct =
    products.find((item) => item.id === selectedProductId) || null;

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        const typeKey = transaction.activityType || transaction.type;
        if (historyFilter === "all") return true;
        if (historyFilter === "earned")
          return getTransactionCategory(transaction) === "earned";
        if (historyFilter === "spent")
          return getTransactionCategory(transaction) === "spent";
        if (historyFilter === "purchase")
          return isPurchaseTransaction(transaction.type);
        return transaction.type === historyFilter || typeKey === historyFilter;
      }),
    [historyFilter, transactions],
  );

  const filteredOrders = useMemo(
    () =>
      orderFilter === "all"
        ? orders
        : orders.filter((order) => order.status === orderFilter),
    [orderFilter, orders],
  );

  const handleTabChange = (tab: StudentPointTab) => {
    setSearchParams(tab === "overview" ? {} : { tab });
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    setPurchaseQuantity(1);
    setPurchaseMemo("");
    setPurchaseRequestKey(
      `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    );
  };

  const handlePurchaseRequest = async () => {
    if (!selectedProduct || !uid || purchaseSubmitting) return;

    setPurchaseSubmitting(true);
    try {
      const requestKey =
        purchaseRequestKey ||
        `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setPurchaseRequestKey(requestKey);
      await createSecurePurchaseRequest({
        config,
        productId: selectedProduct.id,
        expectedPrice: selectedProduct.price,
        quantity: purchaseQuantity,
        memo: purchaseMemo,
        requestKey,
      });
      await Promise.all([
        loadPointData({
          showLoading: false,
          setTransactionsFromCore: !historyLoaded,
        }),
        loadOrdersData({ force: true }),
        shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
        historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
      ]);
      setPurchaseMemo("");
      setSelectedProductId("");
      setPurchaseRequestKey("");
      showToast({
        tone: "success",
        title: "주문이 접수되었습니다.",
        message: `${selectedProduct.name} 요청과 위스 상태가 최신 정보로 반영되었습니다.`,
      });
      setSearchParams({ tab: "orders" });
    } catch (error: any) {
      console.error("Failed to create point purchase request:", error);
      if (error?.message?.includes("Insufficient point balance")) {
        showToast({
          tone: "warning",
          title: "구매 요청을 보낼 수 없습니다.",
          message: "보유 위스가 부족합니다.",
        });
      } else if (error?.message?.includes("out of stock")) {
        showToast({
          tone: "warning",
          title: "구매 요청을 보낼 수 없습니다.",
          message: "선택한 상품의 재고가 없습니다.",
        });
      } else {
        showToast({
          tone: "error",
          title: "구매 요청에 실패했습니다.",
          message:
            error?.message || "주문을 처리하지 못했습니다. 다시 시도해 주세요.",
        });
      }
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const handleCancelOrder = async (order: PointOrder) => {
    if (cancellingOrderId) return;
    if (
      !(await confirm({
        title: "주문을 취소할까요?",
        message:
          order.productName +
          " 주문을 취소하면 " +
          order.priceSnapshot.toLocaleString() +
          " 위스를 돌려받습니다.",
        confirmLabel: "취소하고 환불받기",
        tone: "warning",
      }))
    )
      return;
    setCancellingOrderId(order.id);
    try {
      await cancelCanonicalPurchase(config, order.id);
      showToast({
        tone: "success",
        title: "주문 취소 완료",
        message: "주문을 취소하고 위스를 돌려받았습니다.",
      });
      await Promise.all([
        loadOrdersData({ force: true }),
        loadShopData({ force: true }),
        loadPointData({
          showLoading: false,
          setTransactionsFromCore: !historyLoaded,
        }),
        historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
      ]);
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "주문 취소 실패",
        message:
          error?.message || "주문을 취소하지 못했습니다. 다시 시도해 주세요.",
      });
    } finally {
      setCancellingOrderId("");
    }
  };

  const isHallOfFameTab = activeTab === "hall-of-fame";
  const loading = coreLoading || coreOwner !== requestScope;
  const activeTabLoading =
    (activeTab === "orders" && ordersLoading) ||
    (activeTab === "shop" && shopLoading);
  const activeTabErrorMessage =
    activeTab === "orders"
      ? ordersErrorMessage
      : activeTab === "shop"
        ? shopErrorMessage
        : "";
  const activeTabLoadingMessage =
    activeTab === "orders"
      ? "구매 내역을 불러오는 중입니다."
      : activeTab === "shop"
        ? "상품 목록을 불러오는 중입니다."
        : "";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main
        data-hall-load-ms={
          isHallOfFameTab && hallOwner === requestScope
            ? (hallLoadMs ?? undefined)
            : undefined
        }
        className={`ws-page flex-1 ${
          isHallOfFameTab ? "" : "ws-page--reading"
        }`}
      >
        <header className="ws-page-header mb-4">
          <h1>위스</h1>
        </header>
        <div className="mb-6 overflow-x-auto">
          <nav className="ws-page-tabs" aria-label="위스 메뉴">
            {(Object.keys(STUDENT_POINT_TAB_LABELS) as StudentPointTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleTabChange(tab)}
                  aria-current={activeTab === tab ? "page" : undefined}
                >
                  {STUDENT_POINT_TAB_LABELS[tab]}
                </button>
              ),
            )}
          </nav>
        </div>

        <div className="min-w-0">
          {!isHallOfFameTab && loading && (
            <InlineLoading
              message="위스 정보를 불러오는 중입니다."
              showWarning
            />
          )}

          {!isHallOfFameTab && !loading && !!errorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
              {errorMessage}
            </div>
          )}

          {!loading && !errorMessage && activeTabLoading && (
            <InlineLoading message={activeTabLoadingMessage} showWarning />
          )}

          {!loading &&
            !errorMessage &&
            !activeTabLoading &&
            !!activeTabErrorMessage && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                {activeTabErrorMessage}
              </div>
            )}

          {!loading &&
            !errorMessage &&
            !activeTabLoading &&
            !activeTabErrorMessage &&
            activeTab === "overview" && (
              <StudentPointSummaryTab
                wallet={safeWallet}
                rank={rank}
                historyFilter={historyFilter}
                transactions={filteredTransactions}
                historyLoading={historyLoading}
                historyErrorMessage={historyErrorMessage}
                onHistoryFilterChange={setHistoryFilter}
              />
            )}

          {isHallOfFameTab &&
            (!scopeReady || hallLoading || hallOwner !== requestScope ? (
              <InlineLoading
                message="명예의 전당을 불러오는 중입니다."
                showWarning
              />
            ) : hallErrorMessage ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700"
              >
                {hallErrorMessage}{" "}
                <button
                  type="button"
                  className="min-h-11 underline"
                  onClick={() => void loadHallOfFameData()}
                >
                  다시 불러오기
                </button>
              </div>
            ) : (
              <StudentPointHallOfFameTab
                key={`${uid}:${authGeneration}:${config?.year}:${config?.semester}`}
                snapshot={hallOfFame}
                hallOfFameConfig={interfaceConfig?.hallOfFame}
                currentGrade={currentHallGrade}
                currentClass={currentHallClass}
              />
            ))}

          {!loading &&
            !errorMessage &&
            !activeTabLoading &&
            !activeTabErrorMessage &&
            activeTab === "shop" && (
              <StudentPointShopTab
                wallet={safeWallet}
                products={products}
                selectedProduct={selectedProduct}
                purchaseMemo={purchaseMemo}
                purchaseQuantity={purchaseQuantity}
                onPurchaseQuantityChange={setPurchaseQuantity}
                purchaseSubmitting={purchaseSubmitting}
                purchaseFeedback=""
                onSelectProduct={handleSelectProduct}
                onPurchaseMemoChange={setPurchaseMemo}
                onCloseRequest={() => {
                  setSelectedProductId("");
                  setPurchaseMemo("");
                  setPurchaseRequestKey("");
                }}
                onSubmitPurchaseRequest={() => void handlePurchaseRequest()}
                onOpenOrders={() => handleTabChange("orders")}
              />
            )}

          {!loading &&
            !errorMessage &&
            !activeTabLoading &&
            !activeTabErrorMessage &&
            activeTab === "orders" && (
              <StudentPointOrdersTab
                orderFilter={orderFilter}
                orders={filteredOrders}
                onOrderFilterChange={setOrderFilter}
                onCancelOrder={(order) => void handleCancelOrder(order)}
                cancellingOrderId={cancellingOrderId}
                feedback=""
                onOpenShop={() => handleTabChange("shop")}
                onRefresh={() => void loadOrdersData({ force: true })}
              />
            )}
        </div>
      </main>
    </div>
  );
};

export default Points;
