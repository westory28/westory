import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  useStudentWisStockAccount,
  useStudentWisStockMarket,
  useStudentWisStockStatus,
} from "../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../lib/semesterScope";
import {
  cancelStudentWisStockOrder,
  placeStudentWisStockOrder,
  studentWisStockError,
  studentWisStockNow,
} from "../../lib/studentWisStockClient";
import WisStockPriceChart, {
  stockObservations,
} from "../../components/common/WisStockPriceChart";
import InfoHelp from "../../components/common/InfoHelp";
import { useAppToast } from "../../components/common/AppToastProvider";
import type { StudentWisStockInstrument } from "../../lib/studentWisStockTypes";
import StudentWisStockAccountPanel from "./components/wispi/StudentWisStockAccountPanel";
import "./components/wispi/studentWisStocks.css";

const money = (value: number) => value.toLocaleString("ko-KR");
const direction = (value: number | null) =>
  value === null || value === 0 ? "is-flat" : value > 0 ? "is-up" : "is-down";
function dailyQuote(stock: StudentWisStockInstrument, asOfMs: number) {
  const points = stockObservations(stock);
  const at = Math.max(asOfMs, stock.updatedAtMs, points.at(-1)?.atMs || 0);
  const dayStart =
    Math.floor((at + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000;
  const previous =
    points.filter((point) => point.atMs < dayStart).at(-1) || points[0];
  if (!previous) return { change: null, percent: null };
  return {
    change: stock.price - previous.price,
    percent: (stock.price / previous.price - 1) * 100,
  };
}
function Change({ change, percent }: ReturnType<typeof dailyQuote>) {
  const label =
    change === null
      ? "기준 시세 없음"
      : change > 0
        ? "상승"
        : change < 0
          ? "하락"
          : "보합";
  return (
    <span
      className={`student-wispi-change ${direction(change)}`}
      aria-label={`${label}${change === null ? "" : ` ${money(Math.abs(change))} 위스, ${Math.abs(percent || 0).toFixed(2)}%`}`}
    >
      {change === null ? (
        "—"
      ) : (
        <>
          <span>
            {change > 0 ? "+" : ""}
            {money(change)} 위스
          </span>
          <span>
            ({percent! > 0 ? "+" : ""}
            {percent!.toFixed(2)}%)
          </span>
        </>
      )}
    </span>
  );
}
const periods = [
  { label: "1일", days: 1 },
  { label: "1주", days: 7 },
  { label: "1개월", days: 30 },
  { label: "전체", days: Infinity },
];
function amounts(
  price: number,
  quantity: number,
  feeBps: number,
  side: "BUY" | "SELL",
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(price) ||
    price <= 0
  )
    return null;
  const gross = BigInt(price) * BigInt(quantity),
    fee = (gross * BigInt(feeBps) + 9999n) / 10000n,
    total = side === "BUY" ? gross + fee : gross - fee;
  return total >= 0 && total <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { fee: Number(fee), total: Number(total) }
    : null;
}
export default function StudentWisStocks() {
  const { currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const scope = getYearSemester(config);
  const status = useStudentWisStockStatus();
  const [tab, setTab] = useState<"market" | "account">("market");
  const opened = status.data?.studentOpen === true;
  const market = useStudentWisStockMarket(opened && tab === "market");
  const account = useStudentWisStockAccount(opened);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down">("all");
  const [mobileDetail, setMobileDetail] = useState(false);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const listScrollY = useRef(0);
  const quantityStock = useRef("");
  const stockButtons = useRef(new Map<string, HTMLButtonElement>());
  const operation = useRef("");
  const [submitting, setSubmitting] = useState("");
  const [days, setDays] = useState(7);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    key: string;
    text: string;
    error: boolean;
  } | null>(null);
  const [, setClock] = useState(0);
  // Keep the local order form through this student's normal reauthentication.
  // The data hooks still revoke and reload their auth-generation-bound data.
  const key = `${currentUser?.uid}:${scope.year}:${scope.semester}`;
  const liveKey = useRef(key);
  liveKey.current = key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTab("market");
    setSelectedId("");
    setSearch("");
    setFilter("all");
    setMobileDetail(false);
    quantityStock.current = "";
    setSide("BUY");
    setQuantity("1");
    setBusy("");
    operation.current = "";
    setSubmitting("");
    setNotice(null);
  }, [key]);
  const pending = account.data?.account.pendingOrders || [];
  useEffect(() => {
    if (!pending.length) return;
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [pending.length > 0, key]);
  const quotes = useMemo(
    () =>
      new Map(
        market.data?.stocks.map((stock) => [
          stock.id,
          dailyQuote(stock, market.data.updatedAtMs),
        ]),
      ),
    [market.data],
  );
  const visibleStocks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko-KR");
    return (market.data?.stocks || []).filter((stock) => {
      const change = quotes.get(stock.id)?.change;
      return (
        (!query ||
          `${stock.settings.name} ${stock.settings.period}`
            .toLocaleLowerCase("ko-KR")
            .includes(query)) &&
        (filter === "all" ||
          (change !== null &&
            change !== undefined &&
            (filter === "up" ? change > 0 : change < 0)))
      );
    });
  }, [market.data, quotes, search, filter]);
  const selected = selectedId
    ? market.data?.stocks.find((stock) => stock.id === selectedId)
    : visibleStocks[0];
  useEffect(() => {
    if (!selected) return;
    // A live price crossing a list filter must never change the order target.
    setSelectedId(selected.id);
    const identity = `${selected.id}:${selected.settings.lotSize}`;
    if (quantityStock.current !== identity) {
      quantityStock.current = identity;
      setQuantity(String(selected.settings.lotSize));
    }
  }, [selected?.id, selected?.settings.lotSize]);
  useEffect(() => {
    if (mobileDetail) detailTitle.current?.focus();
  }, [mobileDetail, selected?.id]);
  useEffect(() => {
    if (market.status === "ready" && !selected) setMobileDetail(false);
  }, [market.status, selected?.id]);
  useEffect(() => {
    if (!account.data || !selected?.haltedUntilMs) return;
    const remaining = selected.haltedUntilMs - studentWisStockNow(account.data);
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setClock((value) => value + 1),
      remaining + 1,
    );
    return () => clearTimeout(timer);
  }, [selected?.haltedUntilMs, account.data, key]);
  const stopped = opened && status.data?.halted === true;
  const tradingEnabled =
    opened && status.status === "ready" && !status.data.halted;
  const canOrder =
    tradingEnabled &&
    market.status === "ready" &&
    market.data.tradingEpoch === status.data?.tradingEpoch &&
    !market.data.rules.halted &&
    account.status === "ready";
  const parsed = /^[0-9]+$/.test(quantity) ? Number(quantity) : 0;
  const estimate =
    selected && market.data
      ? amounts(
          selected.price,
          parsed,
          side === "BUY"
            ? market.data.rules.buyFeeBps
            : market.data.rules.sellFeeBps,
          side,
        )
      : null;
  const available = account.data
    ? account.data.account.stockCash - account.data.account.reservedCash
    : 0;
  const position = account.data?.account.positions.find(
    (item) => item.stockId === selected?.id,
  );
  const availableShares = position
    ? position.quantity - position.reservedSellQuantity
    : 0;
  const instrumentReady =
    !!selected &&
    selected.settings.tradingStatus !== "HALTED" &&
    selected.settings.tradingStatus !== "GRADUATED" &&
    !(side === "BUY" && selected.settings.tradingStatus === "SELL_ONLY") &&
    (!selected.haltedUntilMs ||
      !account.data ||
      selected.haltedUntilMs <= studentWisStockNow(account.data));
  const balanceReady =
    !!estimate &&
    (side === "BUY"
      ? estimate.total + (market.data?.rules.minimumCashReserve || 0) <=
        available
      : parsed <= availableShares);
  const orderProblem = (() => {
    if (busy && busy !== "place") return "주문 취소를 처리하고 있습니다.";
    if (!canOrder) {
      if (status.status === "error") return status.error;
      if (status.status !== "ready")
        return "거래 가능 여부를 확인하고 있습니다.";
      if (!opened) return "아직 위스피가 열리지 않았습니다.";
      if (status.data.halted || market.data?.rules.halted)
        return "시장이 거래 정지 중입니다.";
      if (market.status === "error") return market.error;
      if (market.status !== "ready") return "현재 시세를 확인하고 있습니다.";
      if (market.data.tradingEpoch !== status.data.tradingEpoch)
        return "거래 상태가 바뀌어 최신 시세를 확인하고 있습니다.";
      if (account.status === "error") return account.error;
      return "주식 지갑을 확인하고 있습니다.";
    }
    if (!selected) return "주문할 종목을 선택해 주세요.";
    if (!instrumentReady) {
      if (selected.settings.tradingStatus === "GRADUATED")
        return "졸업한 종목입니다. 보유 주식은 마지막 가격으로 정산됩니다.";
      if (selected.settings.tradingStatus === "SELL_ONLY" && side === "BUY")
        return "이 종목은 매도만 가능합니다.";
      if (selected.settings.tradingStatus === "HALTED")
        return "이 종목은 거래 정지 중입니다.";
      return "이 종목은 급격한 시세 변동으로 잠시 거래가 정지되었습니다.";
    }
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
      return "수량을 1주 이상 입력해 주세요.";
    if (parsed % selected.settings.lotSize !== 0)
      return `${money(selected.settings.lotSize)}주 단위로 입력해 주세요.`;
    if (parsed > (market.data?.rules.maxOrderQuantity || 0))
      return `한 번에 최대 ${money(market.data?.rules.maxOrderQuantity || 0)}주까지 주문할 수 있습니다.`;
    if (!estimate) return "주문 금액을 확인할 수 없습니다. 수량을 줄여 주세요.";
    if (!balanceReady) {
      if (side === "SELL")
        return position?.reservedSellQuantity
          ? `보유 ${money(position.quantity)}주 중 ${money(position.reservedSellQuantity)}주가 매도 대기 중입니다. 지금 매도 가능한 수량은 ${money(availableShares)}주입니다.`
          : availableShares === 0
            ? "매도할 수 있는 주식이 없습니다."
            : `매도 가능한 수량은 ${money(availableShares)}주입니다.`;
      const reserve = market.data?.rules.minimumCashReserve || 0;
      const reserved = account.data?.account.reservedCash || 0;
      const shortage = Math.max(0, estimate.total + reserve - available);
      return `${reserved ? `지갑 ${money(account.data!.account.stockCash)} 위스 중 ${money(reserved)} 위스가 대기 주문에 예약되어 있습니다. ` : ""}수수료 포함 결제 ${money(estimate.total)} 위스${reserve ? ` 후 최소 잔액 ${money(reserve)} 위스를 남겨야 하므로` : "에"} ${money(shortage)} 위스가 부족합니다.`;
    }
    return "";
  })();
  const submit = async () => {
    if (
      !selected ||
      !market.data ||
      !account.data ||
      operation.current ||
      orderProblem
    )
      return;
    const ownerKey = key;
    operation.current = ownerKey;
    setBusy("place");
    setSubmitting(
      `${selected.settings.name} · ${side === "BUY" ? "매수" : "매도"} ${money(parsed)}주`,
    );
    setNotice(null);
    try {
      const result = await placeStudentWisStockOrder(scope, {
        stockId: selected.id,
        side,
        quantity: parsed,
        quote: {
          price: selected.price,
          atMs: studentWisStockNow(account.data),
          marketRevision: market.data.revision,
        },
      });
      if (mounted.current && liveKey.current === ownerKey && result.duplicate)
        showToast({ title: "기존 주문 상태를 확인했습니다.", tone: "info" });
    } catch (error) {
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: true,
          text: studentWisStockError(error),
        });
    } finally {
      if (operation.current === ownerKey) operation.current = "";
      if (mounted.current && liveKey.current === ownerKey) {
        setBusy("");
        setSubmitting("");
      }
    }
  };
  const cancel = async (orderId: string) => {
    if (operation.current || !tradingEnabled) return;
    const ownerKey = key;
    operation.current = ownerKey;
    setBusy(orderId);
    setNotice(null);
    try {
      const result = await cancelStudentWisStockOrder(scope, orderId);
      if (mounted.current && liveKey.current === ownerKey)
        showToast({
          tone: "info",
          title:
            result.order?.status === "CANCELLED"
              ? "주문을 취소했습니다."
              : "주문 상태를 확인했습니다.",
        });
    } catch (error) {
      if (mounted.current && liveKey.current === ownerKey)
        setNotice({
          key: ownerKey,
          error: true,
          text: studentWisStockError(error),
        });
    } finally {
      if (operation.current === ownerKey) operation.current = "";
      if (mounted.current && liveKey.current === ownerKey) setBusy("");
    }
  };
  const quote = selected
    ? quotes.get(selected.id)!
    : { change: null, percent: null };
  const pendingOrders = pending.length > 0 && (
    <section className="student-wispi-pending" aria-label="체결 대기 주문">
      <h2>
        주식 체결 중 <span>{pending.length}건</span>
      </h2>
      <ul className="student-wispi-list">
        {pending.map((order) => {
          const remaining = Math.max(
            0,
            Math.ceil(
              (order.dueAtMs - studentWisStockNow(account.data!)) / 1000,
            ),
          );
          const name =
            account.data?.stocks.find((stock) => stock.id === order.stockId)
              ?.settings.name || "주식";
          return (
            <li key={order.id}>
              <div>
                <strong>{name}</strong>
                <small>
                  {order.side === "BUY" ? "매수" : "매도"}{" "}
                  {money(order.quantity)}주 · {money(order.unitPrice)} 위스
                </small>
                <span
                  className="student-wispi-countdown"
                  role="timer"
                  aria-label={`${name} 체결 남은 시간`}
                >
                  {remaining > 0 ? (
                    <>
                      남은 시간 <strong>{remaining}초</strong>
                    </>
                  ) : (
                    "체결 확인 중"
                  )}
                </span>
              </div>
              {busy === order.id ? (
                <span role="status">취소 중</span>
              ) : (
                <button
                  type="button"
                  disabled={!tradingEnabled}
                  onClick={() => void cancel(order.id)}
                  aria-label={`${name} ${order.side === "BUY" ? "매수" : "매도"} 주문 취소`}
                >
                  취소
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
  return (
    <main className="ws-page student-wispi">
      <header className="ws-page-header">
        <h1>위스피(WsPI)</h1>
      </header>
      {status.status === "loading" && (
        <p role="status">위스피를 불러오는 중입니다.</p>
      )}
      {status.status === "error" && (
        <div role="alert" className="student-wispi-error">
          <p>{status.error}</p>
          <button type="button" onClick={status.retry}>
            다시 불러오기
          </button>
        </div>
      )}
      {status.status === "ready" && !opened && (
        <p>아직 위스피가 열리지 않았습니다.</p>
      )}
      {opened && (
        <div className="student-wispi-stage">
          <div
            className={
              stopped
                ? "student-wispi-content is-stopped"
                : "student-wispi-content"
            }
            aria-hidden={stopped || undefined}
            ref={(node) => {
              if (node) node.inert = stopped;
            }}
          >
            <nav className="ws-page-tabs" aria-label="위스피 보기">
              <button
                type="button"
                aria-pressed={tab === "market"}
                onClick={() => setTab("market")}
              >
                주식 시장
              </button>
              <button
                type="button"
                aria-pressed={tab === "account"}
                onClick={() => setTab("account")}
              >
                주식 지갑
              </button>
            </nav>
            {tab === "account" ? (
              <StudentWisStockAccountPanel tradingEnabled={tradingEnabled} />
            ) : (
              <>
                {market.status === "loading" && (
                  <p role="status">시세를 불러오는 중입니다.</p>
                )}
                {market.status === "error" && (
                  <div role="alert" className="student-wispi-error">
                    <p>{market.error}</p>
                    <button type="button" onClick={market.retry}>
                      다시 불러오기
                    </button>
                  </div>
                )}
                {account.status === "error" && (
                  <div role="alert" className="student-wispi-error">
                    <p>{account.error}</p>
                    <button type="button" onClick={account.retry}>
                      주식 지갑 다시 불러오기
                    </button>
                  </div>
                )}
                {market.data && selected && (
                  <div
                    className={`student-wispi-list-pending${mobileDetail ? " is-detail" : ""}`}
                  >
                    {pendingOrders}
                  </div>
                )}
                {market.data && (
                  <div
                    className={`student-wispi-market${mobileDetail ? " has-detail" : ""}`}
                  >
                    <section
                      className="student-wispi-instruments"
                      aria-label="위스피 종목"
                    >
                      <h2>
                        종목{" "}
                        <span className="student-wispi-muted">
                          {visibleStocks.length}
                        </span>
                      </h2>
                      <div className="student-wispi-search">
                        <input
                          type="search"
                          aria-label="종목 검색"
                          placeholder="종목명·시대 검색"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </div>
                      <div
                        className="student-wispi-filters"
                        aria-label="종목 등락 필터"
                      >
                        {(
                          [
                            ["all", "전체"],
                            ["up", "상승"],
                            ["down", "하락"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={filter === value}
                            onClick={() => setFilter(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div
                        className="student-wispi-list-labels"
                        aria-hidden="true"
                      >
                        <span>종목명</span>
                        <span>현재가 · 전일 대비</span>
                      </div>
                      {market.data.stocks.length === 0 ? (
                        <p className="student-wispi-muted">
                          등록된 종목이 없습니다.
                        </p>
                      ) : visibleStocks.length === 0 ? (
                        <p className="student-wispi-muted">
                          조건에 맞는 종목이 없습니다.
                        </p>
                      ) : (
                        <ul>
                          {visibleStocks.map((stock) => (
                            <li key={stock.id}>
                              <button
                                type="button"
                                aria-pressed={selected?.id === stock.id}
                                ref={(node) => {
                                  if (node)
                                    stockButtons.current.set(stock.id, node);
                                  else stockButtons.current.delete(stock.id);
                                }}
                                aria-controls="student-wispi-selected"
                                onClick={() => {
                                  listScrollY.current = window.scrollY;
                                  setSelectedId(stock.id);
                                  setQuantity(String(stock.settings.lotSize));
                                  setNotice(null);
                                  setMobileDetail(true);
                                }}
                              >
                                <span>
                                  <strong>{stock.settings.name}</strong>
                                  <small>{stock.settings.period}</small>
                                </span>
                                <span className="student-wispi-list-quote">
                                  <strong>
                                    {money(stock.price)} <small>위스</small>
                                  </strong>
                                  <Change {...quotes.get(stock.id)!} />
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    {selectedId && !selected && (
                      <p role="status">
                        선택한 종목을 더 이상 거래할 수 없습니다. 다른 종목을
                        선택해 주세요.
                      </p>
                    )}
                    {selected && (
                      <section
                        id="student-wispi-selected"
                        className="student-wispi-detail"
                        aria-label={`${selected.settings.name} 주식`}
                      >
                        <button
                          type="button"
                          className="student-wispi-back"
                          onClick={() => {
                            setMobileDetail(false);
                            requestAnimationFrame(() => {
                              stockButtons.current
                                .get(selected.id)
                                ?.focus({ preventScroll: true });
                              window.scrollTo({
                                top: listScrollY.current,
                                behavior: "instant",
                              });
                            });
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path d="m14 6-6 6 6 6" />
                          </svg>
                          종목 목록
                        </button>
                        <div className="student-wispi-chart-panel">
                          <div className="student-wispi-price">
                            <div>
                              <span className="student-wispi-muted">
                                {selected.settings.period}
                              </span>
                              <h2 ref={detailTitle} tabIndex={-1}>
                                {selected.settings.name}
                              </h2>
                              <p>
                                {money(selected.price)} <small>위스</small>
                              </p>
                            </div>
                          </div>
                          <div className="student-wispi-daily">
                            <span>전일 대비</span>
                            <Change {...quote} />
                          </div>
                          <div className={direction(quote.change)}>
                            <WisStockPriceChart
                              stock={selected}
                              days={days}
                              variant="candlestick"
                            />
                          </div>
                          <div
                            className="student-wispi-periods"
                            aria-label="가격 기록 기간"
                          >
                            {periods.map((period) => (
                              <button
                                key={period.label}
                                type="button"
                                aria-pressed={days === period.days}
                                onClick={() => setDays(period.days)}
                              >
                                {period.label}
                              </button>
                            ))}
                          </div>
                          {selected.settings.description && (
                            <p className="student-wispi-description">
                              {selected.settings.description}
                            </p>
                          )}
                        </div>
                        <div className="student-wispi-trade-panel">
                          {pendingOrders}
                          <form
                            className="student-wispi-order"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submit();
                            }}
                          >
                            <h2 className="student-wispi-order-title">
                              주식 주문
                              <InfoHelp label="주식 거래 조건">
                                <dl className="student-wispi-rule-help">
                                  <div>
                                    <dt>최소 잔액</dt>
                                    <dd>
                                      {money(
                                        market.data.rules.minimumCashReserve,
                                      )}{" "}
                                      위스
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>매수 / 매도 수수료</dt>
                                    <dd>
                                      {market.data.rules.buyFeeBps / 100}% /{" "}
                                      {market.data.rules.sellFeeBps / 100}%
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>하루 매수 한도</dt>
                                    <dd>
                                      {money(market.data.rules.dailyBuyLimit)}{" "}
                                      위스 (수수료 포함)
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>하루 주문 한도</dt>
                                    <dd>
                                      {money(market.data.rules.dailyOrderLimit)}
                                      회
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>종목별 최대 비중</dt>
                                    <dd>
                                      {market.data.rules.maxConcentrationBps /
                                        100}
                                      %
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>주문 간격</dt>
                                    <dd>
                                      {market.data.rules.cooldownSeconds}초
                                    </dd>
                                  </div>
                                </dl>
                              </InfoHelp>
                            </h2>
                            <div className="student-wispi-inline">
                              <div
                                className="student-wispi-segments"
                                aria-label="주문 종류"
                              >
                                {(["BUY", "SELL"] as const).map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    aria-pressed={side === value}
                                    onClick={() => {
                                      setSide(value);
                                      setNotice(null);
                                    }}
                                  >
                                    {value === "BUY" ? "매수" : "매도"}
                                  </button>
                                ))}
                              </div>
                              <span className="student-wispi-muted">
                                {side === "BUY"
                                  ? `사용 가능 ${money(available)} 위스`
                                  : `매도 가능 ${money(availableShares)}주`}
                              </span>
                            </div>
                            <div className="student-wispi-order-action">
                              <label>
                                <span>수량</span>
                                <input
                                  aria-label="수량"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={quantity}
                                  onChange={(event) =>
                                    setQuantity(
                                      event.target.value.replace(/[^0-9]/g, ""),
                                    )
                                  }
                                  aria-describedby={
                                    orderProblem
                                      ? "student-wispi-order-problem"
                                      : undefined
                                  }
                                />
                                <span aria-hidden="true">주</span>
                              </label>
                              {busy === "place" ? (
                                <div
                                  className="student-wispi-submitting"
                                  role="status"
                                  aria-label={`${submitting} 주문 접수 중`}
                                >
                                  <strong>주문 접수 중</strong>
                                </div>
                              ) : (
                                <button
                                  className="student-wispi-primary"
                                  type="submit"
                                  aria-label={`${side === "BUY" ? "매수" : "매도"} 주문 접수`}
                                  disabled={!!orderProblem}
                                  aria-describedby={
                                    orderProblem
                                      ? "student-wispi-order-problem"
                                      : undefined
                                  }
                                  title={orderProblem || undefined}
                                >
                                  {side === "BUY" ? "매수" : "매도"}
                                </button>
                              )}
                            </div>
                            <div className="student-wispi-order-estimate">
                              <span>
                                {side === "BUY" ? "예상 결제" : "예상 수령"}
                              </span>
                              <strong>
                                {estimate ? money(estimate.total) : "—"} 위스
                              </strong>
                              {estimate && (
                                <small className="student-wispi-muted">
                                  (수수료 {money(estimate.fee)} 위스
                                  {side === "BUY" ? " 포함" : " 제외"})
                                </small>
                              )}
                            </div>
                            {orderProblem && (
                              <p
                                id="student-wispi-order-problem"
                                className="student-wispi-order-problem"
                                role="status"
                              >
                                {orderProblem}
                              </p>
                            )}
                            {canOrder &&
                              estimate &&
                              !balanceReady &&
                              side === "BUY" && (
                                <button
                                  type="button"
                                  className="student-wispi-wallet-link"
                                  onClick={() => setTab("account")}
                                >
                                  주식 지갑에 입금하기
                                </button>
                              )}
                            {notice?.key === key && (
                              <p role="alert" className="student-wispi-error">
                                {notice.text}
                              </p>
                            )}
                          </form>
                        </div>
                      </section>
                    )}
                  </div>
                )}
                {(!market.data || !selected) && (
                  <div className="student-wispi-orphan-pending">
                    {pendingOrders}
                  </div>
                )}
                {!!account.data?.account.recentOrders.length && (
                  <section
                    className="student-wispi-section"
                    aria-label="최근 주문 결과"
                  >
                    <h2>최근 주문</h2>
                    <ul className="student-wispi-list">
                      {account.data.account.recentOrders.map((order) => (
                        <li key={order.id}>
                          <div>
                            <strong>
                              {account.data?.stocks.find(
                                (stock) => stock.id === order.stockId,
                              )?.settings.name || "주식"}{" "}
                              · {order.side === "BUY" ? "매수" : "매도"}{" "}
                              {money(order.quantity)}주
                            </strong>
                            <small>
                              접수 가격 {money(order.unitPrice)} 위스
                            </small>
                          </div>
                          <strong>
                            {order.status === "FILLED"
                              ? "체결 완료"
                              : order.status === "CANCELLED"
                                ? "취소"
                                : "처리 완료"}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
          {stopped && (
            <div className="student-wispi-stopped" role="alert">
              <strong>위스피의 거래가 중지되었습니다.</strong>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
