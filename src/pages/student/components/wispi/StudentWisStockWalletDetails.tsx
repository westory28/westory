import { useCallback, useEffect, useRef, useState } from "react";
import WisStockLoadMore from "../../../../components/common/WisStockLoadMore";
import {
  getStudentWisStockHistory,
  studentWisStockError,
} from "../../../../lib/studentWisStockClient";
import type {
  StudentWisStockHistoryEntry,
  StudentWisStockHistoryPage,
  StudentWisStockState,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import StudentWisStockWalletChart from "./StudentWisStockWalletChart";
import { useWisStockVenue } from "./wisStockVenueContext";

const PAGE_SIZE = 20;
const views = {
  investments: "투자 현황",
  history: "거래 내역",
  graph: "내 그래프",
} as const;
type WalletView = keyof typeof views;
const historyLabels: Record<StudentWisStockHistoryEntry["kind"], string> = {
  DEPOSIT: "입금",
  EVENT_BONUS: "위스피 이벤트 보상",
  WITHDRAW: "출금",
  ORDER_ACCEPTED: "주문 접수",
  ORDER_FILLED: "체결",
  ORDER_CANCELLED: "주문 취소",
  EXCHANGE: "환전",
};
const money = (n: number) => n.toLocaleString("ko-KR");
const signed = (n: number) => (n > 0 ? "+" : "") + money(n);
const date = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
const tone = (n: number | null) =>
  n === null || n === 0 ? "is-flat" : n > 0 ? "is-up" : "is-down";

type HoldingActions = {
  onTrade?: (stockId: string) => void;
  focusHolding?: string;
  onFocused: () => void;
};

// The parent keys this component by account, semester, revision and explicit refresh.
function WalletTable({
  view,
  state,
  scope,
  onTrade,
  focusHolding,
  onFocused,
}: {
  view: WalletView;
  state: StudentWisStockState;
  scope: WisStockScope;
} & HoldingActions) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [history, setHistory] = useState<StudentWisStockHistoryPage | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const started = useRef(false);
  const pending = useRef(false);
  const { year, semester } = scope;
  const venue = useWisStockVenue();
  const unit = venue.unit;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(
    async (cursor: string) => {
      if (pending.current) return;
      pending.current = true;
      started.current = true;
      setBusy(true);
      setError("");
      try {
        const next = await getStudentWisStockHistory(
          { year, semester },
          cursor,
          venue,
        );
        if (mounted.current)
          setHistory((previous) =>
            cursor && previous
              ? { ...next, entries: [...previous.entries, ...next.entries] }
              : next,
          );
      } catch (cause) {
        if (mounted.current) {
          if (!isTransientHistoryFailure(cause)) setHistory(null);
          setError(studentWisStockError(cause));
        }
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [year, semester, venue],
  );
  useEffect(() => {
    if (view === "history" && !started.current) void load("");
  }, [view, load]);

  const stocks = new Map(state.stocks.map((stock) => [stock.id, stock]));
  const holdings = state.account.positions
    .filter((position) => position.quantity > 0)
    .map((position) => {
      const stock = stocks.get(position.stockId);
      const value = stock ? stock.price * position.quantity : null;
      return { ...position, stock, value };
    })
    .sort(
      (left, right) =>
        (right.value ?? -1) - (left.value ?? -1) ||
        left.stockId.localeCompare(right.stockId),
    );
  const targetRow = useRef<HTMLButtonElement>(null);
  const targetIndex = focusHolding
    ? holdings.findIndex((row) => row.stockId === focusHolding)
    : -1;
  useEffect(() => {
    if (view !== "investments" || targetIndex < 0) return;
    if (targetIndex >= visible) {
      setVisible(PAGE_SIZE * Math.ceil((targetIndex + 1) / PAGE_SIZE));
    } else if (targetRow.current) {
      targetRow.current.focus();
      onFocused();
    }
  }, [view, targetIndex, visible, onFocused]);
  if (view === "graph") return null;
  const cost = holdings.reduce((sum, position) => sum + position.costBasis, 0);
  const value = holdings.reduce<number | null>(
    (sum, position) =>
      sum === null || position.value === null ? null : sum + position.value,
    0,
  );
  const profit = value === null ? null : value - cost;
  const investing = view === "investments";
  const rows = investing ? holdings : history?.entries;
  const columns = investing
    ? ["종목·보유량", "현재가", "평가 금액"]
    : ["거래·일시", "종목·수량", "계좌 증감"];
  const nextCursor = history?.nextCursor || "";
  return (
    <>
      {investing && holdings.length > 0 && (
        <dl className="student-wispi-investment-summary">
          <div>
            <dt>평가 금액</dt>
            <dd>
              {value === null ? "—" : money(value)} <small>{unit}</small>
            </dd>
          </div>
          <div>
            <dt>매수 금액</dt>
            <dd>
              {money(cost)} <small>{unit}</small>
            </dd>
          </div>
          <div>
            <dt>평가 손익</dt>
            <dd className={tone(profit)}>
              {profit === null ? "—" : signed(profit)} <small>{unit}</small>
              {profit !== null && cost > 0 && (
                <small className="student-wispi-balance-note">
                  {profit > 0 ? "+" : ""}
                  {((profit / cost) * 100).toFixed(2)}%
                </small>
              )}
            </dd>
          </div>
        </dl>
      )}
      <div
        key={view}
        className="student-wispi-wallet-scroll"
        role="region"
        aria-label={investing ? "보유 종목 목록" : "거래 내역 목록"}
        tabIndex={0}
      >
        <table
          className="student-wispi-wallet-table"
          aria-label={investing ? "보유 종목" : "거래 내역"}
        >
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {investing
              ? holdings.slice(0, visible).map((position) => (
                  <tr
                    key={position.stockId}
                    className={
                      onTrade && position.stock
                        ? "student-wispi-tradable-holding"
                        : undefined
                    }
                    onClick={
                      onTrade && position.stock
                        ? () => onTrade(position.stockId)
                        : undefined
                    }
                  >
                    <th scope="row">
                      {onTrade && position.stock ? (
                        <button
                          type="button"
                          className="student-wispi-holding-link"
                          ref={
                            focusHolding === position.stockId
                              ? targetRow
                              : undefined
                          }
                          aria-label={`${position.stock.settings.name} 거래`}
                        >
                          {position.stock.settings.name}
                        </button>
                      ) : (
                        position.stock?.settings.name || "이전 종목"
                      )}
                      <small>
                        {money(position.quantity)}주
                        {position.reservedSellQuantity > 0 &&
                          ` · 매도 예약 ${money(position.reservedSellQuantity)}주`}
                      </small>
                    </th>
                    <td>
                      {position.stock
                        ? `${money(position.stock.price)} ${unit}`
                        : "시세 확인 중"}
                    </td>
                    <td>
                      {position.value === null
                        ? "—"
                        : `${money(position.value)} ${unit}`}
                      <small>
                        매수 {money(position.costBasis)} {unit}
                      </small>
                    </td>
                  </tr>
                ))
              : history?.entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">
                      {entry.automaticSettlement === "GRADUATION"
                        ? "거래 종료 정산"
                        : historyLabels[entry.kind] || "거래 내역"}
                      {entry.kind === "EXCHANGE" &&
                        entry.direction &&
                        ` · ${entry.direction === "WIS_TO_YUS" ? "위스→유스" : "유스→위스"}`}
                      {entry.side &&
                        ` · ${entry.side === "BUY" ? "매수" : "매도"}`}
                      <small>{date.format(entry.atMs)}</small>
                    </th>
                    <td>
                      {entry.stockId
                        ? stocks.get(entry.stockId)?.settings.name ||
                          "이전 종목"
                        : entry.kind === "EXCHANGE" && entry.fxRate
                          ? `1,000유스 = ${money(entry.fxRate)}위스`
                          : "—"}
                      {!!entry.quantity && (
                        <small>{money(entry.quantity)}주</small>
                      )}
                    </td>
                    <td>
                      {signed(entry.stockCashDelta)} {unit}
                      {entry.earnedDelta > 0 && (
                        <small>
                          출금 수익 +{money(entry.earnedDelta)} 위스
                        </small>
                      )}
                      {entry.kind === "EXCHANGE" && !!entry.counterAmount && (
                        <small>
                          {entry.direction === "WIS_TO_YUS"
                            ? unit === "유스"
                              ? `${money(entry.counterAmount)} 위스에서`
                              : `${money(entry.counterAmount)} 유스로`
                            : unit === "유스"
                              ? `${money(entry.counterAmount)} 위스로`
                              : `${money(entry.counterAmount)} 유스에서`}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
        {rows?.length === 0 && (
          <p className="student-wispi-wallet-empty">
            {investing ? "보유한 주식이 없습니다." : "아직 내역이 없습니다."}
          </p>
        )}
        {!investing && (
          <StudentWisStockReadStatus
            label="거래 내역"
            loading={busy && !history}
            error={error}
            retry={() => void load(nextCursor)}
          />
        )}
        {investing && holdings.length > visible && (
          <WisStockLoadMore
            onClick={() => setVisible((count) => count + PAGE_SIZE)}
            progress={`${visible} / ${holdings.length}종목`}
          />
        )}
        {!investing && history?.hasMore && nextCursor && !error && (
          <WisStockLoadMore
            loading={busy}
            onClick={() => void load(nextCursor)}
          />
        )}
      </div>
    </>
  );
}

function isTransientHistoryFailure(cause: unknown) {
  const code = (cause as { code?: string })?.code || "";
  return !["permission-denied", "unauthenticated", "failed-precondition"].some(
    (reason) => code.includes(reason),
  );
}

export default function StudentWisStockWalletDetails({
  scope,
  state,
  graphAvailable,
  refreshToken,
  refreshDisabled,
  onRefresh,
  onTrade,
  focusHolding,
  onFocused,
}: {
  scope: WisStockScope;
  state: StudentWisStockState;
  graphAvailable: boolean;
  refreshToken: number;
  refreshDisabled: boolean;
  onRefresh: () => void;
} & HoldingActions) {
  const [selected, setSelected] = useState<WalletView>("investments");
  const view =
    selected === "graph" && !graphAvailable ? "investments" : selected;
  const version = `${state.account.revision}:${refreshToken}`;
  return (
    <section className="student-wispi-wallet-investments" aria-label="내 투자">
      <div className="student-wispi-investment-heading">
        <h2>내 투자</h2>
        <div className="student-wispi-account-actions">
          <time
            className="student-wispi-muted"
            dateTime={new Date(state.serverNowMs).toISOString()}
          >
            {date.format(state.serverNowMs)} 조회
          </time>
          <button
            type="button"
            aria-label="주식 계좌 새로고침"
            disabled={refreshDisabled}
            onClick={onRefresh}
          >
            새로고침
          </button>
        </div>
      </div>
      <div
        className="student-wispi-wallet-filters"
        role="group"
        aria-label="투자 항목"
      >
        {(Object.keys(views) as WalletView[])
          .filter((key) => key !== "graph" || graphAvailable)
          .map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === view}
              onClick={() => setSelected(key)}
            >
              {views[key]}
            </button>
          ))}
      </div>
      <WalletTable
        key={version}
        view={view}
        scope={scope}
        state={state}
        onTrade={onTrade}
        focusHolding={focusHolding}
        onFocused={onFocused}
      />
      {graphAvailable && (
        <StudentWisStockWalletChart
          key={`${version}:${state.marketRevision}`}
          scope={scope}
          active={view === "graph"}
        />
      )}
    </section>
  );
}
