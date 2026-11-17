import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { useStudentWisStockAccount } from "../../../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../../../lib/semesterScope";
import {
  getStudentWisStockHistory,
  studentWisStockError,
  studentWisStockNow,
  transferStudentWisStock,
} from "../../../../lib/studentWisStockClient";
import type {
  StudentWisStockHistoryEntry,
  StudentWisStockHistoryPage,
} from "../../../../lib/studentWisStockTypes";
import InfoHelp from "../../../../components/common/InfoHelp";
import "./studentWisStocks.css";

const money = (n: number) => n.toLocaleString("ko-KR");
const date = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
const historyLabels: Record<StudentWisStockHistoryEntry["kind"], string> = {
  DEPOSIT: "입금",
  EVENT_BONUS: "위스피 이벤트 보상",
  WITHDRAW: "출금",
  ORDER_ACCEPTED: "주문 접수",
  ORDER_FILLED: "체결",
  ORDER_CANCELLED: "주문 취소",
};
export default function StudentWisStockAccountPanel({
  tradingEnabled = false,
  active = true,
}: {
  tradingEnabled?: boolean;
  active?: boolean;
}) {
  const { currentUser, config, authGeneration } = useAuth();
  const scope = getYearSemester(config);
  const account = useStudentWisStockAccount(active);
  const identity = `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [direction, setDirection] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    key: string;
    error: boolean;
    text: string;
  } | null>(null);
  const [history, setHistory] = useState<{
    key: string;
    page: StudentWisStockHistoryPage;
    cursor: string;
    index: number;
  } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historySequence = useRef(0);
  const cursors = useRef<string[]>([""]);
  const historyRequest = useRef({ cursor: "", index: 0 });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      historySequence.current++;
    };
  }, []);
  useEffect(() => {
    setDirection("DEPOSIT");
    setAmount("");
    setBusy(false);
    setFeedback(null);
    setHistory(null);
    setHistoryError("");
    cursors.current = [""];
    historyRequest.current = { cursor: "", index: 0 };
    historySequence.current++;
  }, [identity]);
  useEffect(() => {
    if (account.status !== "ready") {
      historySequence.current++;
      setHistory(null);
      setHistoryBusy(false);
      setFeedback(null);
    }
  }, [account.status]);
  const loadHistory = async (cursor = "", index = 0) => {
    historyRequest.current = { cursor, index };
    const turn = ++historySequence.current,
      key = identity;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const page = await getStudentWisStockHistory(scope, cursor);
      if (
        mounted.current &&
        identityRef.current === key &&
        turn === historySequence.current
      ) {
        setHistory({ key, page, cursor, index });
        if (page.nextCursor) cursors.current[index + 1] = page.nextCursor;
      }
    } catch (error) {
      if (
        mounted.current &&
        identityRef.current === key &&
        turn === historySequence.current
      )
        setHistoryError(studentWisStockError(error));
    } finally {
      if (
        mounted.current &&
        identityRef.current === key &&
        turn === historySequence.current
      )
        setHistoryBusy(false);
    }
  };
  useEffect(() => {
    if (!active || account.status !== "ready") return;
    cursors.current = [""];
    void loadHistory();
  }, [active, identity, account.data?.account.revision]);
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
    if (!state || busy || !canTransfer || !valid) return;
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
            ? `${money(parsed)} 위스를 주식 지갑에 입금했습니다.${result.bonusAmount ? ` 이벤트 보상 ${money(result.bonusAmount)} 위스도 지급되었습니다.` : ""}`
            : `${money(parsed)} 위스를 출금했습니다.${result.receipt?.withdrawnProfit ? ` 누적 위스에 수익 ${money(result.receipt.withdrawnProfit)} 위스가 반영되었습니다.` : ""}`,
      });
    } catch (error) {
      if (mounted.current && identityRef.current === key)
        setFeedback({ key, error: true, text: studentWisStockError(error) });
    } finally {
      if (mounted.current && identityRef.current === key) setBusy(false);
    }
  };
  if (!active) return null;
  return (
    <section className="student-wispi-account" aria-label="주식 지갑">
      {account.status === "loading" && (
        <p role="status">주식 지갑을 불러오는 중입니다.</p>
      )}
      {account.status === "error" && (
        <div role="alert" className="student-wispi-error">
          <p>{account.error}</p>
          <button type="button" onClick={account.retry}>
            다시 불러오기
          </button>
        </div>
      )}
      {state && (
        <>
          <div className="student-wispi-account-actions">
            <button
              type="button"
              onClick={account.retry}
              disabled={busy}
              aria-label="주식 지갑 잔액 새로고침"
            >
              잔액 새로고침
            </button>
          </div>
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
            <div>
              <dt>출금 가능</dt>
              <dd>
                {money(state.funding.maximumWithdrawal)} <small>위스</small>
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
            <div className="student-wispi-inline">
              <div className="student-wispi-segments" aria-label="입출금 선택">
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
                    disabled={busy}
                  >
                    {value === "DEPOSIT" ? "입금" : "출금"}
                  </button>
                ))}
              </div>
              <InfoHelp label="주식 지갑 입출금 기준">
                <p>
                  입금은 일반 위스의 절반까지 할 수 있으며, 입금한 뒤 24시간이
                  지나야 다시 입금할 수 있습니다. 출금한 금액은 일반 위스로
                  돌아가고, 본인이 입금한 원금을 제외한 수익만 누적 위스에
                  더해집니다. 예약된 위스는 출금할 수 없습니다.
                </p>
                <p>
                  이벤트 지원금 원금은 위스피 매수에만 사용할 수 있습니다.
                  지원금으로 얻은 수익은 손실을 만회한 뒤 출금할 수 있습니다.
                </p>
              </InfoHelp>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void transfer();
              }}
            >
              <label>
                <span>위스 금액</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={amount}
                  onChange={(event) =>
                    setAmount(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  disabled={busy || !canTransfer}
                  aria-describedby="wispi-transfer-limit"
                />
              </label>
              <button
                className="student-wispi-primary"
                type="submit"
                disabled={busy || !canTransfer || !valid}
              >
                {busy
                  ? "처리 중"
                  : direction === "DEPOSIT"
                    ? "주식 지갑에 입금"
                    : "일반 위스로 출금"}
              </button>
            </form>
            <p id="wispi-transfer-limit" className="student-wispi-muted">
              {direction === "DEPOSIT" ? "입금" : "출금"} 가능 {money(maximum)}{" "}
              위스
              {direction === "DEPOSIT" &&
              state.funding.nextDepositAtMs > studentWisStockNow(state)
                ? ` · 다음 입금 ${date.format(state.funding.nextDepositAtMs)}`
                : ""}
              {direction === "WITHDRAW" &&
              (state.account.eventBonusTotal || 0) > 0
                ? " · 이벤트 지원금 원금 제외"
                : ""}
            </p>
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
          <section className="student-wispi-section" aria-label="내 보유 주식">
            <h2>보유 주식</h2>
            {state.account.positions.filter((position) => position.quantity > 0)
              .length === 0 ? (
              <p className="student-wispi-muted">보유한 주식이 없습니다.</p>
            ) : (
              <ul className="student-wispi-list">
                {state.account.positions
                  .filter((position) => position.quantity > 0)
                  .map((position) => (
                    <li key={position.stockId}>
                      <div>
                        <strong>
                          {state.stocks.find(
                            (stock) => stock.id === position.stockId,
                          )?.settings.name || "이전 종목"}
                        </strong>
                        <small>
                          매수 원가 {money(position.costBasis)} 위스
                          {position.reservedSellQuantity > 0
                            ? ` · 매도 예약 ${money(position.reservedSellQuantity)}주`
                            : ""}
                        </small>
                      </div>
                      <strong>{money(position.quantity)}주</strong>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
      <section
        className="student-wispi-section"
        aria-label="주식 입출금과 매매 내역"
      >
        <h2>입출금·매매 내역</h2>
        {account.status === "ready" && historyError && (
          <div role="alert" className="student-wispi-error">
            <p>{historyError}</p>
            <button
              type="button"
              onClick={() =>
                void loadHistory(
                  historyRequest.current.cursor,
                  historyRequest.current.index,
                )
              }
            >
              다시 불러오기
            </button>
          </div>
        )}
        {historyBusy && <p role="status">내역을 불러오는 중입니다.</p>}
        {account.status === "ready" && history?.key === identity && (
          <>
            {history.page.entries.length === 0 ? (
              <p className="student-wispi-muted">아직 내역이 없습니다.</p>
            ) : (
              <ol className="student-wispi-list">
                {history.page.entries.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>
                        {entry.automaticSettlement === "GRADUATION"
                          ? "종목 졸업 정산"
                          : historyLabels[entry.kind] || "거래 내역"}
                        {entry.side
                          ? ` · ${entry.side === "BUY" ? "매수" : "매도"}`
                          : ""}
                      </strong>
                      <small>
                        {date.format(entry.atMs)}
                        {entry.stockId
                          ? ` · ${state?.stocks.find((stock) => stock.id === entry.stockId)?.settings.name || "이전 종목"}`
                          : ""}
                        {entry.quantity ? ` ${money(entry.quantity)}주` : ""}
                      </small>
                      {entry.earnedDelta > 0 && (
                        <small>
                          출금 수익 +{money(entry.earnedDelta)} 위스
                        </small>
                      )}
                    </div>
                    <strong>
                      {entry.stockCashDelta > 0 ? "+" : ""}
                      {money(entry.stockCashDelta)} <small>위스</small>
                    </strong>
                  </li>
                ))}
              </ol>
            )}
            <nav
              className="student-wispi-pagination"
              aria-label="주식 내역 페이지"
            >
              <button
                type="button"
                disabled={historyBusy || history.index === 0}
                onClick={() =>
                  void loadHistory(
                    cursors.current[history.index - 1] || "",
                    history.index - 1,
                  )
                }
              >
                이전
              </button>
              <span>{history.index + 1}페이지</span>
              <button
                type="button"
                disabled={
                  historyBusy ||
                  !history.page.hasMore ||
                  !history.page.nextCursor
                }
                onClick={() =>
                  void loadHistory(history.page.nextCursor, history.index + 1)
                }
              >
                다음
              </button>
            </nav>
          </>
        )}
      </section>
    </section>
  );
}
