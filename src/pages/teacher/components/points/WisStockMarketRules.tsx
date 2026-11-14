import { useEffect, useRef, useState } from "react";
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

const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [hours, minute] = value.split(":").map(Number);
  return hours * 60 + minute;
};
type NumericKey = {
  [K in keyof MarketRules]: MarketRules[K] extends number ? K : never;
}[keyof MarketRules];
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
  onSaved: (market: WisStockManagement) => void;
  onReload: () => Promise<WisStockManagement | undefined>;
}) {
  const [draft, setDraft] = useState<MarketRules>(() =>
    structuredClone(market.rules),
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
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
      JSON.stringify(current) === JSON.stringify(previous)
        ? structuredClone(market.rules)
        : current,
    );
    baseline.current = market.rules;
  }, [market.rules]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(market.rules);
  const set = <K extends keyof MarketRules>(key: K, value: MarketRules[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const input = (
    key: NumericKey,
    label: string,
    divisor = 1,
    help?: string,
  ) => (
    <label key={key}>
      <span>
        {label}
        {help && (
          <InfoHelp label={label}>
            <p>{help}</p>
          </InfoHelp>
        )}
      </span>
      <input
        aria-label={label}
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
    </label>
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
      onSaved(result);
      setDraft(structuredClone(result.rules));
      baseline.current = result.rules;
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
    <form className="wis-stock-rules" aria-label="시장 규칙" onSubmit={save}>
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
        <section className="wis-stock-rules__section">
          <h2>시장 운영</h2>
          <div
            className="wis-stock-rules__days"
            role="group"
            aria-label="거래 요일"
          >
            {["일", "월", "화", "수", "목", "금", "토"].map((label, day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={draft.tradingDays.includes(day)}
                  onChange={(event) =>
                    set(
                      "tradingDays",
                      event.target.checked
                        ? [...draft.tradingDays, day].sort()
                        : draft.tradingDays.filter((item) => item !== day),
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {!draft.tradingDays.length && (
            <p className="wis-stocks__error">
              거래 요일을 하나 이상 선택해 주세요.
            </p>
          )}
          <div className="wis-stock-rules__fields">
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
          <label className="wis-stock-rules__toggle">
            <input
              type="checkbox"
              checked={draft.halted}
              onChange={(event) => set("halted", event.target.checked)}
            />
            시장 전체 거래 정지
          </label>
        </section>
        <section className="wis-stock-rules__section">
          <h2>주문 한도</h2>
          <div className="wis-stock-rules__fields">
            {input("maxOrderQuantity", "한 번에 주문할 수량 (주)")}
            {input("maxOrderAmount", "한 번에 주문할 금액 (위스)")}
            {input("dailyBuyLimit", "하루 매수 금액 (위스)")}
            {input("dailyOrderLimit", "하루 주문 횟수")}
            {input("cooldownSeconds", "주문 사이 대기 (초)")}
            {input("quoteTtlSeconds", "가격 확인 유효 시간 (초)")}
            {input(
              "maxSlippageBps",
              "허용 가격 변화 (%)",
              100,
              "가격을 확인한 뒤 실제 주문까지 달라져도 허용하는 가격 차이입니다.",
            )}
          </div>
        </section>
        <section className="wis-stock-rules__section">
          <h2>보유 한도</h2>
          <div className="wis-stock-rules__fields">
            {input("maxHoldingQuantity", "한 종목 보유 수량 (주)")}
            {input(
              "maxConcentrationBps",
              "한 종목 최대 비중 (%)",
              100,
              "보유 위스와 주식 평가액을 합친 예시 자산에서 한 종목이 차지할 수 있는 비율입니다.",
            )}
            {input("minimumCashReserve", "남겨 둘 위스")}
          </div>
        </section>
        <section className="wis-stock-rules__section">
          <h2>수수료·정산</h2>
          <div className="wis-stock-rules__fields">
            {input("buyFeeBps", "매수 수수료 (%)", 100)}
            {input("sellFeeBps", "매도 수수료 (%)", 100)}
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
        </section>
        <section className="wis-stock-rules__section">
          <h2>가격 변동·보호 장치</h2>
          <label className="wis-stock-rules__toggle">
            <input
              type="checkbox"
              checked={draft.automaticPrices}
              onChange={(event) => set("automaticPrices", event.target.checked)}
            />
            시장 자동 가격 변동
          </label>
          <div className="wis-stock-rules__fields">
            {input("dailyPriceLimitBps", "하루 가격 제한폭 (%)", 100)}
            {input(
              "circuitBreakerBps",
              "일시 정지 기준 (%)",
              100,
              "한 번에 이 비율 이상 변하면 정한 시간 동안 해당 종목을 멈춥니다.",
            )}
            {input("circuitBreakerMinutes", "일시 정지 시간 (분)")}
          </div>
        </section>
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
