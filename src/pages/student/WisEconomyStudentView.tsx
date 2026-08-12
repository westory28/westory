import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import { useAuth } from "../../contexts/AuthContext";
import {
  WisEconomyError,
  getWisEconomyState,
  placeWisOrder,
  type WisEconomyState,
  type WisInventory,
} from "../../lib/wisEconomy";
import "../wisEconomy.css";

type StudentTab = "overview" | "shop" | "orders" | "ranking";
const TABS: Array<{ id: StudentTab; label: string }> = [
  { id: "overview", label: "내 위스" },
  { id: "shop", label: "상점" },
  { id: "orders", label: "주문" },
  { id: "ranking", label: "순위" },
];
const currency = (value: number, unit = "위스") =>
  `${new Intl.NumberFormat("ko-KR").format(value)} ${unit}`;

const WisEconomyStudentView: React.FC = () => {
  const { config, configReady } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (
    TABS.some((item) => item.id === params.get("tab"))
      ? params.get("tab")
      : "overview"
  ) as StudentTab;
  const explicitSemesterId = String(params.get("semesterId") || "").trim();
  const requestedSource = String(params.get("source") || "").toUpperCase();
  const [state, setState] = useState<WisEconomyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WisEconomyError | null>(null);
  const [submittingId, setSubmittingId] = useState("");

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      setState(
        await getWisEconomyState({
          config,
          audience: "student",
          ...(explicitSemesterId ? { semesterId: explicitSemesterId } : {}),
          provenance:
            requestedSource === "LEGACY"
              ? "LEGACY"
              : requestedSource === "ARCHIVE"
                ? "ARCHIVE"
                : "CURRENT",
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof WisEconomyError
          ? caught
          : new WisEconomyError("UNKNOWN", "위스 자료를 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady, explicitSemesterId, requestedSource]);

  useEffect(() => {
    void load();
  }, [load]);

  const unit = state?.economy?.currencyName || "위스";
  const myRanking = useMemo(
    () =>
      state?.rankings.find((row) => row.accountId === state.account?.accountId),
    [state],
  );

  const selectTab = (next: StudentTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams);
  };

  const placeOrder = async (inventory: WisInventory) => {
    if (!state?.account || !state.economy || state.readOnly) return;
    setSubmittingId(inventory.inventoryId);
    setError(null);
    try {
      await placeWisOrder({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        expectedEconomyRevision: state.economy.revision,
        inventoryId: inventory.inventoryId,
        expectedInventoryRevision: inventory.revision,
        expectedAccountRevision: state.account.revision,
        quantity: 1,
      });
      await load();
      selectTab("orders");
    } catch (caught) {
      setError(caught as WisEconomyError);
    } finally {
      setSubmittingId("");
    }
  };

  if (loading) return <StatePanel state="LOADING" />;
  if (error && !state) {
    return (
      <StatePanel
        state={
          error.kind === "PERMISSION"
            ? "PERMISSION"
            : error.kind === "SESSION_EXPIRED"
              ? "SESSION_EXPIRED"
              : error.kind === "NETWORK"
                ? "OFFLINE"
                : "ERROR"
        }
        description={error.message}
        action={{ label: "다시 불러오기", onClick: () => void load() }}
        retryable
      />
    );
  }
  if (!state || state.status === "EMPTY") {
    return (
      <StatePanel
        state="EMPTY"
        title="이번 학기 위스가 아직 열리지 않았습니다."
        description="담당 교사가 운영을 시작하면 내 위스와 상점을 확인할 수 있습니다."
      />
    );
  }
  if (state.status === "LEGACY") {
    return (
      <StatePanel
        state="LEGACY"
        description="이전 학기 위스는 원본을 옮기지 않고 읽기 전용 기록으로만 제공합니다."
        readOnly
      />
    );
  }

  return (
    <section className="wis-page" aria-labelledby="wis-student-title">
      <header className="wis-page__header">
        <div>
          <p className="wis-page__eyebrow">내 학기 경제</p>
          <h2 id="wis-student-title">위스</h2>
          <p>
            내 잔액과 사용 내역을 확인하고, 필요한 상품을 신청할 수 있습니다.
          </p>
        </div>
        <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
      </header>

      {error && (
        <StatePanel
          state="ERROR"
          compact
          description={error.message}
          action={{ label: "새로고침", onClick: () => void load() }}
        />
      )}
      {state.readOnly && <StatePanel state="ARCHIVED" compact readOnly />}

      <div className="wis-balance-card">
        <span>사용할 수 있는 위스</span>
        <strong>{currency(state.account?.balance || 0, unit)}</strong>
        <span>
          {myRanking ? `현재 공동 ${myRanking.rank}위` : "순위 집계 전"}
        </span>
      </div>

      <nav className="wis-tabs" aria-label="위스 메뉴">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="wis-stack">
          <h2>최근 내역</h2>
          {state.ledger.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="아직 위스 내역이 없습니다."
            />
          ) : (
            <ul className="wis-ledger-list">
              {state.ledger.map((entry) => (
                <li key={entry.ledgerEntryId}>
                  <div>
                    <strong>{entry.reason || entry.type}</strong>
                    <span>{entry.type}</span>
                  </div>
                  <div
                    className={entry.delta >= 0 ? "is-positive" : "is-negative"}
                  >
                    <strong>
                      {entry.delta >= 0 ? "+" : ""}
                      {currency(entry.delta, unit)}
                    </strong>
                    <span>잔액 {currency(entry.balanceAfter, unit)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "shop" && (
        <div className="wis-product-grid">
          {state.inventory
            .filter((item) => item.active)
            .map((item) => (
              <article key={item.inventoryId} className="wis-product-card">
                <div>
                  <p className="wis-page__eyebrow">재고 {item.available}개</p>
                  <h2>{item.productName}</h2>
                </div>
                <strong>{currency(item.price, unit)}</strong>
                <button
                  type="button"
                  disabled={
                    state.readOnly ||
                    item.available < 1 ||
                    (state.account?.balance || 0) < item.price ||
                    submittingId === item.inventoryId
                  }
                  onClick={() => void placeOrder(item)}
                >
                  {submittingId === item.inventoryId ? "처리 중" : "1개 신청"}
                </button>
              </article>
            ))}
          {state.inventory.filter((item) => item.active).length === 0 && (
            <StatePanel
              state="EMPTY"
              compact
              title="지금 신청할 수 있는 상품이 없습니다."
            />
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="wis-stack">
          <h2>내 주문</h2>
          {state.orders.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="아직 주문한 상품이 없습니다."
            />
          ) : (
            <ul className="wis-order-list">
              {state.orders.map((order) => (
                <li key={order.orderId}>
                  <div>
                    <strong>{order.productName}</strong>
                    <span>
                      {order.quantity}개 · {currency(order.totalPrice, unit)}
                    </span>
                  </div>
                  <span
                    className={`wis-status wis-status--${order.status.toLowerCase()}`}
                  >
                    {order.status === "REQUESTED"
                      ? "확인 대기"
                      : order.status === "APPROVED"
                        ? "승인"
                        : order.status === "FULFILLED"
                          ? "수령 완료"
                          : "반려·환불"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "ranking" && (
        <div className="wis-stack">
          <h2>이번 학기 순위</h2>
          <ol className="wis-ranking-list">
            {state.rankings.map((row) => (
              <li
                key={row.accountId}
                className={
                  row.accountId === state.account?.accountId ? "is-me" : ""
                }
              >
                <span>{row.rank}위</span>
                <strong>{row.displayName}</strong>
                <span>{currency(row.balance, unit)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};

export default WisEconomyStudentView;
