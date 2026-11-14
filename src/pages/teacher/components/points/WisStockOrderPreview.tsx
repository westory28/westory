import { useEffect, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "../../../../components/common/InfoHelp";
import type {
  WisStock,
  WisStockMarketRules,
} from "../../../../lib/wisStocksClient";
import type { WisStockQuotePortfolio } from "../../../../../functions/wisStockMarketRules.mjs";
import {
  getWisStockFundingLimits,
  planWisStockTransfer,
} from "../../../../../functions/wisStockAccount.mjs";
import {
  acceptWisStockOrder,
  cancelWisStockOrder,
  finalizeWisStockOrder,
  EMPTY_WIS_STOCK_RESERVATIONS,
  type WisStockReservations,
  type WisStockReservedOrder,
  type WisStockOrderTransition,
} from "../../../../../functions/wisStockOrderLifecycle.mjs";

const EXAMPLE_START = Date.UTC(2026, 10, 16, 1);
const DAY_MS = 86_400_000;
const ACCOUNT_ID = "preview-wallet";
const money = (value: number) => value.toLocaleString("ko-KR");
type Position = {
  quantity: number;
  principal: number;
  costBasis: number;
  issuedShares: number;
  availableShares: number;
  reservedBuyQuantity: number;
  reservations: WisStockReservations;
};
type Demo = {
  mainCash: number;
  mainEarned: number;
  stockCash: number;
  lastDepositAtMs: number;
  outstandingPrincipal: number;
  positions: Record<string, Position>;
  dayKey: string;
  dailyBuyAmount: number;
  dailyOrderCount: number;
  lastOrderAtMs: number;
  cumulativeRealizedPnl: number;
  profitHighWatermark: number;
  order: WisStockReservedOrder | null;
};
const blankPosition = (stock: WisStock): Position => ({
  quantity: 0,
  principal: 0,
  costBasis: 0,
  issuedShares: stock.settings.issuedShares,
  availableShares: stock.settings.issuedShares,
  reservedBuyQuantity: 0,
  reservations: { ...EMPTY_WIS_STOCK_RESERVATIONS },
});
const fundingSnapshot = (state: Demo) => ({
  mainCash: state.mainCash,
  stockCash: state.stockCash,
  lastDepositAtMs: state.lastDepositAtMs,
  outstandingPrincipal: state.outstandingPrincipal,
  reservedCash: Object.values(state.positions).reduce(
    (sum, position) => sum + position.reservations.cash,
    0,
  ),
});

export default function WisStockOrderPreview({
  stock,
  stocks,
  rules,
  revision,
  semesterId,
  onPendingChange,
}: {
  stock: WisStock;
  stocks: WisStock[];
  rules: WisStockMarketRules;
  revision: number;
  semesterId: string;
  onPendingChange: (pending: boolean) => void;
}) {
  const startedAt = useRef(performance.now());
  const now = () =>
    EXAMPLE_START + Math.floor(performance.now() - startedAt.current);
  const [demo, setDemo] = useState<Demo>(() => ({
    mainCash: 10000,
    mainEarned: 10000,
    stockCash: 0,
    lastDepositAtMs: 0,
    outstandingPrincipal: 0,
    positions: Object.fromEntries(
      stocks.map((item) => [item.id, blankPosition(item)]),
    ),
    dayKey: "2026-11-16",
    dailyBuyAmount: 0,
    dailyOrderCount: 0,
    lastOrderAtMs: 0,
    cumulativeRealizedPnl: 0,
    profitHighWatermark: 0,
    order: null,
  }));
  const current = useRef(demo);
  const latest = useRef({ stocks, rules, stock, semesterId });
  latest.current = { stocks, rules, stock, semesterId };
  const commit = (next: Demo) => {
    current.current = next;
    setDemo(next);
  };
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [transferDirection, setTransferDirection] = useState<
    "DEPOSIT" | "WITHDRAW"
  >("DEPOSIT");
  const [transferAmount, setTransferAmount] = useState("5000");
  const transferVersion = useRef(0),
    appliedTransferVersion = useRef(-1);
  const [transferNotice, setTransferNotice] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(now);
  const root = useRef<HTMLDivElement>(null);
  const pending = demo.order?.status === "PENDING" ? demo.order : null;
  const pendingId = pending?.id || "";
  const position = demo.positions[stock.id] || blankPosition(stock);
  const snapshot = fundingSnapshot(demo),
    limits = getWisStockFundingLimits(snapshot, now());
  const portfolio = (state: Demo, id: string): WisStockQuotePortfolio => {
    const selected = state.positions[id];
    return {
      cashBalance: state.stockCash,
      holdingQuantity: selected.quantity,
      holdingPrincipal: selected.principal,
      holdingCostBasis: selected.costBasis,
      portfolioValue:
        state.stockCash +
        Object.entries(state.positions).reduce(
          (sum, [stockId, value]) =>
            sum +
            value.quantity *
              (latest.current.stocks.find((item) => item.id === stockId)
                ?.price || 0),
          0,
        ),
      dayKey: state.dayKey,
      dailyBuyAmount: state.dailyBuyAmount,
      dailyOrderCount: state.dailyOrderCount,
      lastOrderAtMs: state.lastOrderAtMs,
      cumulativeRealizedPnl: state.cumulativeRealizedPnl,
      profitHighWatermark: state.profitHighWatermark,
    };
  };
  const apply = (transition: WisStockOrderTransition) => {
    if (!transition.changed) return;
    const state = current.current,
      e = transition.effects,
      id = transition.order.stockId;
    const p = state.positions[id],
      r = p.reservations;
    commit({
      ...state,
      stockCash: state.stockCash + e.stockCashDelta,
      positions: {
        ...state.positions,
        [id]: {
          ...p,
          quantity: p.quantity + e.holdingQuantityDelta,
          principal: p.principal + e.holdingPrincipalDelta,
          costBasis: p.costBasis + e.holdingCostBasisDelta,
          availableShares: p.availableShares + e.availableSharesDelta,
          reservedBuyQuantity:
            p.reservedBuyQuantity + e.marketReservedBuyQuantityDelta,
          reservations: {
            cash: r.cash + e.reservedCashDelta,
            buyQuantity: r.buyQuantity + e.reservedBuyQuantityDelta,
            buyFees: r.buyFees + e.reservedBuyFeesDelta,
            sellQuantity: r.sellQuantity + e.reservedSellQuantityDelta,
            sellPrincipal: r.sellPrincipal + e.reservedSellPrincipalDelta,
            sellCostBasis: r.sellCostBasis + e.reservedSellCostBasisDelta,
          },
        },
      },
      dayKey: e.counterDayKey || state.dayKey,
      dailyBuyAmount: state.dailyBuyAmount + e.dailyBuyAmountDelta,
      dailyOrderCount: state.dailyOrderCount + e.dailyOrderCountDelta,
      lastOrderAtMs: e.lastOrderAtMs ?? state.lastOrderAtMs,
      cumulativeRealizedPnl:
        state.cumulativeRealizedPnl + e.cumulativeRealizedPnlDelta,
      profitHighWatermark:
        state.profitHighWatermark + e.profitHighWatermarkDelta,
      order: transition.order,
    });
  };
  const context = (state: Demo, order: WisStockReservedOrder) => {
    const p = state.positions[order.stockId];
    return {
      order,
      accountId: ACCOUNT_ID,
      semesterId: latest.current.semesterId,
      nowMs: now(),
      portfolio: portfolio(state, order.stockId),
      reservations: p.reservations,
      supply: {
        issuedShares: p.issuedShares,
        availableShares: p.availableShares,
        reservedBuyQuantity: p.reservedBuyQuantity,
      },
    };
  };
  const finish = () => {
    const state = current.current,
      order = state.order;
    if (!order || order.status !== "PENDING") return;
    const instrument = latest.current.stocks.find(
      (item) => item.id === order.stockId,
    );
    try {
      apply(
        finalizeWisStockOrder({
          ...context(state, order),
          execution: {
            serviceAllowed: true,
            authorized: true,
            scopeActive: Boolean(instrument),
            marketHalted: latest.current.rules.halted,
            haltedUntilMs: instrument?.haltedUntilMs || 0,
            tradingStatus: instrument?.settings.tradingStatus || "HALTED",
          },
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  useEffect(() => {
    onPendingChange(Boolean(pendingId));
    if (!pendingId) return;
    const dueAt = current.current.order!.dueAtMs;
    setTick(now());
    const displayTimer = window.setInterval(() => setTick(now()), 1000);
    const dueTimer = window.setTimeout(finish, Math.max(0, dueAt - now()) + 1);
    return () => {
      window.clearInterval(displayTimer);
      window.clearTimeout(dueTimer);
    };
    // One due callback and one display clock per accepted order. Both close
    // with this synthetic preview; neither performs a server request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, onPendingChange]);
  useEffect(() => {
    if (!demo.lastDepositAtMs) return;
    const delay = demo.lastDepositAtMs + DAY_MS - now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setTick(now()), delay + 1);
    return () => window.clearTimeout(timer);
    // A single cooldown deadline update, never a periodic account query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.lastDepositAtMs]);
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((ctx) => {
      if (ctx && !ctx.matches.reduceMotion)
        animate(".wis-stock-order__notice", {
          opacity: [0.4, 1],
          y: [4, 0],
          duration: 220,
          ease: "out(3)",
        });
    });
    return () => scope.revert();
  }, [demo.order?.id, demo.order?.status]);
  const transfer = (event: React.FormEvent) => {
    event.preventDefault();
    if (appliedTransferVersion.current === transferVersion.current) return;
    setError("");
    setTransferNotice("");
    try {
      const state = current.current;
      const result = planWisStockTransfer({
        transferId: crypto.randomUUID(),
        accountId: ACCOUNT_ID,
        semesterId,
        direction: transferDirection,
        amount: Number(transferAmount),
        nowMs: now(),
        snapshot: fundingSnapshot(state),
      });
      if (result.changed) {
        appliedTransferVersion.current = transferVersion.current;
        commit({
          ...state,
          mainCash: state.mainCash + result.effects.mainCashDelta,
          mainEarned: state.mainEarned + result.effects.earnedDelta,
          stockCash: state.stockCash + result.effects.stockCashDelta,
          lastDepositAtMs:
            result.effects.lastDepositAtMs ?? state.lastDepositAtMs,
          outstandingPrincipal:
            state.outstandingPrincipal +
            result.effects.outstandingPrincipalDelta,
        });
        setTransferNotice(
          `예시 ${transferDirection === "DEPOSIT" ? "입금" : "출금"} ${money(Number(transferAmount))} 위스를 반영했습니다.`,
        );
        setTransferAmount("");
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const accept = (event: React.FormEvent) => {
    event.preventDefault();
    if (current.current.order?.status === "PENDING") return;
    setError("");
    setTransferNotice("");
    try {
      if (!current.current.positions[stock.id])
        commit({
          ...current.current,
          positions: {
            ...current.current.positions,
            [stock.id]: blankPosition(stock),
          },
        });
      const state = current.current,
        p = state.positions[stock.id],
        atMs = now();
      const { issuedShares, lotSize, tradingStatus } = stock.settings;
      apply(
        acceptWisStockOrder({
          orderId: crypto.randomUUID(),
          accountId: ACCOUNT_ID,
          semesterId,
          delaySeconds: 5 + Math.floor(Math.random() * 56),
          reservations: p.reservations,
          supplyReservedBuyQuantity: p.reservedBuyQuantity,
          quoteInput: {
            rules,
            marketRevision: revision,
            side,
            quantity: Number(quantity),
            nowMs: atMs,
            stock: {
              id: stock.id,
              price: stock.price,
              availableShares: p.availableShares,
              settings: { issuedShares, lotSize, tradingStatus },
              haltedUntilMs: stock.haltedUntilMs || 0,
            },
            quote: {
              stockId: stock.id,
              price: stock.price,
              atMs,
              marketRevision: revision,
            },
            portfolio: portfolio(state, stock.id),
          },
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const cancel = () => {
    const state = current.current,
      order = state.order;
    if (!order || order.status !== "PENDING") return;
    try {
      apply(cancelWisStockOrder(context(state, order)));
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const profit = stock.price * position.quantity - position.costBasis;
  return (
    <div className="wis-stock-order" ref={root}>
      <div className="wis-stock-preview__investment">
        <div>
          <h3>내 투자 예시</h3>
          <strong>
            {money(stock.price * position.quantity)} <small>위스</small>
          </strong>
          <p
            className={`is-${profit > 0 ? "up" : profit < 0 ? "down" : "flat"}`}
          >
            {profit > 0 ? "+" : ""}
            {money(profit)} 위스
          </p>
        </div>
        <dl>
          <div>
            <dt>보유 수량</dt>
            <dd>{position.quantity}주</dd>
          </div>
          <div>
            <dt>평균 매수가</dt>
            <dd>
              {position.quantity
                ? money(Math.round(position.principal / position.quantity)) +
                  " 위스"
                : "—"}
            </dd>
          </div>
          <div>
            <dt>매도 가능</dt>
            <dd>{position.quantity - position.reservations.sellQuantity}주</dd>
          </div>
        </dl>
      </div>
      <section className="wis-stock-order__account" aria-label="예시 주식 계좌">
        <div className="wis-stock-preview__heading">
          <h3>주식 계좌 예시</h3>
          <InfoHelp label="주식 계좌와 입금 한도">
            <p>
              일반 위스 10,000, 주식 계좌 0으로 시작하는 체험입니다. 한 번에
              일반 지갑 현재 위스의 50%까지 입금할 수 있고, 입금 성공 후 24시간
              동안 추가 입금은 제한됩니다. 출금하거나 매매해도 이 대기 시간은
              초기화되지 않습니다. 주식 매매는 주식 계좌 안에서 처리하며 일반
              누적 위스를 늘리지 않습니다. 출금액은 일반 현재 위스로 돌아가고,
              누적 위스에는 원금을 먼저 회수한 뒤 출금한 수익만 더합니다. 예약된
              위스는 출금할 수 없습니다. 탭을 나가면 예시 계좌가 초기화됩니다.
            </p>
          </InfoHelp>
        </div>
        <dl className="wis-stock-order__balances">
          <div>
            <dt>일반 위스</dt>
            <dd data-testid="demo-main-cash">{money(demo.mainCash)} 위스</dd>
          </div>
          <div>
            <dt>일반 누적 위스</dt>
            <dd data-testid="demo-main-earned">
              {money(demo.mainEarned)} 위스
            </dd>
          </div>
          <div>
            <dt>주식 계좌</dt>
            <dd data-testid="demo-stock-cash">{money(demo.stockCash)} 위스</dd>
          </div>
          <div>
            <dt>예약 위스</dt>
            <dd data-testid="demo-reserved-cash">
              {money(snapshot.reservedCash)} 위스
            </dd>
          </div>
          <div>
            <dt>입금 가능</dt>
            <dd data-testid="demo-deposit-limit">
              {money(limits.maximumDeposit)} 위스
            </dd>
          </div>
          <div>
            <dt>출금 가능</dt>
            <dd data-testid="demo-withdrawal-limit">
              {money(limits.maximumWithdrawal)} 위스
            </dd>
          </div>
        </dl>
        {limits.remainingCooldownMs > 0 && (
          <p
            className="wis-stock-preview__available"
            data-testid="demo-next-deposit"
          >
            다음 입금 가능 ·{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Seoul",
            }).format(limits.nextDepositAtMs)}
          </p>
        )}
        <form className="wis-stock-order__transfer" onSubmit={transfer}>
          <label>
            이체 방향
            <select
              aria-label="이체 방향"
              value={transferDirection}
              onChange={(event) => {
                setTransferDirection(
                  event.target.value as "DEPOSIT" | "WITHDRAW",
                );
                transferVersion.current++;
                setTransferNotice("");
              }}
            >
              <option value="DEPOSIT">주식 계좌로 입금</option>
              <option value="WITHDRAW">일반 위스로 출금</option>
            </select>
          </label>
          <label>
            이체 금액 (위스)
            <input
              type="number"
              min="1"
              step="1"
              required
              value={transferAmount}
              onChange={(event) => {
                setTransferAmount(event.target.value);
                transferVersion.current++;
                setTransferNotice("");
              }}
            />
          </label>
          <button
            type="submit"
            disabled={
              !transferAmount ||
              (transferDirection === "DEPOSIT" && limits.maximumDeposit === 0)
            }
          >
            예시 {transferDirection === "DEPOSIT" ? "입금" : "출금"}
          </button>
        </form>
        {transferNotice && (
          <p className="wis-stock-order__transfer-result" role="status">
            {transferNotice}
          </p>
        )}
      </section>
      <form className="wis-stock-preview__calculator" onSubmit={accept}>
        <div className="wis-stock-preview__heading">
          <h3>주문 체험</h3>
          <span className="wis-stocks__closed">예시 주문</span>
          <InfoHelp label="예시 주문 처리">
            <p>
              교사 공급 시장의 예시입니다. 접수할 때 표시된 단가·수수료로
              예약하고 5~60초 뒤 체결합니다. 매수는 금액과 수수료, 매도는 수량을
              예약합니다. 대기 중 취소하거나 체결 시 시장·종목이 정지되면 예약을
              돌려줍니다. 실제 학생 계좌에는 영향이 없습니다.
            </p>
          </InfoHelp>
        </div>
        <span className="wis-stock-preview__example-time">
          예시 시점 · 2026. 11. 16. 월요일 10:00부터
        </span>
        <div className="wis-stock-order__sides" aria-label="예시 주문 방향">
          <button
            type="button"
            aria-pressed={side === "BUY"}
            disabled={Boolean(pending)}
            onClick={() => {
              setSide("BUY");
              setError("");
            }}
          >
            매수
          </button>
          <button
            type="button"
            aria-pressed={side === "SELL"}
            disabled={Boolean(pending)}
            onClick={() => {
              setSide("SELL");
              setError("");
            }}
          >
            매도
          </button>
        </div>
        <div className="wis-stock-preview__order">
          <label>
            수량 (주)
            <input
              type="number"
              min="1"
              step="1"
              required
              value={quantity}
              disabled={Boolean(pending)}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="wis-stocks__primary"
            disabled={Boolean(pending)}
          >
            {pending
              ? "예시 주문 대기 중"
              : `예시 ${side === "BUY" ? "매수" : "매도"} 접수`}
          </button>
        </div>
        <p className="wis-stock-preview__available">
          주문 가능 예시 위스 {money(demo.stockCash - snapshot.reservedCash)} ·
          교사 공급 가능 {money(position.availableShares)}주
        </p>
      </form>
      {error && (
        <p className="wis-stocks__error" role="alert">
          {error}
        </p>
      )}
      {demo.order && (
        <section
          className="wis-stock-order__notice"
          aria-label="예시 주문 상태"
          data-order-status={demo.order.status}
          data-delay-seconds={demo.order.delaySeconds}
        >
          <div className="wis-stock-preview__heading">
            <h3 aria-live="polite">
              {demo.order.status === "PENDING"
                ? "예시 주문 대기"
                : demo.order.status === "FILLED"
                  ? "예시 체결 완료"
                  : "예시 주문 취소"}
            </h3>
            {pending && (
              <strong className="wis-stock-order__countdown">
                {Math.max(0, Math.ceil((pending.dueAtMs - tick) / 1000))}초 남음
              </strong>
            )}
          </div>
          <dl className="wis-stock-preview__result">
            <div>
              <dt>접수 종목</dt>
              <dd>
                {stocks.find((item) => item.id === demo.order!.stockId)
                  ?.settings.name || "종목"}
              </dd>
            </div>
            <div>
              <dt>방향·수량</dt>
              <dd>
                {demo.order.side === "BUY" ? "매수" : "매도"}{" "}
                {demo.order.quantity}주
              </dd>
            </div>
            <div>
              <dt>고정 단가</dt>
              <dd>{money(demo.order.unitPrice)} 위스</dd>
            </div>
            <div>
              <dt>수수료</dt>
              <dd>{money(demo.order.fee)} 위스</dd>
            </div>
            <div>
              <dt>
                {pending
                  ? "예약"
                  : demo.order.status === "FILLED"
                    ? demo.order.side === "BUY"
                      ? "주식 계좌 차감"
                      : "주식 계좌 입금"
                    : "예약 해제"}
              </dt>
              <dd>
                {demo.order.side === "BUY"
                  ? money(demo.order.cashDebit) + " 위스"
                  : pending || demo.order.status === "CANCELLED"
                    ? demo.order.quantity + "주"
                    : money(demo.order.cashCredit) + " 위스"}
              </dd>
            </div>
            {demo.order.status === "FILLED" && demo.order.side === "SELL" && (
              <div>
                <dt>실현손익</dt>
                <dd>{money(demo.order.realizedPnl || 0)} 위스</dd>
              </div>
            )}
          </dl>
          {pending && (
            <button
              type="button"
              className="wis-stock-order__cancel"
              onClick={cancel}
            >
              예시 주문 취소
            </button>
          )}
          {demo.order.status === "CANCELLED" && (
            <p className="wis-stock-preview__available">
              {demo.order.cancellationReason === "USER_CANCELLED"
                ? "취소한 주문의 예약을 해제했습니다."
                : "운영 상태를 확인하여 주문을 취소하고 예약을 해제했습니다."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
