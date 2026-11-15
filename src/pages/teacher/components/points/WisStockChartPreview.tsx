import { useEffect, useMemo, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "../../../../components/common/InfoHelp";
import type {
  WisStock,
  WisStockMarketRules,
} from "../../../../lib/wisStocksClient";
import WisStockOrderPreview from "./WisStockOrderPreview";
import {
  wisStockCatalog,
  wisStockCatalogWeeks,
  createWisStockPlanStocks,
} from "../../../../lib/wisStockCatalog";
import StockChart, {
  stockObservations,
} from "../../../../components/common/WisStockPriceChart";
export { stockObservations } from "../../../../components/common/WisStockPriceChart";
import "./WisStockCatalog.css";

const DAY = 86_400_000;
const periods = [
  { key: "day", label: "1일", days: 1 },
  { key: "week", label: "1주", days: 7 },
  { key: "month", label: "1개월", days: 30 },
  { key: "all", label: "전체", days: Infinity },
] as const;
const money = (value: number) => value.toLocaleString("ko-KR");
const catalogById = new Map(
  wisStockCatalog.map((company) => [company.id, company]),
);
const catalogByName = new Map(
  wisStockCatalog.map((company) => [company.name, company]),
);
const sessionLabel = (session: number) =>
  `${Math.floor((session - 1) / 35) + 1}주 ${Math.floor(((session - 1) % 35) / 7) + 1}일차`;

export default function WisStockChartPreview({
  stocks,
  rules,
  revision,
  semesterId,
}: {
  stocks: WisStock[];
  rules: WisStockMarketRules;
  revision: number;
  semesterId: string;
}) {
  const planStocks = useMemo(createWisStockPlanStocks, []);
  const [source, setSource] = useState(stocks.length ? "registered" : "plan");
  const isPlan = source === "plan" || !stocks.length;
  const available = isPlan ? planStocks : stocks;
  const [week, setWeek] = useState(1);
  const visibleStocks = isPlan
    ? available.filter((stock) => catalogById.get(stock.id)?.week === week)
    : available;
  const [selectedId, setSelectedId] = useState(available[0]?.id || "");
  const [period, setPeriod] = useState<(typeof periods)[number]>(periods[3]);
  const [orderPending, setOrderPending] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected =
    visibleStocks.find((stock) => stock.id === selectedId) || visibleStocks[0];
  const company = isPlan ? catalogById.get(selected.id) : undefined;
  const observations = stockObservations(selected);
  const lastAt = observations.at(-1)?.atMs || 0;
  const first =
    observations.find((point) => point.atMs >= lastAt - period.days * DAY)
      ?.price || selected.price;
  const change = selected.price - first;
  const percent = first ? (change / first) * 100 : 0;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (context && !context.matches.reduceMotion)
        animate(".wis-stock-preview__quote", {
          opacity: [0.45, 1],
          y: [5, 0],
          duration: 250,
          ease: "out(3)",
        });
    });
    return () => scope.revert();
  }, [selected.id, selected.price, period.key]);
  return (
    <div ref={root} className="wis-stock-preview">
      <div className="wis-stock-preview__heading">
        <h2>학생 화면 미리보기</h2>
        <span className="wis-stocks__closed">
          {isPlan ? "6주 기획안 · 가상 시세" : "등록 종목"}
        </span>
        <InfoHelp label="미리보기 자료">
          <p>
            등록 종목은 저장된 관측 가격을 표시합니다. 6주 기획안은 역사 종목
            70개와 장기 가치 종목 10개의 가상 시나리오이며, 날짜·등락·퇴장은
            실제 운영 일정이 아닙니다. 계좌 이체와 주문은 미리보기 안에서만
            처리합니다.
          </p>
        </InfoHelp>
      </div>
      <div
        className="wis-stock-catalog__filters"
        aria-label="미리보기 자료 선택"
      >
        <div role="group" aria-label="자료 종류">
          {[
            { key: "registered", label: "등록 종목" },
            { key: "plan", label: "6주 기획안" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={(isPlan ? "plan" : "registered") === item.key}
              disabled={
                orderPending || (item.key === "registered" && !stocks.length)
              }
              onClick={() => setSource(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {isPlan && (
          <label>
            공개 차수
            <select
              aria-label="공개 차수"
              value={week}
              disabled={orderPending}
              onChange={(event) => setWeek(Number(event.target.value))}
            >
              {wisStockCatalogWeeks.map((name, index) => (
                <option key={name} value={index + 1}>
                  {index + 1}주 · {name}
                </option>
              ))}
              <option value={0}>상시 · 장기 가치 종목</option>
            </select>
          </label>
        )}
      </div>
      <div className="wis-stock-preview__layout">
        <div className="wis-stock-preview__catalog" aria-label="미리보기 종목">
          {visibleStocks.map((stock, index) => {
            const logo = (
              isPlan
                ? catalogById.get(stock.id)
                : catalogByName.get(stock.settings.name)
            )?.logoUrl;
            const baseline = stockObservations(stock)[0]?.price || stock.price;
            const difference = stock.price - baseline;
            return (
              <button
                type="button"
                className={`wis-stock-preview__stock${selected.id === stock.id ? " is-selected" : ""}`}
                key={stock.id}
                aria-pressed={selected.id === stock.id}
                disabled={orderPending}
                onClick={() => {
                  setSelectedId(stock.id);
                }}
              >
                <span className="wis-stock-preview__symbol" aria-hidden="true">
                  {logo ? (
                    <img src={logo} alt="" width={36} height={36} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="wis-stock-preview__stock-name">
                  <strong>{stock.settings.name}</strong>
                  <small>{stock.settings.period || "역사 종목"}</small>
                </span>
                <span className="wis-stock-preview__stock-price">
                  <strong>{money(stock.price)}</strong>
                  <small
                    className={`is-${difference > 0 ? "up" : difference < 0 ? "down" : "flat"}`}
                  >
                    {difference > 0 ? "+" : ""}
                    {((difference / baseline) * 100).toFixed(1)}%
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="wis-stock-preview__detail">
          <div className="wis-stock-preview__quote">
            <span>{selected.settings.period || "역사 종목"}</span>
            <h3>{selected.settings.name}</h3>
            <strong>
              {money(selected.price)} <small>위스</small>
            </strong>
            <p className={`is-${direction}`}>
              {change > 0 ? "상승" : change < 0 ? "하락" : "변동 없음"}{" "}
              {change > 0 ? "+" : ""}
              {money(change)} ({percent > 0 ? "+" : ""}
              {percent.toFixed(1)}%) <span>선택 기간 대비</span>
            </p>
          </div>
          <div className={`wis-stock-preview__chart is-${direction}`}>
            <StockChart stock={selected} days={period.days} />
          </div>
          <div className="wis-stock-preview__periods" aria-label="차트 기간">
            {periods.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.key === period.key}
                onClick={() => setPeriod(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {selected.settings.description && (
            <p className="wis-stock-preview__background">
              {selected.settings.description}
            </p>
          )}
          {company && (
            <details className="wis-stock-catalog__story" key={company.id}>
              <summary>종목 로드맵·역사 근거</summary>
              <div
                className="wis-stock-catalog__timeline"
                aria-label="6주 종목 로드맵"
              >
                <div className="wis-stock-catalog__weeks">
                  {wisStockCatalogWeeks.map((_, index) => (
                    <span key={index}>{index + 1}주</span>
                  ))}
                </div>
                {[
                  {
                    label: "등장",
                    session: company.listingSession,
                    kind: "listing",
                  },
                  {
                    label: "성장 구간",
                    session: company.riseSession,
                    kind: "rise",
                  },
                  {
                    label: "조정 구간",
                    session: company.fallSession,
                    kind: "fall",
                  },
                  ...(company.exitSession === null
                    ? []
                    : [
                        {
                          label:
                            company.exitKind === "merge"
                              ? "합병 구간"
                              : "퇴장 구간",
                          session: company.exitSession,
                          kind: "exit",
                        },
                      ]),
                ].map((event) => (
                  <div
                    className={`wis-stock-catalog__event is-${event.kind}`}
                    key={event.kind}
                  >
                    <span>{event.label}</span>
                    <div>
                      <i
                        style={{
                          left: `${Math.min(98, Math.max(2, ((event.session - 1) / 209) * 100))}%`,
                        }}
                      />
                    </div>
                    <small>{sessionLabel(event.session)}</small>
                  </div>
                ))}
              </div>
              <dl>
                <div>
                  <dt>성장 계기</dt>
                  <dd>{company.riseReason}</dd>
                </div>
                <div>
                  <dt>하락 위험</dt>
                  <dd>{company.fallReason}</dd>
                </div>
                <div>
                  <dt>마무리</dt>
                  <dd>
                    {company.exitReason || "6주 이후에도 존속하는 기획입니다."}
                  </dd>
                </div>
              </dl>
              <p className="wis-stock-catalog__fiction">
                가격·사건의 발생 시점은 수업용 가정입니다. 상장폐지·합병은
                기획안이며 계좌를 자동 정산하지 않습니다.
              </p>
              {company.sourceUrls.length > 0 && (
                <div className="wis-stock-catalog__sources">
                  {company.sourceUrls.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {company.sourceTitle || "역사 자료"}
                      {company.sourceUrls.length > 1 ? ` ${index + 1}` : ""}
                    </a>
                  ))}
                </div>
              )}
              {company.sourceUrls.length === 0 && company.sourceTitle && (
                <p className="wis-stock-catalog__fiction">
                  출처: {company.sourceTitle}
                </p>
              )}
            </details>
          )}
          <WisStockOrderPreview
            key={isPlan ? "plan" : "registered"}
            stock={selected}
            stocks={available}
            rules={rules}
            revision={revision}
            semesterId={semesterId}
            onPendingChange={setOrderPending}
          />
        </div>
      </div>
    </div>
  );
}
