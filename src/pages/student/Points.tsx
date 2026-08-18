import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppToast } from "../../components/common/AppToastProvider";
import { InlineLoading } from "../../components/common/LoadingState";
import {
  POINT_HISTORY_FILTER_LABELS,
  STUDENT_POINT_TAB_LABELS,
} from "../../constants/pointLabels";
import { useAuth } from "../../contexts/AuthContext";
import { subscribePointsUpdated } from "../../lib/appEvents";
import {
  LegacyWisPresentationError,
  getLegacyStudentPointPolicy,
  getLegacyStudentPointWalletByUid,
  getLegacyStudentRankEarnedPointsByUid,
  getLegacyStudentWisHallOfFameSnapshot,
  listLegacyStudentPointOrders,
  listLegacyStudentPointProducts,
  listLegacyStudentPointTransactionsByUid,
  requestLegacyStudentWisPurchase,
  type LegacyWisQueryContext,
} from "../../lib/legacyWisPresentationAdapter";
import { createStableLegacyMutationActionKey } from "../../lib/legacyWisMutationIntent";
import { POINT_POLICY_FALLBACK } from "../../lib/points";
import {
  getPointRankDisplay,
  needsPointRankLegacyFallback,
} from "../../lib/pointRanks";
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
type HallOfFameLoadStatus = "idle" | "loading" | "ready" | "error";
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
  const { config, currentUser, userData, interfaceConfig } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<StudentPointTab>("overview");
  const [wallet, setWallet] = useState<PointWallet | null>(null);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [products, setProducts] = useState<PointProduct[]>([]);
  const [orders, setOrders] = useState<PointOrder[]>([]);
  const [policy, setPolicy] = useState(POINT_POLICY_FALLBACK);
  const [hallOfFame, setHallOfFame] = useState<WisHallOfFameSnapshot | null>(
    null,
  );
  const [hallOfFameLoadStatus, setHallOfFameLoadStatus] =
    useState<HallOfFameLoadStatus>("idle");
  const [hallOfFameErrorMessage, setHallOfFameErrorMessage] = useState("");
  const [rankManualAdjustPoints, setRankManualAdjustPoints] = useState(0);
  const [loading, setLoading] = useState(true);
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
  const [purchaseMemo, setPurchaseMemo] = useState("");
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [purchaseFeedback, setPurchaseFeedback] = useState("");
  const [purchaseRequestKey, setPurchaseRequestKey] = useState("");
  const { showToast } = useAppToast();
  const historyLoadInFlightRef = useRef(false);
  const ordersLoadInFlightRef = useRef(false);
  const shopLoadInFlightRef = useRef(false);
  const hallOfFameLoadInFlightRef = useRef(false);

  const uid = currentUser?.uid || userData?.uid || "";
  const requestedSemesterId = searchParams.get("semesterId") || "";
  const requestedSource = searchParams.get("source") || "";
  const wisQueryContext = useMemo<LegacyWisQueryContext>(() => {
    const provenance = ["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(
      requestedSource,
    )
      ? (requestedSource as LegacyWisQueryContext["provenance"])
      : undefined;
    return {
      ...(requestedSemesterId ? { semesterId: requestedSemesterId } : {}),
      ...(provenance ? { provenance } : {}),
    };
  }, [requestedSemesterId, requestedSource]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "history") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("tab");
      setSearchParams(nextParams, { replace: true });
      setActiveTab("overview");
      return;
    }
    if (
      requestedTab === "hall-of-fame" ||
      requestedTab === "shop" ||
      requestedTab === "orders"
    ) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab("overview");
  }, [searchParams, setSearchParams]);

  const loadCorePointData = async () => {
    const [loadedWallet, loadedTransactions, loadedPolicy] = await Promise.all([
      getLegacyStudentPointWalletByUid(config, uid, wisQueryContext),
      listLegacyStudentPointTransactionsByUid(
        config,
        uid,
        STUDENT_POINT_TRANSACTION_LIMIT,
        wisQueryContext,
      ),
      getLegacyStudentPointPolicy(config, uid, wisQueryContext),
    ]);
    const loadedRankManualAdjustPoints =
      loadedWallet && needsPointRankLegacyFallback(loadedWallet)
        ? await getLegacyStudentRankEarnedPointsByUid(
            config,
            uid,
            wisQueryContext,
          )
        : 0;

    return {
      loadedWallet,
      loadedTransactions,
      loadedPolicy,
      loadedRankManualAdjustPoints,
    };
  };

  const loadHallOfFameData = async () => {
    if (!uid) {
      setHallOfFame(null);
      setHallOfFameLoadStatus("ready");
      setHallOfFameErrorMessage("");
      return;
    }
    if (hallOfFameLoadInFlightRef.current) return;
    hallOfFameLoadInFlightRef.current = true;
    setHallOfFameLoadStatus("loading");
    setHallOfFameErrorMessage("");
    try {
      setHallOfFame(
        await getLegacyStudentWisHallOfFameSnapshot(
          config,
          uid,
          wisQueryContext,
        ),
      );
      setHallOfFameLoadStatus("ready");
    } catch (error) {
      console.warn("Failed to load W7 wis hall of fame projection:", error);
      setHallOfFame(null);
      setHallOfFameLoadStatus("error");
      setHallOfFameErrorMessage(
        "화랑의 전당을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      hallOfFameLoadInFlightRef.current = false;
    }
  };

  const loadPointData = async ({
    showLoading = true,
    setTransactionsFromCore = true,
  }: CoreLoadOptions = {}) => {
    if (!uid) return;

    if (showLoading) setLoading(true);
    setErrorMessage("");
    try {
      const {
        loadedWallet,
        loadedTransactions,
        loadedPolicy,
        loadedRankManualAdjustPoints,
      } = await loadCorePointData();
      setWallet(loadedWallet);
      if (setTransactionsFromCore) {
        setTransactions(loadedTransactions);
        setHistoryLoaded(true);
        setHistoryErrorMessage("");
      }
      setPolicy(loadedPolicy);
      setRankManualAdjustPoints(loadedRankManualAdjustPoints);
      void loadHallOfFameData();
    } catch (error) {
      console.error("Failed to load student point data:", error);
      setErrorMessage(
        "위스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadHistoryData = async ({
    force = false,
  }: DeferredLoadOptions = {}) => {
    if (!uid || (!force && historyLoaded) || historyLoadInFlightRef.current)
      return;

    historyLoadInFlightRef.current = true;
    setHistoryLoading(true);
    setHistoryErrorMessage("");
    try {
      const loadedTransactions = await listLegacyStudentPointTransactionsByUid(
        config,
        uid,
        STUDENT_POINT_TRANSACTION_LIMIT,
        wisQueryContext,
      );
      setTransactions(loadedTransactions);
      setHistoryLoaded(true);
    } catch (error) {
      console.error("Failed to load student point history:", error);
      setHistoryErrorMessage(
        "위스 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      historyLoadInFlightRef.current = false;
      setHistoryLoading(false);
    }
  };

  const loadOrdersData = async ({
    force = false,
  }: DeferredLoadOptions = {}) => {
    if (!uid || (!force && ordersLoaded) || ordersLoadInFlightRef.current)
      return;

    ordersLoadInFlightRef.current = true;
    setOrdersLoading(true);
    setOrdersErrorMessage("");
    try {
      const loadedOrders = await listLegacyStudentPointOrders(
        config,
        uid,
        { uid, limitCount: 100 },
        wisQueryContext,
      );
      setOrders(loadedOrders);
      setOrdersLoaded(true);
    } catch (error) {
      console.error("Failed to load student point orders:", error);
      setOrdersErrorMessage(
        "구매 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      ordersLoadInFlightRef.current = false;
      setOrdersLoading(false);
    }
  };

  const loadShopData = async ({ force = false }: DeferredLoadOptions = {}) => {
    if (!uid || (!force && shopLoaded) || shopLoadInFlightRef.current) return;

    shopLoadInFlightRef.current = true;
    setShopLoading(true);
    setShopErrorMessage("");
    setHallOfFame(null);
    setHallOfFameLoadStatus("idle");
    setHallOfFameErrorMessage("");
    try {
      const loadedProducts = await listLegacyStudentPointProducts(
        config,
        uid,
        true,
        wisQueryContext,
      );
      setProducts(loadedProducts);
      setShopLoaded(true);
    } catch (error) {
      console.error("Failed to load student point products:", error);
      setShopErrorMessage(
        "상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      shopLoadInFlightRef.current = false;
      setShopLoading(false);
    }
  };

  const refreshLoadedPointData = async () => {
    await loadPointData({
      showLoading: false,
      setTransactionsFromCore: !historyLoaded,
    });
    await Promise.all([
      historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
      ordersLoaded ? loadOrdersData({ force: true }) : Promise.resolve(),
      shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
    ]);
  };

  useEffect(() => {
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
    setPurchaseFeedback("");
    setPurchaseRequestKey("");

    if (!uid) {
      setWallet(null);
      setHallOfFame(null);
      setLoading(false);
      return;
    }
    void loadPointData({ setTransactionsFromCore: true });
  }, [config, uid, wisQueryContext]);

  useEffect(() => {
    if (!uid) return;
    if (activeTab === "orders") {
      void loadOrdersData();
    } else if (activeTab === "shop") {
      void loadShopData();
    } else if (
      activeTab === "hall-of-fame" &&
      hallOfFameLoadStatus === "idle"
    ) {
      void loadHallOfFameData();
    }
  }, [
    activeTab,
    config,
    uid,
    historyLoaded,
    ordersLoaded,
    shopLoaded,
    hallOfFameLoadStatus,
    wisQueryContext,
  ]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribePointsUpdated(() => {
      void refreshLoadedPointData();
    });
  }, [config, uid, historyLoaded, ordersLoaded, shopLoaded, wisQueryContext]);

  const safeWallet = wallet || DEFAULT_WALLET;
  const legacyUserData = (userData || null) as Record<string, unknown> | null;
  const currentHallGrade = normalizeSchoolField(
    userData?.grade || legacyUserData?.studentGrade || safeWallet.grade,
  );
  const currentHallClass = normalizeSchoolField(
    userData?.class || legacyUserData?.studentClass || safeWallet.class,
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
    setPurchaseFeedback("");
    const nextParams = new URLSearchParams();
    if (requestedSemesterId) nextParams.set("semesterId", requestedSemesterId);
    if (requestedSource) nextParams.set("source", requestedSource);
    if (tab !== "overview") nextParams.set("tab", tab);
    setSearchParams(nextParams);
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    setPurchaseFeedback("");
    setPurchaseRequestKey(
      createStableLegacyMutationActionKey("student-wis-purchase", {
        studentUid: uid,
        semesterId:
          requestedSemesterId ||
          `${String(config?.year || "")}-${String(config?.semester || "")}`,
        provenance: wisQueryContext.provenance || "CURRENT",
        productId,
      }),
    );
  };

  const handlePurchaseRequest = async () => {
    if (!selectedProduct || !uid) return;

    setPurchaseSubmitting(true);
    setPurchaseFeedback("");
    try {
      const requestKey =
        purchaseRequestKey ||
        createStableLegacyMutationActionKey("student-wis-purchase", {
          studentUid: uid,
          semesterId:
            requestedSemesterId ||
            `${String(config?.year || "")}-${String(config?.semester || "")}`,
          provenance: wisQueryContext.provenance || "CURRENT",
          productId: selectedProduct.id,
        });
      await requestLegacyStudentWisPurchase({
        config,
        uid,
        productId: selectedProduct.id,
        memo: purchaseMemo,
        requestKey,
        context: wisQueryContext,
      });
      setPurchaseMemo("");
      setSelectedProductId("");
      setPurchaseRequestKey("");
      setPurchaseFeedback("구매 요청이 접수되었습니다.");
      setSearchParams({ tab: "orders" });
      try {
        await Promise.all([
          loadPointData({
            showLoading: false,
            setTransactionsFromCore: !historyLoaded,
          }),
          loadOrdersData({ force: true }),
          shopLoaded ? loadShopData({ force: true }) : Promise.resolve(),
          historyLoaded ? loadHistoryData({ force: true }) : Promise.resolve(),
        ]);
        showToast({
          tone: "success",
          title: "구매 요청이 접수되었습니다.",
          message: `${selectedProduct.name} 요청과 위스 상태가 최신 정보로 반영되었습니다.`,
        });
      } catch (refreshError) {
        console.error(
          "Purchase succeeded, but refreshing Wis state failed:",
          refreshError,
        );
        setPurchaseFeedback(
          "구매 요청이 접수되었습니다. 최신 정보는 잠시 후 다시 확인해 주세요.",
        );
        showToast({
          tone: "warning",
          title: "구매 요청이 접수되었습니다.",
          message:
            "최신 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
        });
      }
    } catch (error: any) {
      console.error("Failed to create point purchase request:", error);
      const normalizedFailureMessage = String(
        error?.message || "",
      ).toLowerCase();
      if (
        normalizedFailureMessage.includes("insufficient point balance") ||
        normalizedFailureMessage.includes("balance is insufficient")
      ) {
        setPurchaseFeedback("보유 위스가 부족합니다.");
        showToast({
          tone: "warning",
          title: "구매 요청을 보낼 수 없습니다.",
          message: "보유 위스가 부족합니다.",
        });
      } else if (
        normalizedFailureMessage.includes("out of stock") ||
        normalizedFailureMessage.includes("inventory is insufficient")
      ) {
        setPurchaseFeedback("재고가 없습니다.");
        showToast({
          tone: "warning",
          title: "구매 요청을 보낼 수 없습니다.",
          message: "선택한 상품의 재고가 없습니다.",
        });
      } else {
        const safeMessage =
          error instanceof LegacyWisPresentationError
            ? error.message
            : "구매 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        setPurchaseFeedback(safeMessage);
        showToast({
          tone: "error",
          title: "구매 요청에 실패했습니다.",
          message: safeMessage,
        });
      }
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const isHallOfFameTab = activeTab === "hall-of-fame";
  const activeTabLoading =
    (activeTab === "orders" && ordersLoading) ||
    (activeTab === "shop" && shopLoading) ||
    (activeTab === "hall-of-fame" && hallOfFameLoadStatus === "loading");
  const activeTabErrorMessage =
    activeTab === "orders"
      ? ordersErrorMessage
      : activeTab === "shop"
        ? shopErrorMessage
        : activeTab === "hall-of-fame"
          ? hallOfFameErrorMessage
          : "";
  const activeTabLoadingMessage =
    activeTab === "orders"
      ? "구매 내역을 불러오는 중입니다."
      : activeTab === "shop"
        ? "상품 목록을 불러오는 중입니다."
        : activeTab === "hall-of-fame"
          ? "화랑의 전당을 불러오는 중입니다."
          : "";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div
        className={`mx-auto w-full flex-1 px-4 py-8 ${
          isHallOfFameTab ? "max-w-7xl" : "max-w-6xl"
        }`}
      >
        <div className="mb-4 overflow-x-auto rounded-t-lg bg-white border-b border-gray-200">
          <div className="flex min-w-max gap-2 px-2">
            {(Object.keys(STUDENT_POINT_TAB_LABELS) as StudentPointTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleTabChange(tab)}
                  className={`border-b-2 px-5 py-4 text-sm font-bold transition whitespace-nowrap ${
                    activeTab === tab
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-600 hover:text-gray-800"
                  }`}
                >
                  {STUDENT_POINT_TAB_LABELS[tab]}
                </button>
              ),
            )}
          </div>
        </div>

        <div
          className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${
            isHallOfFameTab ? "p-4 sm:p-5 xl:p-6" : "p-6"
          }`}
        >
          {loading && (
            <InlineLoading
              message="위스 정보를 불러오는 중입니다."
              showWarning
            />
          )}

          {!loading && !!errorMessage && (
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
                <p>{activeTabErrorMessage}</p>
                {activeTab === "hall-of-fame" && (
                  <button
                    type="button"
                    onClick={() => void loadHallOfFameData()}
                    className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100"
                  >
                    다시 시도
                  </button>
                )}
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

          {!loading &&
            !errorMessage &&
            !activeTabLoading &&
            !activeTabErrorMessage &&
            activeTab === "hall-of-fame" && (
              <StudentPointHallOfFameTab
                snapshot={hallOfFame}
                hallOfFameConfig={interfaceConfig?.hallOfFame}
                currentGrade={currentHallGrade}
                currentClass={currentHallClass}
              />
            )}

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
                purchaseSubmitting={purchaseSubmitting}
                purchaseFeedback={purchaseFeedback}
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
              />
            )}
        </div>
      </div>
    </div>
  );
};

export default Points;
