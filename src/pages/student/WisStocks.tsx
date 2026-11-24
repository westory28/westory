import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  useStudentWisStockAccount,
  useStudentWisStockMarket,
  useStudentWisStockStatus,
} from "../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../lib/semesterScope";
import WisStockPriceChart, {
  stockObservations,
} from "../../components/common/WisStockPriceChart";
import type { StudentWisStockInstrument } from "../../lib/studentWisStockTypes";
import StudentWisStockAccountPanel from "./components/wispi/StudentWisStockAccountPanel";
import StudentWisStockRanking from "./components/wispi/StudentWisStockRanking";
import StudentWisStockReadStatus from "./components/wispi/StudentWisStockReadStatus";
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
const views = [
  { id: "market", label: "주식 시장", visible: true },
  { id: "account", label: "주식 지갑", visible: true },
  { id: "ranking", label: "투자 랭킹", visible: true },
  { id: "reports", label: "주식 보고서", visible: false },
] as const;
type OpenView = Extract<(typeof views)[number], { visible: true }>["id"];
type WalletEntry = { stockId: string; owned: boolean };

export default function StudentWisStocks() {
  const { currentUser, authGeneration, config } = useAuth();
  const scope = getYearSemester(config);
  const status = useStudentWisStockStatus();
  const [tab, setTab] = useState<OpenView>("market");
  const [walletEntry, setWalletEntry] = useState<WalletEntry | null>(null);
  const opened = status.data?.studentOpen === true;
  const market = useStudentWisStockMarket(opened && tab === "market");
  const account = useStudentWisStockAccount(opened && tab !== "ranking");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down">("all");
  const [mobileDetail, setMobileDetail] = useState(false);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const listScrollY = useRef(0);
  const stockButtons = useRef(new Map<string, HTMLButtonElement>());
  const [days, setDays] = useState(7);
  const key = `${currentUser?.uid}:${scope.year}:${scope.semester}`;
  useEffect(() => {
    setTab("market");
    setSelectedId("");
    setSearch("");
    setFilter("all");
    setMobileDetail(false);
    setWalletEntry(null);
  }, [key]);
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
  }, [selected?.id]);
  useEffect(() => {
    if (mobileDetail) detailTitle.current?.focus();
  }, [mobileDetail, selected?.id]);
  useEffect(() => {
    if (market.status === "ready" && !selected) setMobileDetail(false);
  }, [market.status, selected?.id]);
  const stopped = opened && status.data?.halted === true;
  const tradingEnabled =
    opened && status.status === "ready" && !status.data.halted;
  const owned =
    account.data?.account.positions.some(
      (position) => position.stockId === selected?.id && position.quantity > 0,
    ) === true;
  const openWallet = (entry: WalletEntry | null) => {
    setWalletEntry(entry);
    setTab("account");
  };
  const quote = selected
    ? quotes.get(selected.id)!
    : { change: null, percent: null };
  const pendingCount = account.data?.account.pendingOrders.length || 0;
  return (
    <main className="ws-page student-wispi">
      <header className="ws-page-header">
        <h1>위스피(WsPI)</h1>
      </header>
      <StudentWisStockReadStatus
        loading={status.status === "loading"}
        error={status.error}
        label="위스피"
        retry={status.retry}
      />
      {status.status === "ready" && !opened && (
        <p>아직 위스피가 열리지 않았습니다.</p>
      )}
      {(opened || (tab === "account" && status.status === "loading")) && (
        <div className="student-wispi-stage" hidden={!opened}>
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
              {views
                .filter((view) => view.visible)
                .map((view) => (
                  <button
                    type="button"
                    key={view.id}
                    aria-pressed={tab === view.id}
                    onClick={() => {
                      if (tab === view.id) return;
                      setWalletEntry(null);
                      setTab(view.id);
                    }}
                  >
                    {view.label}
                  </button>
                ))}
            </nav>
            {tab === "ranking" ? (
              tradingEnabled && (
                <StudentWisStockRanking
                  key={`${key}:${authGeneration}:${status.data?.tradingEpoch}`}
                  {...scope}
                />
              )
            ) : tab === "account" ? (
              <StudentWisStockAccountPanel
                active={opened}
                key={key}
                tradingEnabled={tradingEnabled}
                tradingEpoch={status.data?.tradingEpoch}
                initialBuyId={
                  walletEntry && !walletEntry.owned
                    ? walletEntry.stockId
                    : undefined
                }
                initialHoldingId={
                  walletEntry?.owned ? walletEntry.stockId : undefined
                }
              />
            ) : (
              <>
                <StudentWisStockReadStatus
                  loading={market.status === "loading"}
                  error={market.error}
                  label="주식 시세"
                  retry={market.retry}
                />
                <StudentWisStockReadStatus
                  loading={
                    market.status === "ready" && account.status === "loading"
                  }
                  error={account.error}
                  label="주식 지갑"
                  retry={account.retry}
                />
                {pendingCount > 0 && (
                  <div className="student-wispi-market-pending">
                    <strong>주식 체결 중 {pendingCount}건</strong>
                    <button type="button" onClick={() => openWallet(null)}>
                      지갑에서 대기 주문 보기
                    </button>
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
                            <button
                              type="button"
                              className="student-wispi-market-trade student-wispi-primary"
                              disabled={
                                account.status !== "ready" || !tradingEnabled
                              }
                              onClick={() =>
                                openWallet({ stockId: selected.id, owned })
                              }
                            >
                              {account.status !== "ready"
                                ? "지갑 확인 중"
                                : owned
                                  ? "지갑에서 보유 종목 보기"
                                  : "지갑에서 첫 매수"}
                            </button>
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
                      </section>
                    )}
                  </div>
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
