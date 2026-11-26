import { useEffect, useState } from "react";
import {
  useStudentWisStockAccount,
  useWisStockFxRate,
} from "../../../../hooks/useStudentWisStocks";
import { OVERSEAS_STOCK_VENUE } from "../../../../lib/studentWisStockVenue";
import type {
  StudentWisStockState,
  WisStockScope,
} from "../../../../lib/studentWisStockTypes";
import { yusToWis } from "../../../../../functions/wisStockFx.mjs";
import InfoHelp from "../../../../components/common/InfoHelp";
import StudentWisStockAccountPanel from "./StudentWisStockAccountPanel";
import StudentWisStockOverseasAccountPanel from "./StudentWisStockOverseasAccountPanel";

const money = (n: number) => n.toLocaleString("ko-KR");
/** Cash plus holdings at the received quotes; null while any quote is missing. */
function accountValue(state: StudentWisStockState | null) {
  if (!state) return null;
  const prices = new Map(state.stocks.map((stock) => [stock.id, stock.price]));
  let total = state.account.stockCash;
  for (const position of state.account.positions) {
    if (!position.quantity) continue;
    const price = prices.get(position.stockId);
    if (price === undefined) return null;
    total += price * position.quantity;
  }
  return total;
}

/** One stock account with a Wis side (domestic) and a 유스 side (overseas). */
export default function StudentWisStockAccountView({
  scope,
  ownerKey,
  tradingEnabled,
  tradingEpoch,
  overseasOpened,
  overseasTradingEnabled,
  overseasTradingEpoch,
  onOpenExchange,
  initialSide = "WIS",
}: {
  initialSide?: "WIS" | "YUS";
  scope: WisStockScope;
  ownerKey: string;
  tradingEnabled: boolean;
  tradingEpoch?: number;
  overseasOpened: boolean;
  overseasTradingEnabled: boolean;
  overseasTradingEpoch?: number;
  onOpenExchange: () => void;
}) {
  const [side, setSide] = useState<"WIS" | "YUS">(initialSide);
  useEffect(() => setSide(initialSide), [ownerKey, initialSide]);
  const home = useStudentWisStockAccount(true);
  const abroad = useStudentWisStockAccount(
    overseasOpened,
    OVERSEAS_STOCK_VENUE,
  );
  const fx = useWisStockFxRate(overseasOpened);
  const rate = fx.status === "ready" && fx.data ? fx.data.rate : null;
  const homeValue = accountValue(home.status === "ready" ? home.data : null);
  const abroadValue = overseasOpened
    ? accountValue(abroad.status === "ready" ? abroad.data : null)
    : 0;
  const abroadInWis =
    abroadValue === null
      ? null
      : rate
        ? yusToWis(abroadValue, rate)
        : abroadValue
          ? null
          : 0;
  const total =
    homeValue === null || abroadInWis === null ? null : homeValue + abroadInWis;
  return (
    <div className="student-wispi-account-view">
      <section className="student-wispi-asset-summary" aria-label="계좌 요약">
        <div className="student-wispi-asset-total">
          <span className="student-wispi-inline">
            총자산
            <InfoHelp
              label="총자산 계산"
              sections={[
                {
                  items: [
                    "위스 계좌 잔액과 국내 주식 평가액",
                    "유스 계좌 잔액과 해외 주식 평가액을 오늘 환율로 바꾼 위스",
                    "일반 위스는 포함하지 않습니다",
                  ],
                },
              ]}
            />
          </span>
          <strong>
            {total === null ? "—" : money(total)} <small>위스</small>
          </strong>
        </div>
        <dl>
          <div>
            <dt>위스 계좌</dt>
            <dd>
              {homeValue === null ? "—" : money(homeValue)} <small>위스</small>
            </dd>
          </div>
          {overseasOpened && (
            <div>
              <dt>유스 계좌</dt>
              <dd>
                {abroadValue === null ? "—" : money(abroadValue)}{" "}
                <small>유스</small>
                {abroadInWis !== null && abroadValue !== 0 && (
                  <small className="student-wispi-balance-note">
                    ≈ {money(abroadInWis)} 위스
                  </small>
                )}
              </dd>
            </div>
          )}
        </dl>
      </section>
      {overseasOpened && (
        <div
          className="student-wispi-segments student-wispi-account-switch"
          role="group"
          aria-label="계좌 선택"
        >
          {(
            [
              ["WIS", "위스 계좌 · 국내"],
              ["YUS", "유스 계좌 · 해외"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={side === value}
              onClick={() => setSide(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {side === "WIS" || !overseasOpened ? (
        <StudentWisStockAccountPanel
          key={ownerKey}
          active
          tradingEnabled={tradingEnabled}
          tradingEpoch={tradingEpoch}
        />
      ) : (
        <StudentWisStockOverseasAccountPanel
          scope={scope}
          ownerKey={ownerKey}
          tradingEnabled={overseasTradingEnabled}
          tradingEpoch={overseasTradingEpoch}
          rate={rate}
          onOpenExchange={onOpenExchange}
        />
      )}
    </div>
  );
}
