import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { useStudentWisStockAccount } from "../../../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../../../lib/semesterScope";
import type { StudentWisStockState } from "../../../../lib/studentWisStockTypes";
import {
  studentWisStockError,
  studentWisStockNow,
  transferStudentWisStock,
} from "../../../../lib/studentWisStockClient";
import InfoHelp from "../../../../components/common/InfoHelp";
import StudentWisStockBonusClaim from "./StudentWisStockBonusClaim";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import StudentWisStockWalletOrders, {
  type WalletOrderTarget,
} from "./StudentWisStockWalletOrders";
import StudentWisStockWalletDetails from "./StudentWisStockWalletDetails";
import "./studentWisStocks.css";

const money = (n: number) => n.toLocaleString("ko-KR");
const date = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
export default function StudentWisStockAccountPanel({
  tradingEnabled = false,
  tradingEpoch,
  active = true,
}: {
  tradingEnabled?: boolean;
  tradingEpoch?: number;
  active?: boolean;
}) {
  const { currentUser, config, authGeneration } = useAuth();
  const fundingDescriptionId = useId();
  const scope = getYearSemester(config);
  const account = useStudentWisStockAccount(active);
  const identity = `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}`;
  const ownerKey = `${currentUser?.uid}:${scope.year}:${scope.semester}`;
  const [ticket, setTicket] = useState<{
    ownerKey: string;
    target: WalletOrderTarget;
  } | null>(null);
  const [focusHolding, setFocusHolding] = useState<string>();
  useEffect(() => {
    if (ticket && ticket.ownerKey !== ownerKey) {
      setTicket(null);
      setFocusHolding(undefined);
    }
  }, [ticket, ownerKey]);
  const mayTrade = tradingEnabled && tradingEpoch !== undefined;
  const checkedEntry = useRef("");
  useEffect(() => {
    if (!active) {
      checkedEntry.current = "";
      return;
    }
    if (account.status !== "ready" || checkedEntry.current === identity) return;
    checkedEntry.current = identity;
    if (
      account.data.account.positions.some(
        (position) => position.quantity > 0,
      ) &&
      Date.now() - (account.data.clientReceivedAtMs ?? 0) >= 30_000
    )
      account.retry();
  }, [active, identity, account.status, account.data, account.retry]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [direction, setDirection] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshFrom = useRef<StudentWisStockState | null>(null);
  const working = busy || claimBusy;
  const [feedback, setFeedback] = useState<{
    key: string;
    error: boolean;
    text: string;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setDirection("DEPOSIT");
    setAmount("");
    setBusy(false);
    setClaimBusy(false);
    setFeedback(null);
  }, [identity]);
  useEffect(() => {
    if (account.status !== "ready") setFeedback(null);
  }, [account.status]);
  const state = account.data;
  const canTransfer = tradingEnabled && account.status === "ready";
  const parsed = /^[0-9]+$/.test(amount) ? Number(amount) : 0;
  const maximum = state
    ? direction === "DEPOSIT"
      ? state.funding.maximumDeposit
      : state.funding.maximumWithdrawal
    : 0;
  const valid = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum;
  const transfer = async () => {
    if (!state || working || !canTransfer || !valid) return;
    const key = identity;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await transferStudentWisStock(scope, direction, parsed);
      if (!mounted.current || identityRef.current !== key) return;
      setAmount("");
      setFeedback({
        key,
        error: false,
        text:
          direction === "DEPOSIT"
            ? `${money(parsed)} 위스를 주식 지갑에 입금했습니다.`
            : `${money(parsed)} 위스를 출금했습니다.${result.receipt?.withdrawnProfit ? ` 누적 위스에 수익 ${money(result.receipt.withdrawnProfit)} 위스가 반영되었습니다.` : ""}`,
      });
    } catch (error) {
      if (mounted.current && identityRef.current === key)
        setFeedback({ key, error: true, text: studentWisStockError(error) });
    } finally {
      if (mounted.current && identityRef.current === key) setBusy(false);
    }
  };

  if (!active && !ticket) return null;
  return (
    <section
      hidden={!active}
      className="student-wispi-account"
      aria-label="주식 지갑"
    >
      <StudentWisStockReadStatus
        loading={account.status === "loading"}
        error={account.error}
        label="주식 지갑"
        retry={account.retry}
      />
      <StudentWisStockWalletOrders
        key={ownerKey}
        scope={scope}
        account={account}
        tradingEnabled={active && mayTrade}
        tradingEpoch={tradingEpoch}
        target={ticket?.ownerKey === ownerKey ? ticket.target : null}
        onClose={() => {
          if (
            ticket?.ownerKey === ownerKey &&
            state?.account.positions.some(
              (p) => p.stockId === ticket.target.stockId && p.quantity > 0,
            )
          )
            setFocusHolding(ticket.target.stockId);
          setTicket(null);
        }}
      />
      {active && state && (
        <div className="student-wispi-wallet-layout">
          <section
            className="student-wispi-wallet-funding"
            aria-label="계좌 입출금"
          >
            <h2>계좌 입출금</h2>
            <dl className="student-wispi-balances">
              <div>
                <dt>주식 지갑</dt>
                <dd>
                  {money(state.account.stockCash)} <small>위스</small>
                  {state.account.reservedCash > 0 && (
                    <small className="student-wispi-balance-note">
                      매수 예약 {money(state.account.reservedCash)} 위스
                    </small>
                  )}
                </dd>
              </div>
              <div>
                <dt>매수 가능</dt>
                <dd>
                  {money(
                    Math.max(
                      0,
                      state.account.stockCash - state.account.reservedCash,
                    ),
                  )}{" "}
                  <small>위스</small>
                </dd>
              </div>
              <div
                id={fundingDescriptionId}
                aria-live="polite"
                aria-atomic="true"
              >
                <dt>{direction === "DEPOSIT" ? "입금 가능" : "출금 가능"}</dt>
                <dd>
                  {money(maximum)} <small>위스</small>
                </dd>
              </div>
              <div>
                <dt>일반 위스</dt>
                <dd>
                  {money(state.mainCash)} <small>위스</small>
                </dd>
              </div>
            </dl>
            <div className="student-wispi-transfer">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void transfer();
                }}
              >
                <div className="student-wispi-inline">
                  <div
                    className="student-wispi-segments"
                    aria-label="입출금 선택"
                  >
                    {(["DEPOSIT", "WITHDRAW"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={direction === value}
                        onClick={() => {
                          setDirection(value);
                          setAmount("");
                          setFeedback(null);
                        }}
                        disabled={working}
                      >
                        {value === "DEPOSIT" ? "입금" : "출금"}
                      </button>
                    ))}
                  </div>
                  <InfoHelp label="주식 지갑 입출금 기준">
                    <p>
                      입금은 일반 위스의 절반까지 할 수 있으며, 입금한 뒤
                      24시간이 지나야 다시 입금할 수 있습니다. 출금한 금액은
                      일반 위스로 돌아가고, 본인이 입금한 원금을 제외한 수익만
                      누적 위스에 더해집니다. 예약된 위스는 출금할 수 없습니다.
                    </p>
                    <p>
                      이벤트 지원금 원금은 위스피 매수에만 사용할 수 있습니다.
                      지원금으로 얻은 수익은 손실을 만회한 뒤 출금할 수
                      있습니다.
                    </p>
                  </InfoHelp>
                </div>
                <label>
                  <span>위스 금액</span>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value.replace(/[^0-9]/g, ""))
                    }
                    disabled={working || !canTransfer}
                    aria-describedby={fundingDescriptionId}
                  />
                </label>
                <button
                  className="student-wispi-primary"
                  type="submit"
                  disabled={working || !canTransfer || !valid}
                >
                  {busy
                    ? "처리 중"
                    : direction === "DEPOSIT"
                      ? "주식 지갑에 입금"
                      : "일반 위스로 출금"}
                </button>
              </form>
              {direction === "DEPOSIT" &&
                state.funding.nextDepositAtMs > studentWisStockNow(state) && (
                  <p className="student-wispi-muted">
                    다음 입금 {date.format(state.funding.nextDepositAtMs)}
                  </p>
                )}
              {direction === "WITHDRAW" &&
                (state.account.eventBonusTotal || 0) > 0 && (
                  <p className="student-wispi-muted">이벤트 지원금 원금 제외</p>
                )}
              {!canTransfer && (
                <p className="student-wispi-muted">
                  지금은 입출금할 수 없습니다.
                </p>
              )}
              {feedback?.key === identity && (
                <p
                  role={feedback.error ? "alert" : "status"}
                  className={feedback.error ? "student-wispi-error" : ""}
                >
                  {feedback.text}
                </p>
              )}
            </div>
            <StudentWisStockBonusClaim
              scope={scope}
              identity={identity}
              revision={state.account.revision}
              refreshToken={refreshVersion}
              tradingEnabled={tradingEnabled}
              disabled={working}
              onBusyChange={setClaimBusy}
            />
          </section>
          <StudentWisStockWalletDetails
            key={identity}
            scope={scope}
            state={state}
            graphAvailable={tradingEnabled}
            onTrade={
              mayTrade
                ? (stockId) =>
                    setTicket({
                      ownerKey,
                      target: { stockId, entry: "holding" },
                    })
                : undefined
            }
            focusHolding={focusHolding}
            onFocused={() => setFocusHolding(undefined)}
            refreshToken={
              refreshFrom.current === state
                ? refreshVersion - 1
                : refreshVersion
            }
            refreshDisabled={working || refreshFrom.current === state}
            onRefresh={() => {
              refreshFrom.current = state;
              account.retry();
              setRefreshVersion((value) => value + 1);
            }}
          />
        </div>
      )}
      {active && !!state?.account.recentOrders.length && (
        <section className="student-wispi-section" aria-label="최근 주문 결과">
          <h2>최근 주문</h2>
          <ul className="student-wispi-list">
            {state.account.recentOrders.map((order) => (
              <li key={order.id}>
                <div>
                  <strong>
                    {state.stocks.find((stock) => stock.id === order.stockId)
                      ?.settings.name || "주식"}{" "}
                    · {order.side === "BUY" ? "매수" : "매도"}{" "}
                    {money(order.quantity)}주
                  </strong>
                  <small>접수 가격 {money(order.unitPrice)} 위스</small>
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
    </section>
  );
}
