import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InlineLoading } from "../../../../components/common/LoadingState";
import InfoHelp from "../../../../components/common/InfoHelp";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import WisStockPriceChart from "../../../../components/common/WisStockPriceChart";
import { useAuth } from "../../../../contexts/AuthContext";
import overseasCatalog from "../../../../../functions/wisStockOverseasCatalog.json";
import {
  catalogExitAtMs,
  catalogSessionAtMs,
} from "../../../../../functions/wisStockCatalogTimeline.mjs";
import {
  activateWisStockOverseasCatalogPlan,
  getWisStockOverseasManagement,
  isWisStockRevisionConflict,
  refreshWisStockFxRateNow,
  setWisStockOverseasMarketHalted,
  wisStockErrorMessage,
  type WisStock,
  type WisStockOverseasManagement,
} from "../../../../lib/wisStocksClient";
import "./TeacherWisStocks.css";
import "./WisStockEmergencyControl.css";

type CatalogEntry = (typeof overseasCatalog)[number];
const catalog = overseasCatalog as CatalogEntry[];
const byId = new Map(catalog.map((entry) => [entry.id, entry]));
const eras = ["신항로 개척", "절대 왕정과 중상주의", "산업 혁명", "제국주의"];
const money = (value: number) => value.toLocaleString("ko-KR");
const when = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
const exitLabel = { delist: "상장 폐지", merge: "합병", survive: "존속" };
/** The next Monday (KST) on or after today, as YYYY-MM-DD. */
const nextMonday = () => {
  const now = new Date(Date.now() + 9 * 3_600_000);
  const day = now.getUTCDay();
  now.setUTCDate(now.getUTCDate() + ((8 - day) % 7 || 7));
  return now.toISOString().slice(0, 10);
};
const dayChange = (stock: WisStock) => {
  const at = stock.updatedAtMs;
  const dayStart =
    Math.floor((at + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000;
  const previous =
    stock.history.filter((point) => point.atMs < dayStart).at(-1) ||
    stock.history[0];
  return previous ? stock.price - previous.price : 0;
};

export default function TeacherWisStockOverseas({
  year,
  semester,
  canManage,
}: {
  year: string;
  semester: string;
  canManage: boolean;
}) {
  const { showToast } = useAppToast();
  const { currentUser, authGeneration } = useAuth();
  const ownerKey = `${currentUser?.uid}:${authGeneration}:${year}:${semester}`;
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  const [market, setMarket] = useState<WisStockOverseasManagement | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [startsOn, setStartsOn] = useState(nextMonday);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flight = useRef(false);
  const load = useCallback(async () => {
    const key = owner.current;
    setLoading(true);
    setError("");
    try {
      const result = await getWisStockOverseasManagement({ year, semester });
      if (owner.current !== key) return null;
      setMarket(result);
      setConflict(false);
      return result;
    } catch (failure) {
      if (owner.current === key) setError(wisStockErrorMessage(failure));
      return null;
    } finally {
      if (owner.current === key) setLoading(false);
    }
  }, [year, semester]);
  useEffect(() => {
    setMarket(null);
    void load();
  }, [ownerKey, load]);
  const run = async (
    name: string,
    action: (revision: number) => Promise<WisStockOverseasManagement>,
    success: string,
  ) => {
    if (!market || !canManage || flight.current) return;
    const key = owner.current;
    flight.current = true;
    setBusy(name);
    setError("");
    try {
      const result = await action(market.revision);
      if (owner.current !== key) return;
      // Plan and open/close responses carry no exchange rate; keep the one
      // already shown instead of reporting it as missing.
      const responseFx = (result as Partial<WisStockOverseasManagement>).fx;
      setMarket((current) =>
        responseFx === undefined
          ? { ...result, fx: current?.fx ?? null }
          : result,
      );
      showToast({ tone: "success", title: success });
    } catch (failure) {
      if (owner.current !== key) return;
      setConflict(isWisStockRevisionConflict(failure));
      setError(wisStockErrorMessage(failure));
    } finally {
      flight.current = false;
      if (owner.current === key) setBusy("");
    }
  };
  const plan = market?.catalogSchedule?.plan ?? null;
  const open = !!market?.studentOpen && !market.rules.halted;
  const stocks = market?.stocks ?? [];
  const selected =
    stocks.find((stock) => stock.id === selectedId) ?? stocks[0] ?? null;
  const upcomingExits = useMemo(() => {
    if (!plan) return [];
    const now = Date.now();
    return catalog
      .filter((entry) => entry.exitKind !== "survive" && entry.exitSession)
      .map((entry) => ({ entry, atMs: catalogExitAtMs(entry, plan)! }))
      .filter(
        ({ entry, atMs }) =>
          atMs > now &&
          stocks.find((stock) => stock.id === entry.id)?.settings
            .tradingStatus !== "GRADUATED",
      )
      .sort((a, b) => a.atMs - b.atMs)
      .slice(0, 5);
  }, [plan, stocks]);
  const eraCounts = useMemo(
    () =>
      eras.map((era, index) => ({
        era,
        total: catalog.filter((entry) => entry.week === index + 1).length,
        listed: stocks.filter((stock) => byId.get(stock.id)?.week === index + 1)
          .length,
      })),
    [stocks],
  );
  const fx = market?.fx ?? null;
  return (
    <section className="wis-stocks__overseas" aria-label="해외 시장 관리">
      <div className="wis-stocks__toolbar">
        <div className="wis-stocks__title">
          <h2>해외 시장</h2>
          <span className="wis-stocks__closed" role="status">
            {!market
              ? "확인 중"
              : !market.studentOpen
                ? "미개장"
                : open
                  ? "거래 중"
                  : "거래 중지"}
          </span>
          <InfoHelp
            label="해외 시장 운영 기준"
            sections={[
              {
                items: [
                  "가격 단위는 유스이며 국내와 같은 10분 시세 주기를 사용",
                  "거래 시간은 시차를 두어 평일 오후 4시~11시(한국 시간)",
                  "일정 적용 시 국내 시장의 거래 요일·수수료·한도를 복사하고 최소 잔액만 0으로 설정",
                  "학생은 위스를 매일 고정 환율로 유스로 환전해 매수",
                  "종목별 상승·하락 회차에 맞춰 시세 추세가 바뀌고 상장 폐지·합병 회차에 마지막 가격으로 정산",
                  "해외 시장을 닫으면 해외 주문과 환전만 멈추고 국내 시장은 그대로",
                ],
              },
            ]}
          />
        </div>
        {market && plan && (
          <div className="wis-stock-emergency" aria-label="해외 시장 거래 제어">
            <button
              type="button"
              className={`wis-stock-emergency__button${open ? "" : " wis-stock-emergency__button--open"}`}
              disabled={!canManage || !!busy || conflict}
              onClick={() =>
                void run(
                  "halt",
                  (revision) =>
                    setWisStockOverseasMarketHalted(
                      { year, semester },
                      revision,
                      open,
                    ),
                  open ? "해외 시장을 닫았습니다." : "해외 시장을 열었습니다.",
                )
              }
            >
              {busy === "halt"
                ? "처리 중…"
                : open
                  ? "해외 시장 닫기"
                  : "해외 시장 열기"}
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="wis-stocks__error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={loading} onClick={() => void load()}>
            {conflict ? "최신 자료 확인" : "다시 불러오기"}
          </button>
        </div>
      )}
      {loading && !market && <InlineLoading />}
      {market && (
        <div
          className="wis-stocks__summary wis-stocks__fx"
          aria-label="오늘의 환율"
        >
          <strong>오늘의 환율</strong>
          {fx ? (
            <>
              <span>
                1,000유스 = <b>{money(fx.rate)}위스</b>
              </span>
              <span>
                원/달러 {money(fx.krwPerUsd)}원 · {fx.sourceDate} 기준 ·{" "}
                {fx.source}
              </span>
              {!fx.current && <span>오늘 환율 미수신</span>}
            </>
          ) : (
            <span>환율 미수신</span>
          )}
          {(!fx || !fx.current) && (
            <button
              type="button"
              disabled={!canManage || !!busy}
              onClick={async () => {
                const key = owner.current;
                setBusy("fx");
                setError("");
                try {
                  const result = await refreshWisStockFxRateNow({
                    year,
                    semester,
                  });
                  if (owner.current !== key) return;
                  setMarket((current) =>
                    current ? { ...current, fx: result.fx } : current,
                  );
                  showToast({
                    tone: "success",
                    title: "오늘의 환율을 받았습니다.",
                  });
                } catch (failure) {
                  if (owner.current === key)
                    setError(wisStockErrorMessage(failure));
                } finally {
                  if (owner.current === key) setBusy("");
                }
              }}
            >
              {busy === "fx" ? "받는 중…" : "환율 지금 받기"}
            </button>
          )}
        </div>
      )}
      {market && !plan && canManage && (
        <form
          className="wis-stocks__summary wis-stocks__schedule"
          aria-label="4주 해외 상장 일정"
          onSubmit={(event) => {
            event.preventDefault();
            const startsAtMs = Date.parse(`${startsOn}T16:00:00+09:00`);
            if (
              !Number.isFinite(startsAtMs) ||
              new Date(startsAtMs).getUTCDay() !== 1
            ) {
              setError("상장 시작일은 월요일로 선택해 주세요.");
              return;
            }
            void run(
              "plan",
              (revision) =>
                activateWisStockOverseasCatalogPlan(
                  { year, semester },
                  revision,
                  startsAtMs,
                ),
              "해외 상장 일정을 적용했습니다.",
            );
          }}
        >
          <strong>4주 해외 상장 일정</strong>
          <InfoHelp
            label="4주 해외 상장 일정"
            sections={[
              {
                items: [
                  "시작일 오후 4시부터 평일 오후 4시~10시 매시 30개 종목을 시대 순서로 상장",
                  "1주 신항로 개척 → 2주 절대 왕정 → 3주 산업 혁명 → 4주 제국주의",
                  "상장 폐지·합병 일정도 함께 적용되며 이미 지난 일정이 있으면 적용 불가",
                  "적용 후에는 '해외 시장 열기'를 눌러야 학생에게 공개",
                  "적용한 시작일은 바꿀 수 없음",
                ],
              },
            ]}
          />
          <label>
            시작일{" "}
            <input
              aria-label="해외 상장 시작일"
              type="date"
              value={startsOn}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              required
              disabled={!!busy}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="wis-stocks__primary"
            disabled={!!busy || conflict}
          >
            {busy === "plan" ? "적용 중…" : "해외 상장 일정 적용"}
          </button>
        </form>
      )}
      {market && plan && (
        <div className="wis-stocks__overseas-plan">
          <dl className="wis-stocks__overseas-eras" aria-label="시대별 상장">
            {eraCounts.map((item, index) => (
              <div key={item.era}>
                <dt>
                  {index + 1}주 · {item.era}
                </dt>
                <dd>
                  {item.listed} / {item.total}
                </dd>
              </div>
            ))}
          </dl>
          <p className="wis-stocks__summary">
            시작 {when.format(plan.startsAtMs)}
            {market.catalogSchedule?.nextListingAtMs
              ? ` · 다음 상장 ${when.format(market.catalogSchedule.nextListingAtMs)}`
              : ""}
          </p>
          {upcomingExits.length > 0 && (
            <div className="wis-stocks__overseas-exits">
              <h3>다가오는 거래 종료</h3>
              <ul>
                {upcomingExits.map(({ entry, atMs }) => (
                  <li key={entry.id}>
                    <strong>{entry.name}</strong>
                    <span>
                      {exitLabel[entry.exitKind as keyof typeof exitLabel]} ·{" "}
                      {when.format(atMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {market && plan && stocks.length > 0 && (
        <div className="wis-stocks__workspace">
          <div className="wis-stocks__watchlist">
            <div className="wis-stocks__list-heading" aria-hidden="true">
              <span>종목</span>
              <span>현재가</span>
              <span>전일 대비</span>
            </div>
            <div className="wis-stocks__list" role="list">
              {stocks.map((stock) => {
                const entry = byId.get(stock.id);
                const change = dayChange(stock);
                const ended = stock.settings.tradingStatus === "GRADUATED";
                return (
                  <div role="listitem" key={stock.id}>
                    <button
                      type="button"
                      className={`wis-stocks__quote-row${selected?.id === stock.id ? " is-selected" : ""}`}
                      aria-pressed={selected?.id === stock.id}
                      onClick={() => setSelectedId(stock.id)}
                    >
                      <span className="wis-stocks__row-name">
                        <strong>{stock.settings.name}</strong>
                        <span>
                          {ended
                            ? entry
                              ? exitLabel[
                                  entry.exitKind as keyof typeof exitLabel
                                ]
                              : "거래 종료"
                            : stock.settings.period}
                        </span>
                      </span>
                      <span className="wis-stocks__row-price">
                        {money(stock.price)}
                        <span>유스</span>
                      </span>
                      <span
                        className={`wis-stocks__row-change ${change > 0 ? "is-up" : change < 0 ? "is-down" : "is-flat"}`}
                      >
                        {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
                        {money(Math.abs(change))}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {selected && (
            <div className="wis-stocks__detail">
              <div className="wis-stocks__quote">
                <h3>{selected.settings.name}</h3>
                <strong>
                  {money(selected.price)} <small>유스</small>
                </strong>
                <span>{selected.settings.period}</span>
              </div>
              <WisStockPriceChart
                stock={selected}
                days={7}
                variant="candlestick"
                priceUnit="유스"
              />
              {byId.get(selected.id) && (
                <dl className="wis-stocks__overseas-story">
                  <div>
                    <dt>역사 배경</dt>
                    <dd>{byId.get(selected.id)!.fact}</dd>
                  </div>
                  <div>
                    <dt>
                      상승 ·{" "}
                      {when.format(
                        catalogSessionAtMs(
                          byId.get(selected.id)!.riseSession,
                          plan.startsAtMs,
                        ),
                      )}
                    </dt>
                    <dd>{byId.get(selected.id)!.riseReason}</dd>
                  </div>
                  <div>
                    <dt>
                      하락 ·{" "}
                      {when.format(
                        catalogSessionAtMs(
                          byId.get(selected.id)!.fallSession,
                          plan.startsAtMs,
                        ),
                      )}
                    </dt>
                    <dd>{byId.get(selected.id)!.fallReason}</dd>
                  </div>
                  <div>
                    <dt>
                      {exitLabel[
                        byId.get(selected.id)!
                          .exitKind as keyof typeof exitLabel
                      ] || "결말"}
                    </dt>
                    <dd>{byId.get(selected.id)!.exitReason}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>
      )}
      {market && plan && stocks.length === 0 && (
        <p className="wis-stocks__empty">
          {market.studentOpen
            ? "첫 상장 시각을 기다리고 있습니다."
            : "해외 시장을 열면 상장 시각이 지난 종목부터 상장합니다."}
        </p>
      )}
    </section>
  );
}
