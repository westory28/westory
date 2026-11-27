import { useEffect, useMemo, useRef, useState } from "react";
import WisStockPriceChart, {
  stockObservations,
} from "../../../../components/common/WisStockPriceChart";
import {
  useStudentWisStockAccount,
  useStudentWisStockMarket,
} from "../../../../hooks/useStudentWisStocks";
import { wisStockLogoUrl } from "../../../../lib/wisStockLogos";
import type {
  StudentWisStockInstrument,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import StudentWisStockWalletOrders, {
  type WalletOrderTarget,
} from "./StudentWisStockWalletOrders";
import { useWisStockVenue } from "./wisStockVenueContext";

const KST = 9 * 3_600_000;
const DAY = 86_400_000;
const money = (value: number) => value.toLocaleString("ko-KR");
const direction = (value: number | null) =>
  value === null || value === 0 ? "is-flat" : value > 0 ? "is-up" : "is-down";
const kstDayStart = (atMs: number) =>
  Math.floor((atMs + KST) / DAY) * DAY - KST;
const clock = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
const listingTime = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
// Minutes after KST midnight as HH:MM (rules store trading hours this way).
const kstClock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export function dailyQuote(stock: StudentWisStockInstrument, asOfMs: number) {
  const points = stockObservations(stock);
  const at = Math.max(asOfMs, stock.updatedAtMs, points.at(-1)?.atMs || 0);
  const dayStart = kstDayStart(at);
  const previous =
    points.filter((point) => point.atMs < dayStart).at(-1) || points[0];
  if (!previous) return { change: null, percent: null };
  return {
    change: stock.price - previous.price,
    percent: (stock.price / previous.price - 1) * 100,
  };
}
export function StudentWisStockChange({
  change,
  percent,
  unit,
}: ReturnType<typeof dailyQuote> & { unit: string }) {
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
      aria-label={`${label}${change === null ? "" : ` ${money(Math.abs(change))} ${unit}, ${Math.abs(percent || 0).toFixed(2)}%`}`}
    >
      {change === null ? (
        "—"
      ) : (
        <>
          <span>
            {change > 0 ? "+" : ""}
            {money(change)} {unit}
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
const exitLabels = { delist: "상장 폐지", merge: "합병", close: "거래 종료" };
const ended = (stock: StudentWisStockInstrument) =>
  stock.settings.tradingStatus === "GRADUATED";
function StockLogo({
  stock,
}: {
  stock: { id: string; settings: { name: string } };
}) {
  const url = wisStockLogoUrl(stock.id);
  return url ? (
    <img
      className="student-wispi-logo"
      src={url}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="student-wispi-logo is-initial" aria-hidden="true">
      {stock.settings.name.slice(0, 1)}
    </span>
  );
}
type Alert = {
  id: string;
  name: string;
  atMs: number;
  kind: "listing" | "delist" | "merge" | "close";
};
/** Today's listings and trading ends, newest first, from the received market. */
function marketAlerts(stocks: StudentWisStockInstrument[], asOfMs: number) {
  const since = kstDayStart(asOfMs);
  const alerts: Alert[] = [];
  for (const stock of stocks) {
    if (stock.exit && stock.exit.atMs >= since)
      alerts.push({
        id: stock.id,
        name: stock.settings.name,
        atMs: stock.exit.atMs,
        kind: stock.exit.kind,
      });
    else if (stock.listedAtMs !== undefined && stock.listedAtMs >= since)
      alerts.push({
        id: stock.id,
        name: stock.settings.name,
        atMs: stock.listedAtMs,
        kind: "listing",
      });
  }
  return alerts.sort((a, b) => b.atMs - a.atMs);
}
const periods = [
  { label: "1일", days: 1 },
  { label: "1주", days: 7 },
  { label: "1개월", days: 30 },
  { label: "전체", days: Infinity },
];

export default function StudentWisStockMarketView({
  scope,
  ownerKey,
  tradingEnabled,
  tradingEpoch,
  onOpenAccount,
  onOpenExchange,
}: {
  scope: WisStockScope;
  ownerKey: string;
  tradingEnabled: boolean;
  tradingEpoch?: number;
  onOpenAccount: () => void;
  onOpenExchange: () => void;
}) {
  const venue = useWisStockVenue();
  const unit = venue.unit;
  const market = useStudentWisStockMarket(true, venue);
  const account = useStudentWisStockAccount(true, venue);
  const [ticket, setTicket] = useState<WalletOrderTarget | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down">("all");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [days, setDays] = useState(7);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const listScrollY = useRef(0);
  const stockButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    setSelectedId("");
    setSearch("");
    setFilter("all");
    setMobileDetail(false);
    setTicket(null);
  }, [ownerKey]);
  useEffect(() => {
    if (!tradingEnabled) setTicket(null);
  }, [tradingEnabled]);
  const stocks = market.data?.stocks;
  const quotes = useMemo(
    () =>
      new Map(
        (stocks || []).map((stock) => [
          stock.id,
          dailyQuote(stock, market.data!.updatedAtMs),
        ]),
      ),
    [market.data],
  );
  const alerts = useMemo(
    () =>
      market.data
        ? marketAlerts(market.data.stocks, market.data.updatedAtMs)
        : [],
    [market.data],
  );
  const visibleStocks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko-KR");
    const matching = (stocks || []).filter((stock) => {
      const change = quotes.get(stock.id)?.change;
      return (
        (!query ||
          `${stock.settings.name} ${stock.settings.period}`
            .toLocaleLowerCase("ko-KR")
            .includes(query)) &&
        (filter === "all" ||
          (!ended(stock) &&
            change !== null &&
            change !== undefined &&
            (filter === "up" ? change > 0 : change < 0)))
      );
    });
    // Ended stocks stay visible for holders' reference, after the live list.
    return [
      ...matching.filter((stock) => !ended(stock)),
      ...matching.filter(ended),
    ];
  }, [stocks, quotes, search, filter]);
  // Overseas: catalog stocks not listed yet, after the listed ones. They have
  // no price, so the rise/fall filters leave them out.
  const visibleUpcoming = useMemo(() => {
    if (filter !== "all") return [];
    const query = search.trim().toLocaleLowerCase("ko-KR");
    return (market.data?.upcoming ?? []).filter(
      (item) =>
        !query ||
        `${item.name} ${item.period}`
          .toLocaleLowerCase("ko-KR")
          .includes(query),
    );
  }, [market.data, search, filter]);
  const liveCount = visibleStocks.filter((stock) => !ended(stock)).length;
  const selected = selectedId
    ? stocks?.find((stock) => stock.id === selectedId)
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
  const owned =
    account.data?.account.positions.some(
      (position) => position.stockId === selected?.id && position.quantity > 0,
    ) === true;
  const quote = selected
    ? quotes.get(selected.id)!
    : { change: null, percent: null };
  const pendingCount = account.data?.account.pendingOrders.length || 0;
  const noFunds =
    account.status === "ready" &&
    account.data.account.stockCash === 0 &&
    account.data.account.positions.length === 0;
  const selectedEnded = !!selected && ended(selected);
  return (
    <>
      <StudentWisStockReadStatus
        loading={market.status === "loading"}
        error={market.error}
        label="주식 시세"
        retry={market.retry}
      />
      <StudentWisStockReadStatus
        loading={market.status === "ready" && account.status === "loading"}
        error={account.error}
        label="주식 계좌"
        retry={account.retry}
      />
      {ticket && (
        <StudentWisStockWalletOrders
          key={ownerKey}
          scope={scope}
          account={account}
          tradingEnabled={tradingEnabled}
          tradingEpoch={tradingEpoch}
          target={ticket}
          onClose={() => setTicket(null)}
        />
      )}
      {alerts.length > 0 && (
        <section
          className="student-wispi-alerts"
          aria-label={`오늘의 ${venue.label} 주식 알림`}
        >
          <h2>주식 알림</h2>
          <ul>
            {alerts.slice(0, 6).map((alert) => (
              <li key={`${alert.kind}:${alert.id}`}>
                <button
                  type="button"
                  className={`student-wispi-alert is-${alert.kind}`}
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                    setSelectedId(alert.id);
                    setMobileDetail(true);
                  }}
                >
                  <span className="student-wispi-alert-kind">
                    {alert.kind === "listing"
                      ? "신규 상장"
                      : exitLabels[alert.kind]}
                  </span>
                  <strong>{alert.name}</strong>
                  <time dateTime={new Date(alert.atMs).toISOString()}>
                    {clock.format(alert.atMs)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pendingCount > 0 && (
        <div className="student-wispi-market-pending">
          <strong>주식 체결 중 {pendingCount}건</strong>
          <button type="button" onClick={onOpenAccount}>
            계좌에서 대기 주문 보기
          </button>
        </div>
      )}
      {noFunds && tradingEnabled && (
        <div className="student-wispi-market-pending">
          <strong>
            {venue.id === "OVERSEAS"
              ? "유스 계좌가 비어 있습니다."
              : "주식 계좌가 비어 있습니다."}
          </strong>
          <button
            type="button"
            onClick={venue.id === "OVERSEAS" ? onOpenExchange : onOpenAccount}
          >
            {venue.id === "OVERSEAS" ? "위스를 유스로 환전" : "위스 입금하기"}
          </button>
        </div>
      )}
      {market.data && (
        <div
          className={`student-wispi-market${mobileDetail ? " has-detail" : ""}`}
        >
          <section
            className="student-wispi-instruments"
            aria-label={`${venue.label} 종목`}
          >
            <h2>
              {venue.label} 종목{" "}
              <span className="student-wispi-muted">{liveCount}</span>
              {venue.id === "OVERSEAS" && (
                <span className="student-wispi-muted">
                  {" "}
                  · 거래 {kstClock(market.data.rules.openMinuteKst)}~
                  {kstClock(market.data.rules.closeMinuteKst)}
                </span>
              )}
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
            <div className="student-wispi-filters" aria-label="종목 등락 필터">
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
            <div className="student-wispi-list-labels" aria-hidden="true">
              <span>종목명</span>
              <span>현재가 · 전일 대비</span>
            </div>
            {market.data.stocks.length === 0 &&
            !market.data.upcoming?.length ? (
              <p className="student-wispi-muted">
                아직 상장한 종목이 없습니다.
              </p>
            ) : visibleStocks.length === 0 && visibleUpcoming.length === 0 ? (
              <p className="student-wispi-muted">
                조건에 맞는 종목이 없습니다.
              </p>
            ) : (
              <ul>
                {visibleStocks.map((stock, index) => (
                  <li
                    key={stock.id}
                    className={ended(stock) ? "is-ended" : undefined}
                  >
                    {ended(stock) &&
                      (index === 0 || !ended(visibleStocks[index - 1])) && (
                        <p className="student-wispi-list-group">거래 종료</p>
                      )}
                    <button
                      type="button"
                      aria-pressed={selected?.id === stock.id}
                      ref={(node) => {
                        if (node) stockButtons.current.set(stock.id, node);
                        else stockButtons.current.delete(stock.id);
                      }}
                      aria-controls="student-wispi-selected"
                      onClick={() => {
                        listScrollY.current = window.scrollY;
                        setSelectedId(stock.id);
                        setMobileDetail(true);
                      }}
                    >
                      <StockLogo stock={stock} />
                      <span className="student-wispi-list-name">
                        <strong>{stock.settings.name}</strong>
                        <small>
                          {ended(stock)
                            ? exitLabels[stock.exit?.kind || "close"]
                            : stock.settings.period}
                        </small>
                      </span>
                      <span className="student-wispi-list-quote">
                        <strong>
                          {money(stock.price)} <small>{unit}</small>
                        </strong>
                        {ended(stock) ? (
                          <span className="student-wispi-change is-flat">
                            마지막 가격
                          </span>
                        ) : (
                          <StudentWisStockChange
                            {...quotes.get(stock.id)!}
                            unit={unit}
                          />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
                {visibleUpcoming.map((item, index) => (
                  <li key={item.id} className="is-upcoming">
                    {index === 0 && (
                      <p className="student-wispi-list-group">상장 예정</p>
                    )}
                    <div className="student-wispi-upcoming">
                      <StockLogo
                        stock={{ id: item.id, settings: { name: item.name } }}
                      />
                      <span className="student-wispi-list-name">
                        <strong>{item.name}</strong>
                        <small>{item.period}</small>
                        {item.tagline && (
                          <small className="student-wispi-upcoming-tagline">
                            {item.tagline}
                          </small>
                        )}
                      </span>
                      <span className="student-wispi-list-quote">
                        <strong>상장 예정</strong>
                        <small>{listingTime.format(item.listingAtMs)}</small>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {selectedId && !selected && (
            <p role="status">
              선택한 종목을 더 이상 거래할 수 없습니다. 다른 종목을 선택해
              주세요.
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
                  <div className="student-wispi-price-title">
                    <StockLogo stock={selected} />
                    <div>
                      <span className="student-wispi-muted">
                        {selected.settings.period}
                      </span>
                      <h2 ref={detailTitle} tabIndex={-1}>
                        {selected.settings.name}
                      </h2>
                      <p>
                        {money(selected.price)} <small>{unit}</small>
                      </p>
                    </div>
                  </div>
                  {selectedEnded ? (
                    <p className="student-wispi-ended-note" role="status">
                      {exitLabels[selected.exit?.kind || "close"]} · 보유 주식은
                      마지막 가격으로 계좌에 정산됩니다.
                    </p>
                  ) : (
                    <div className="student-wispi-trade-actions">
                      {(owned
                        ? (["BUY", "SELL"] as const)
                        : (["BUY"] as const)
                      ).map((side) => (
                        <button
                          type="button"
                          key={side}
                          className={
                            side === "BUY" ? "student-wispi-primary" : undefined
                          }
                          aria-haspopup="dialog"
                          aria-label={`${selected.settings.name} ${side === "BUY" ? "매수" : "매도"} 주문 열기`}
                          disabled={
                            account.status !== "ready" || !tradingEnabled
                          }
                          onClick={() =>
                            setTicket({
                              stockId: selected.id,
                              entry: owned ? "holding" : "first",
                              side,
                            })
                          }
                        >
                          {side === "BUY" ? "매수" : "매도"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!selectedEnded && (
                  <div className="student-wispi-daily">
                    <span>전일 대비</span>
                    <StudentWisStockChange {...quote} unit={unit} />
                  </div>
                )}
                <div className={direction(quote.change)}>
                  <WisStockPriceChart
                    stock={selected}
                    days={days}
                    variant="candlestick"
                    priceUnit={unit}
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
  );
}
