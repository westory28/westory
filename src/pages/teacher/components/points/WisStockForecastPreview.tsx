import { InlineLoading } from "../../../../components/common/LoadingState";
import { useMemo, useRef, useState, type ReactNode } from "react";
import InfoHelp from "../../../../components/common/InfoHelp";
import StockChart from "../../../../components/common/WisStockPriceChart";
import type {
  WisStockForecast,
  WisStockSpecialSession,
} from "../../../../lib/wisStocksClient";

const kstDate = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "Asia/Seoul",
});
const kstTime = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const kstDayKey = (ms: number) =>
  new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const money = (value: number) => value.toLocaleString("ko-KR");
const clock = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});

export function WisStockSpecialSessions({
  sessions,
}: {
  sessions: WisStockSpecialSession[];
}) {
  if (!sessions.length) return null;
  return (
    <section className="wis-stock-catalog__sessions" aria-label="특별장 일정">
      <div className="wis-stock-catalog__section-title">
        <h3>특별장 일정</h3>
        <InfoHelp label="특별장 시세 기준">
          <p>
            자동 시세가 켜진 거래일에 정상 거래·매도 전용 종목에 적용합니다.
            종목별 수동 시세도 포함합니다. 첫 유효 회차부터 마감 회차까지
            목표가로 움직이며, 당일 상장 종목은 상장가를 기준으로 합니다.
            목표가는 하락일에 정수 위스로 반올림하고 상승일에 올림합니다. 종목별
            가격 한도를 넘으면 필요한 만큼 한도를 넓히며, 모든 시세는
            1~1,000,000위스 안에서 정합니다.
          </p>
        </InfoHelp>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">거래일 (한국 시각)</th>
            <th scope="col">특별장</th>
            <th scope="col">전일 종가 대비 목표</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.dayKey}>
              <td>
                <time dateTime={session.dayKey}>
                  {kstDate.format(new Date(session.dayKey + "T00:00:00+09:00"))}
                </time>
              </td>
              <th scope="row">{session.label}</th>
              <td className={session.changeBps < 0 ? "is-down" : "is-up"}>
                {session.changeBps < 0 ? "" : "+"}
                {session.changeBps / 100}%{session.changeBps > 0 && " 이상"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Remounted on scope, selection and management revision changes. One request per click. */
export default function WisStockForecastPreview({
  stockId,
  stockName,
  currentLabel,
  readForecast,
  children,
}: {
  stockId: string;
  stockName: string;
  currentLabel: string;
  readForecast: (stockId: string) => Promise<WisStockForecast>;
  children: ReactNode;
}) {
  const [showPlan, setShowPlan] = useState(false);
  const [forecast, setForecast] = useState<WisStockForecast | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState("");
  const inFlight = useRef(false);
  const load = async () => {
    setShowPlan(true);
    if (inFlight.current || forecast) return;
    inFlight.current = true;
    setError("");
    try {
      setForecast(await readForecast(stockId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "예정 시세를 불러오지 못했습니다.",
      );
    } finally {
      inFlight.current = false;
    }
  };
  const last = forecast?.history.at(-1);
  const byDay = useMemo(() => {
    const map = new Map<string, WisStockForecast["history"]>();
    for (const point of forecast?.history ?? []) {
      const key = kstDayKey(point.atMs);
      const points = map.get(key);
      if (points) points.push(point);
      else map.set(key, [point]);
    }
    return map;
  }, [forecast]);
  const activeDay =
    day || (forecast?.history[0] ? kstDayKey(forecast.history[0].atMs) : "");
  return (
    <>
      <div
        className="wis-stock-catalog__filters"
        role="group"
        aria-label="시세 보기"
      >
        <button
          type="button"
          aria-pressed={!showPlan}
          onClick={() => setShowPlan(false)}
        >
          {currentLabel}
        </button>
        <button
          type="button"
          aria-pressed={showPlan}
          onClick={() => void load()}
        >
          운영 예정 시세
        </button>
      </div>
      {!showPlan ? (
        children
      ) : (
        <section
          className="wis-stock-catalog__forecast"
          aria-label="운영 예정 시세"
        >
          <div className="wis-stock-catalog__section-title">
            <h3>{stockName} 예정 시세</h3>
            <InfoHelp label="운영 예정 시세 기준">
              <p>
                조회 시점의 운영 설정과 상장·종료 일정으로 계산합니다. 이후 설정
                변경, 거래 중지 또는 시세 갱신 지연에 따라 실제 가격이 달라질 수
                있습니다.
              </p>
            </InfoHelp>
          </div>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => void load()}>
                다시 조회
              </button>
            </div>
          ) : !forecast ? (
            <InlineLoading />
          ) : (
            <>
              <p className="wis-stock-catalog__range">
                {kstTime.format(forecast.asOfMs)} 조회 · 계획 종료{" "}
                {kstTime.format(forecast.endsAtMs)}
              </p>
              {last ? (
                <>
                  <StockChart
                    stock={{
                      id: stockId,
                      settings: { name: stockName + " 예정 시세" },
                      price: last.price,
                      updatedAtMs: last.atMs,
                      history: forecast.history,
                    }}
                    days={Infinity}
                    variant="candlestick"
                  />
                  <dl className="wis-stock-catalog__event-prices">
                    {forecast.specialSessions.map((session) => {
                      const close = byDay.get(session.dayKey)?.at(-1);
                      return close ? (
                        <div key={session.dayKey}>
                          <dt>{kstDate.format(close.atMs)} 마지막 예정가</dt>
                          <dd>{money(close.price)} 위스</dd>
                        </div>
                      ) : null;
                    })}
                  </dl>
                  <div className="wis-stock-catalog__filters">
                    <label>
                      10분 예정가
                      <select
                        aria-label="10분 예정가 거래일"
                        value={activeDay}
                        onChange={(event) => setDay(event.target.value)}
                      >
                        {Array.from(byDay, ([key, points]) => (
                          <option key={key} value={key}>
                            {kstDate.format(points[0].atMs)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div
                    key={activeDay}
                    className="wis-stock-catalog__slots"
                    role="region"
                    aria-label="거래일별 10분 예정가"
                    tabIndex={0}
                  >
                    <table aria-label="10분 예정가">
                      <thead>
                        <tr>
                          <th scope="col">예정 시각 (한국 시각)</th>
                          <th scope="col">예정가</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byDay.get(activeDay)?.map((point) => (
                          <tr key={point.atMs}>
                            <th scope="row">{clock.format(point.atMs)}</th>
                            <td>{money(point.price)} 위스</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p>조회 기간에 예정된 시세가 없습니다.</p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
