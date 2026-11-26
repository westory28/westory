import { useEffect, useId, useRef, useState } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import {
  useStudentWisStockAccount,
  useWisStockFxRate,
} from "../../../../hooks/useStudentWisStocks";
import {
  exchangeStudentWisStockCurrency,
  studentWisStockError,
} from "../../../../lib/studentWisStockClient";
import { OVERSEAS_STOCK_VENUE } from "../../../../lib/studentWisStockVenue";
import type { WisStockScope } from "../../../../lib/studentWisStockTypes";
import {
  WIS_STOCK_FX_UNIT,
  quoteWisStockExchange,
  type WisStockFxDirection,
} from "../../../../../functions/wisStockFx.mjs";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";

const money = (value: number) => value.toLocaleString("ko-KR");
const shortDate = (dayKey: string) => {
  const [, month, day] = dayKey.split("-").map(Number);
  return `${month}.${day}`;
};
const units = {
  WIS_TO_YUS: { from: "위스", to: "유스", label: "위스 → 유스" },
  YUS_TO_WIS: { from: "유스", to: "위스", label: "유스 → 위스" },
} as const;

export default function StudentWisStockExchangePanel({
  scope,
  ownerKey,
  exchangeOpen,
  overseasOpened,
}: {
  scope: WisStockScope;
  ownerKey: string;
  /** Both markets are open and trading. */
  exchangeOpen: boolean;
  /** The overseas market has been opened to students at least once. */
  overseasOpened: boolean;
}) {
  const { showToast } = useAppToast();
  const amountId = useId();
  const fx = useWisStockFxRate(true);
  const home = useStudentWisStockAccount(true);
  const abroad = useStudentWisStockAccount(
    overseasOpened,
    OVERSEAS_STOCK_VENUE,
  );
  const [direction, setDirection] = useState<WisStockFxDirection>("WIS_TO_YUS");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setDirection("WIS_TO_YUS");
    setAmount("");
    setError("");
    setBusy(false);
  }, [ownerKey]);
  const rate = fx.status === "ready" && fx.data?.current ? fx.data.rate : null;
  const homeAvailable =
    home.status === "ready" && home.data.account.revision > 0
      ? home.data.funding.maximumWithdrawal
      : 0;
  const abroadAvailable =
    abroad.status === "ready"
      ? Math.max(
          0,
          abroad.data.account.stockCash - abroad.data.account.reservedCash,
        )
      : 0;
  const available =
    direction === "WIS_TO_YUS" ? homeAvailable : abroadAvailable;
  const parsed = /^[0-9]+$/.test(amount) ? Number(amount) : 0;
  let preview: { credit: number } | null = null;
  let problem = "";
  if (!overseasOpened) problem = "아직 해외 주식 시장이 열리지 않았습니다.";
  else if (!exchangeOpen) problem = "지금은 환전할 수 없습니다.";
  else if (fx.status === "ready" && !rate)
    problem = "오늘의 환율을 아직 받지 못했습니다. 잠시 후 다시 확인해 주세요.";
  else if (parsed > 0 && rate) {
    try {
      preview = quoteWisStockExchange({
        direction,
        amount: parsed,
        rate,
        available,
      });
    } catch (cause) {
      problem = (cause as Error).message;
    }
  }
  const ready = !!preview && !problem && !busy && home.status === "ready";
  const submit = async () => {
    if (!ready || !rate) return;
    const key = owner.current;
    setBusy(true);
    setError("");
    try {
      const result = await exchangeStudentWisStockCurrency(scope, {
        direction,
        amount: parsed,
        rate,
      });
      if (!mounted.current || owner.current !== key) return;
      setAmount("");
      const unit = units[direction];
      showToast({
        tone: "success",
        title: result.duplicate ? "이미 처리된 환전입니다." : "환전했습니다.",
        message: `${money(result.receipt.debit)} ${unit.from} → ${money(result.receipt.credit)} ${unit.to}`,
      });
    } catch (cause) {
      if (mounted.current && owner.current === key)
        setError(studentWisStockError(cause));
    } finally {
      if (mounted.current && owner.current === key) setBusy(false);
    }
  };
  const history =
    fx.status === "ready" && fx.data ? fx.data.history.slice(-7) : [];
  const unit = units[direction];
  return (
    <section className="student-wispi-exchange" aria-label="환전">
      <StudentWisStockReadStatus
        loading={fx.status === "loading"}
        error={fx.error}
        label="오늘의 환율"
      />
      <div className="student-wispi-exchange-layout">
        <section className="student-wispi-fx-rate" aria-label="오늘의 환율">
          <div className="student-wispi-inline">
            <h2>오늘의 환율</h2>
            <InfoHelp
              label="환율 기준"
              sections={[
                {
                  items: [
                    "매일 오전 7시 무렵 실제 원/달러 기준환율을 받아 그날 하루 같은 환율을 씁니다.",
                    "1,000유스는 그날의 원/달러 환율 숫자만큼의 위스와 같습니다.",
                    "환전할 때 받는 금액은 소수점 아래를 버립니다.",
                    "매수 예약금과 이벤트 지원금 원금은 환전할 수 없습니다.",
                  ],
                },
              ]}
            />
          </div>
          {fx.status === "ready" && fx.data ? (
            <>
              <p className="student-wispi-fx-main">
                <span>1,000 유스</span>
                <strong>
                  {money(fx.data.rate)} <small>위스</small>
                </strong>
              </p>
              <p className="student-wispi-muted">
                1유스 ≈ {(fx.data.rate / WIS_STOCK_FX_UNIT).toFixed(3)}위스 ·
                원/달러 {money(fx.data.krwPerUsd)}원 ·{" "}
                {shortDate(fx.data.sourceDate)} 기준
                {!fx.data.current && " · 오늘 환율 대기 중"}
              </p>
              {history.length > 1 && (
                <ol className="student-wispi-fx-history" aria-label="최근 환율">
                  {history
                    .map((point, index) => ({
                      ...point,
                      change: index
                        ? point.rate - history[index - 1].rate
                        : null,
                    }))
                    .slice(1)
                    .reverse()
                    .map((point) => (
                      <li key={point.dayKey}>
                        <span>{shortDate(point.dayKey)}</span>
                        <strong>{money(point.rate)}</strong>
                        <span
                          className={`student-wispi-change ${point.change === null || point.change === 0 ? "is-flat" : point.change > 0 ? "is-up" : "is-down"}`}
                        >
                          {point.change === null || point.change === 0
                            ? "보합"
                            : `${point.change > 0 ? "▲" : "▼"} ${money(Math.abs(point.change))}`}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
            </>
          ) : (
            fx.status === "ready" && (
              <p className="student-wispi-muted">아직 환율이 없습니다.</p>
            )
          )}
        </section>
        <form
          className="student-wispi-exchange-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2>환전하기</h2>
          <div className="student-wispi-segments" aria-label="환전 방향">
            {(["WIS_TO_YUS", "YUS_TO_WIS"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                disabled={busy}
                onClick={() => {
                  setDirection(value);
                  setAmount("");
                  setError("");
                }}
              >
                {units[value].label}
              </button>
            ))}
          </div>
          <dl className="student-wispi-balances">
            <div>
              <dt>위스 계좌 환전 가능</dt>
              <dd>
                {money(homeAvailable)} <small>위스</small>
              </dd>
            </div>
            <div>
              <dt>유스 계좌 환전 가능</dt>
              <dd>
                {money(abroadAvailable)} <small>유스</small>
              </dd>
            </div>
          </dl>
          <label className="student-wispi-exchange-amount" htmlFor={amountId}>
            <span>바꿀 {unit.from}</span>
            <input
              id={amountId}
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount}
              disabled={busy || !overseasOpened}
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^0-9]/g, ""));
                setError("");
              }}
              aria-describedby={problem ? `${amountId}-problem` : undefined}
            />
          </label>
          <div className="student-wispi-quick-amounts" aria-label="빠른 금액">
            {[25, 50, 100].map((percent) => (
              <button
                key={percent}
                type="button"
                disabled={busy || available <= 0}
                onClick={() =>
                  setAmount(
                    String(Math.floor((available * percent) / 100) || ""),
                  )
                }
              >
                {percent === 100 ? "전액" : `${percent}%`}
              </button>
            ))}
          </div>
          <p className="student-wispi-exchange-preview" aria-live="polite">
            <span>받을 {unit.to}</span>
            <strong>
              {preview ? money(preview.credit) : "—"} <small>{unit.to}</small>
            </strong>
          </p>
          {problem && parsed > 0 && (
            <p
              id={`${amountId}-problem`}
              className="student-wispi-order-problem"
              role="status"
            >
              {problem}
            </p>
          )}
          {problem && !parsed && !busy && (
            <p className="student-wispi-muted" role="status">
              {problem}
            </p>
          )}
          <button
            type="submit"
            className="student-wispi-primary"
            disabled={!ready}
          >
            {busy ? "환전 중" : `${unit.label} 환전`}
          </button>
          {error && (
            <p role="alert" className="student-wispi-error">
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
