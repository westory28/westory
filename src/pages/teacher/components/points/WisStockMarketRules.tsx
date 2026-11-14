import { useEffect, useId, useRef, useState } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import {
  normalizeWisStockMarketRules,
  WIS_STOCK_RULE_LIMITS,
} from "../../../../../functions/wisStockMarketRules.mjs";
import {
  isWisStockRevisionConflict,
  saveWisStockMarketRules,
  wisStockErrorMessage,
  type WisStockConfig,
  type WisStockManagement,
  type WisStockMarketRules as MarketRules,
} from "../../../../lib/wisStocksClient";
import "./WisStockMarketRules.css";

const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
};
type NumericKey = {
  [K in keyof MarketRules]: MarketRules[K] extends number ? K : never;
}[keyof MarketRules];
const editableRules = (rules: MarketRules) =>
  JSON.stringify({ ...rules, halted: false });
export default function WisStockMarketRules({
  market,
  config,
  canManage,
  busy,
  onBusyChange,
  onSaved,
  onReload,
}: {
  market: WisStockManagement;
  config: WisStockConfig;
  canManage: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: (market: WisStockManagement) => WisStockManagement | null;
  onReload: () => Promise<WisStockManagement | undefined>;
}) {
  const [draft, setDraft] = useState<MarketRules>(() =>
    structuredClone(market.rules),
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const inputId = useId();
  const baseline = useRef(market.rules);
  const active = useRef(true);
  const { showToast } = useAppToast();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const previous = baseline.current;
    setDraft((current) =>
      editableRules(current) === editableRules(previous)
        ? structuredClone(market.rules)
        : { ...current, halted: market.rules.halted },
    );
    baseline.current = market.rules;
  }, [market.rules]);
  const dirty = editableRules(draft) !== editableRules(market.rules);
  const set = <K extends keyof MarketRules>(key: K, value: MarketRules[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const input = (
    key: NumericKey,
    label: string,
    unit: string,
    divisor = 1,
    help?: string,
  ) => (
    <div key={key} className="wis-stock-rules__field">
      <div className="wis-stock-rules__label">
        <label htmlFor={`${inputId}-${key}`}>{label}</label>
        {help && (
          <InfoHelp label={label}>
            <p>{help}</p>
          </InfoHelp>
        )}
      </div>
      <div className="wis-stock-rules__value">
        <input
          id={`${inputId}-${key}`}
          aria-label={`${label}${unit ? ` (${unit})` : ""}`}
          type="number"
          min={WIS_STOCK_RULE_LIMITS[key][0] / divisor}
          max={WIS_STOCK_RULE_LIMITS[key][1] / divisor}
          step={divisor === 1 ? 1 : 0.01}
          required
          value={Number.isFinite(draft[key]) ? draft[key] / divisor : ""}
          onChange={(event) =>
            set(key, Math.round(event.target.valueAsNumber * divisor))
          }
        />
        {unit && (
          <span className="wis-stock-rules__unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy || !dirty || conflict) return;
    try {
      normalizeWisStockMarketRules(draft);
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    onBusyChange(true);
    setError("");
    try {
      const result = await saveWisStockMarketRules(
        config,
        market.revision,
        draft,
      );
      if (!active.current) return;
      const accepted = onSaved(result);
      if (!accepted) return;
      setDraft(structuredClone(accepted.rules));
      baseline.current = accepted.rules;
      showToast({ title: "시장 규칙을 저장했습니다.", tone: "success" });
    } catch (failure) {
      if (active.current) {
        setError(wisStockErrorMessage(failure));
        setConflict(isWisStockRevisionConflict(failure));
      }
    } finally {
      if (active.current) onBusyChange(false);
    }
  };
  return (
    <form
      className="wis-stock-rules wis-stock-rules--compact"
      aria-label="시장 규칙"
      onSubmit={save}
    >
      {error && (
        <div className="wis-stocks__error" role="alert">
          <p>{error}</p>
          {conflict && (
            <>
              <span>수정 내용은 유지됩니다.</span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await onReload()) {
                    setConflict(false);
                    setError("");
                  }
                }}
              >
                최신 자료 확인
              </button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={!canManage || busy}>
        <fieldset className="wis-stock-rules__section">
          <legend>시장 운영</legend>
          <div className="wis-stock-rules__schedule">
            <div className="wis-stock-rules__weekdays">
              <span className="wis-stock-rules__label">거래 요일</span>
              <div
                className="wis-stock-rules__days"
                role="group"
                aria-label="거래 요일"
              >
                {["일", "월", "화", "수", "목", "금", "토"].map(
                  (label, day) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={draft.tradingDays.includes(day)}
                        onChange={(event) =>
                          set(
                            "tradingDays",
                            event.target.checked
                              ? [...draft.tradingDays, day].sort()
                              : draft.tradingDays.filter(
                                  (item) => item !== day,
                                ),
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ),
                )}
              </div>
            </div>
            {!draft.tradingDays.length && (
              <p className="wis-stocks__error">
                거래 요일을 하나 이상 선택해 주세요.
              </p>
            )}
            <div className="wis-stock-rules__hours">
              <label>
                시작 시각 (한국)
                <input
                  type="time"
                  required
                  value={time(draft.openMinuteKst)}
                  onChange={(event) =>
                    set("openMinuteKst", minutes(event.target.value))
                  }
                />
              </label>
              <label>
                <span>
                  종료 시각 (한국)
                  <InfoHelp label="종료 시각">
                    <p>00:00은 다음 날 자정에 종료하는 설정입니다.</p>
                  </InfoHelp>
                </span>
                <input
                  type="time"
                  required
                  aria-label="종료 시각 (한국)"
                  value={time(draft.closeMinuteKst % 1440)}
                  onChange={(event) =>
                    set(
                      "closeMinuteKst",
                      event.target.value === "00:00"
                        ? 1440
                        : minutes(event.target.value),
                    )
                  }
                />
              </label>
            </div>
            {draft.openMinuteKst >= draft.closeMinuteKst && (
              <p className="wis-stocks__error">
                종료 시각은 시작 시각보다 늦어야 합니다.
              </p>
            )}
          </div>
        </fieldset>
        <fieldset className="wis-stock-rules__section">
          <legend>주문 한도</legend>
          <div className="wis-stock-rules__fields">
            {input("maxOrderQuantity", "1회 주문 수량", "주")}
            {input("maxOrderAmount", "1회 주문 금액", "위스")}
            {input("dailyBuyLimit", "하루 매수 금액", "위스")}
            {input("dailyOrderLimit", "하루 주문 횟수", "회")}
          </div>
        </fieldset>
        <fieldset className="wis-stock-rules__section">
          <legend>주문 접수</legend>
          <div className="wis-stock-rules__fields">
            {input("cooldownSeconds", "주문 간격", "초")}
            {input("quoteTtlSeconds", "시세 유효 시간", "초")}
            {input(
              "maxSlippageBps",
              "허용 가격 변화",
              "%",
              100,
              "가격을 확인한 뒤 실제 주문까지 달라져도 허용하는 가격 차이입니다.",
            )}
          </div>
        </fieldset>
        <fieldset className="wis-stock-rules__section">
          <legend>주식계좌 한도</legend>
          <div className="wis-stock-rules__fields">
            {input("maxHoldingQuantity", "종목별 보유 수량", "주")}
            {input(
              "maxConcentrationBps",
              "종목별 최대 비중",
              "%",
              100,
              "주식계좌의 위스와 보유 주식 평가액을 합친 예시 자산에서 한 종목이 차지할 수 있는 비율입니다. 일반 지갑의 위스는 포함하지 않습니다.",
            )}
            {input(
              "minimumCashReserve",
              "주식계좌 최소 잔액",
              "위스",
              1,
              "매수 금액과 수수료, 대기 주문의 예약금을 제외한 뒤에도 주식계좌에 남아 있어야 하는 위스입니다. 일반 지갑 잔액은 계산하지 않으며, 매도나 출금의 최소 잔액을 정하는 항목은 아닙니다.",
            )}
          </div>
        </fieldset>
        <fieldset className="wis-stock-rules__section">
          <legend>수수료·정산</legend>
          <div className="wis-stock-rules__fields">
            {input("buyFeeBps", "매수 수수료", "%", 100)}
            {input("sellFeeBps", "매도 수수료", "%", 100)}
          </div>
          <dl className="wis-stock-rules__settlement">
            <div>
              <dt>주식 계좌 입금 한도</dt>
              <dd>
                일반 현재 위스의 50% · 24시간 간격
                <InfoHelp label="주식 계좌 50% 한도">
                  <p>
                    한 번에 일반 지갑 현재 위스의 50%까지 입금할 수 있습니다.
                    입금 성공 후 24시간이 지나야 다시 입금할 수 있고, 다음
                    한도는 그때의 일반 지갑 잔액으로 계산합니다. 출금·매매·종목
                    변경은 이 대기 시간을 초기화하지 않습니다. 주식 계좌 잔액과
                    보유 주식은 일반 위스 순위에 포함하지 않습니다.
                  </p>
                </InfoHelp>
              </dd>
            </div>
            <div>
              <dt>정산 방식</dt>
              <dd>
                교사 공급 시장
                <InfoHelp label="주문 접수와 체결">
                  <p>
                    교사가 공급하는 중앙시장에서 매수·매도합니다. 주문은 접수할
                    때 확인한 가격으로 고정되며, 무작위로 5~60초 뒤 체결됩니다.
                    매수 금액과 수수료 또는 매도 수량은 대기 중 예약하고,
                    취소하면 예약을 해제합니다. 학생 실제 거래는 닫혀 있습니다.
                  </p>
                </InfoHelp>
              </dd>
            </div>
            <div>
              <dt>손익 기준</dt>
              <dd>
                회수 원금과 실현손익 분리
                <InfoHelp label="정산과 위스 누적">
                  <p>
                    매매 손익은 주식 계좌 안에서만 반영합니다. 출금액 전액은
                    일반 현재 위스로 돌아가며, 누적 위스에는 입금 원금을 먼저
                    회수한 뒤 출금한 수익만 더합니다. 등급용 위스는 주식 거래나
                    이체로 오르지 않습니다. 학생 실제 거래는 아직 열리지
                    않았습니다.
                  </p>
                </InfoHelp>
              </dd>
            </div>
          </dl>
        </fieldset>
        <fieldset className="wis-stock-rules__section">
          <legend>가격 변동·보호 장치</legend>
          <div className="wis-stock-rules__fields">
            <label className="wis-stock-rules__toggle">
              <input
                type="checkbox"
                checked={draft.automaticPrices}
                onChange={(event) =>
                  set("automaticPrices", event.target.checked)
                }
              />
              시장 자동 가격 변동
            </label>
            {input("dailyPriceLimitBps", "하루 가격 제한폭", "%", 100)}
            {input(
              "circuitBreakerBps",
              "일시 정지 기준",
              "%",
              100,
              "한 번에 이 비율 이상 변하면 정한 시간 동안 해당 종목을 멈춥니다.",
            )}
            {input("circuitBreakerMinutes", "일시 정지 시간", "분")}
          </div>
        </fieldset>
      </fieldset>
      {canManage && (
        <div className="wis-stocks__form-actions">
          <button
            type="submit"
            className="wis-stocks__primary"
            disabled={
              busy ||
              !dirty ||
              conflict ||
              !draft.tradingDays.length ||
              draft.openMinuteKst >= draft.closeMinuteKst
            }
          >
            {busy ? "저장 중…" : "규칙 저장"}
          </button>
        </div>
      )}
    </form>
  );
}
