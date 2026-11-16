import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import InfoHelp from "../../../../components/common/InfoHelp";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";
import WisStockChartPreview from "./WisStockChartPreview";
import WisStockMarketRules from "./WisStockMarketRules";
import WisStockInvestmentBoard from "./WisStockInvestmentBoard";
import WisStockMarketOverview from "./WisStockMarketOverview";
import {
  wisStockQuote,
  quoteNumber,
  signedQuote,
  quoteDirection,
} from "./wisStockQuote";
import { getYearSemester } from "../../../../lib/semesterScope";
import { watchWisStockListings } from "../../../../lib/wisStockListingSubscription";
import {
  wisStockCatalog,
  wisStockCatalogWeeks,
  getWisStockTemplateSettings,
} from "../../../../lib/wisStockCatalog";
import {
  getWisStockManagement,
  saveWisStock,
  setWisStockMarketHalted,
  activateWisStockCatalogPlan,
  wisStockErrorMessage,
  isWisStockRevisionConflict,
  type WisStock,
  type WisStockConfig,
  type WisStockManagement,
  type WisStockSettings,
} from "../../../../lib/wisStocksClient";
import "./TeacherWisStocks.css";
import "./WisStockEmergencyControl.css";

const emptySettings = (): WisStockSettings => ({
  name: "",
  description: "",
  period: "",
  initialPrice: 100,
  minimumPrice: 1,
  maximumPrice: 10000,
  volatilityBps: 300,
  trendBps: 0,
  intervalHours: 24,
  automatic: false,
  issuedShares: 100000,
  lotSize: 1,
  tradingStatus: "ACTIVE",
  growthProfile: "HISTORICAL",
});
const date = (value: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(value);
const planStartDate = (year: string, semester: string) => {
  if (year === "2026" && semester === "2") return "2026-11-16";
  const first = new Date(Date.UTC(Number(year), semester === "1" ? 2 : 7, 1));
  first.setUTCDate(first.getUTCDate() + ((8 - first.getUTCDay()) % 7));
  return first.toISOString().slice(0, 10);
};
export default function TeacherWisStocks({
  config,
  canManage,
}: {
  config: WisStockConfig;
  canManage: boolean;
}) {
  const { currentUser, authGeneration } = useAuth();
  const { showToast } = useAppToast();
  const { year, semester } = getYearSemester(config);
  const ownerKey = `${currentUser?.uid || ""}:${authGeneration}:${year}:${semester}:${canManage}`;
  const generation = useRef(0);
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  const [tab, setTab] = useState("stocks");
  const [conflict, setConflict] = useState(false);
  const [storedMarket, setMarket] = useState<WisStockManagement | null>(null);
  const [marketOwner, setMarketOwner] = useState("");
  const market = marketOwner === ownerKey ? storedMarket : null;
  const latestMarket = useRef<{
    owner: string;
    value: WisStockManagement | null;
  }>({ owner: ownerKey, value: null });
  if (latestMarket.current.owner !== ownerKey)
    latestMarket.current = { owner: ownerKey, value: null };
  const applyMarket = useCallback(
    (result: WisStockManagement) => {
      if (owner.current !== ownerKey) return null;
      const current = latestMarket.current.value;
      if (current && current.revision > result.revision) return current;
      latestMarket.current.value = result;
      setMarket(result);
      setMarketOwner(ownerKey);
      return result;
    },
    [ownerKey],
  );
  const [halting, setHalting] = useState(false);
  const haltFlight = useRef(false);
  const [haltError, setHaltError] = useState("");
  const [haltConflict, setHaltConflict] = useState(false);
  const haltIntent = useRef(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [growthFilter, setGrowthFilter] = useState<
    "ALL" | "HISTORICAL" | "VALUE"
  >("ALL");
  const [periodFilter, setPeriodFilter] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [startsOn, setStartsOn] = useState(() => planStartDate(year, semester));
  const planFlight = useRef(false);
  const [draft, setDraft] = useState<WisStockSettings>(emptySettings);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const selected = market?.stocks.find((stock) => stock.id === selectedId);
  const dirty =
    selectedId !== null &&
    JSON.stringify(draft) !==
      JSON.stringify(selected?.settings || emptySettings());
  const editor = useRef({ selectedId, dirty });
  editor.current = { selectedId, dirty };
  const load = useCallback(async () => {
    const sequence = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await getWisStockManagement({ year, semester });
      if (sequence !== generation.current || owner.current !== ownerKey) return;
      const accepted = applyMarket(result);
      if (!accepted) return;
      const currentSelection = editor.current;
      if (currentSelection.selectedId && !currentSelection.dirty) {
        const updated = accepted.stocks.find(
          (stock) => stock.id === currentSelection.selectedId,
        );
        if (updated) setDraft({ ...updated.settings });
      }
      setConflict(false);
      return accepted;
    } catch (failure) {
      if (sequence === generation.current && owner.current === ownerKey)
        setError(wisStockErrorMessage(failure));
    } finally {
      if (sequence === generation.current && owner.current === ownerKey)
        setLoading(false);
    }
  }, [ownerKey, year, semester, applyMarket]);
  useEffect(() => {
    setMarket(null);
    setSelectedId(null);
    setViewId(null);
    setGrowthFilter("ALL");
    setPeriodFilter(null);
    setTemplateId("");
    setStartsOn(planStartDate(year, semester));
    planFlight.current = false;
    setDraft(emptySettings());
    setError("");
    setSaving(false);
    setConflict(false);
    setHalting(false);
    haltFlight.current = false;
    setHaltError("");
    setHaltConflict(false);
    setTab("stocks");
    let started = false;
    const start = () => {
      if (!started && !document.hidden) {
        started = true;
        void load();
      }
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", start);
    };
  }, [load]);
  const schedule = market?.catalogSchedule;
  const watchListings =
    tab === "stocks" &&
    market?.studentOpen === true &&
    !market.rules.halted &&
    !saving &&
    !loading &&
    !error;
  useEffect(() => {
    if (!watchListings) return;
    let stop: (() => void) | undefined;
    let reloading = false;
    const connect = () => {
      stop?.();
      stop = undefined;
      if (document.hidden) return;
      stop = watchWisStockListings(
        { year, semester },
        (ids, revision) => {
          if (reloading || owner.current !== ownerKey) return;
          const currentIds = latestMarket.current.value?.stocks
            .map((stock) => stock.id)
            .sort();
          if (
            JSON.stringify(currentIds) === JSON.stringify(ids) &&
            (revision === undefined ||
              revision <= (latestMarket.current.value?.revision ?? 0))
          )
            return;
          reloading = true;
          void load();
        },
        (failure) => {
          if (owner.current === ownerKey)
            setError(wisStockErrorMessage(failure));
        },
      );
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    return () => {
      stop?.();
      document.removeEventListener("visibilitychange", connect);
    };
  }, [watchListings, ownerKey, year, semester, load]);
  const activatePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !market ||
      !canManage ||
      saving ||
      loading ||
      conflict ||
      planFlight.current
    )
      return;
    const startsAtMs = Date.parse(`${startsOn}T09:00:00+09:00`);
    if (
      !Number.isFinite(startsAtMs) ||
      new Date(startsAtMs).getUTCDay() !== 1
    ) {
      setError("상장 시작일은 월요일로 선택해 주세요.");
      return;
    }
    const expectedOwner = ownerKey;
    planFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await activateWisStockCatalogPlan(
        { year, semester },
        market.revision,
        startsAtMs,
      );
      if (owner.current !== expectedOwner) return;
      applyMarket(result);
      showToast({ title: "상장 일정을 적용했습니다.", tone: "success" });
    } catch (failure) {
      if (owner.current === expectedOwner) {
        setError(wisStockErrorMessage(failure));
        setConflict(isWisStockRevisionConflict(failure));
      }
    } finally {
      if (owner.current === expectedOwner) {
        planFlight.current = false;
        setSaving(false);
      }
    }
  };
  const set = <K extends keyof WisStockSettings>(
    key: K,
    value: WisStockSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const choose = (stock?: WisStock) => {
    if (stock?.id === editor.current.selectedId && editor.current.dirty) {
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setTemplateId("");
    setSelectedId(stock?.id || "");
    setDraft(stock ? { ...stock.settings } : emptySettings());
    setError("");
    setConflict(false);
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
    );
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !market ||
      selectedId === null ||
      saving ||
      loading ||
      conflict ||
      !canManage ||
      (selected && !dirty)
    )
      return;
    const sequence = ++generation.current,
      expectedOwner = ownerKey;
    setSaving(true);
    setError("");
    try {
      const result = await saveWisStock(
        { year, semester },
        market.revision,
        selectedId,
        draft,
      );
      if (sequence !== generation.current || owner.current !== expectedOwner)
        return;
      const accepted = applyMarket(result);
      if (!accepted) return;
      setSelectedId(result.savedStockId);
      setDraft({
        ...accepted.stocks.find((stock) => stock.id === result.savedStockId)!
          .settings,
      });
      showToast({
        title: result.changed
          ? "종목을 저장했습니다."
          : "저장된 내용을 확인했습니다.",
        tone: "success",
      });
    } catch (failure) {
      if (sequence === generation.current && owner.current === expectedOwner) {
        setError(wisStockErrorMessage(failure));
        setConflict(isWisStockRevisionConflict(failure));
      }
    } finally {
      if (owner.current === expectedOwner) setSaving(false);
    }
  };
  const changeHalted = async (halted: boolean) => {
    if (!canManage || haltFlight.current) return;
    const expectedOwner = ownerKey;
    haltFlight.current = true;
    haltIntent.current = halted;
    setHalting(true);
    setHaltError("");
    setHaltConflict(false);
    try {
      const result = await setWisStockMarketHalted(
        { year, semester },
        latestMarket.current.value?.revision ?? 0,
        halted,
      );
      if (owner.current !== expectedOwner) return;
      const accepted = applyMarket(result);
      if (!accepted) return;
      showToast({
        title: accepted.rules.halted
          ? "주식 시장을 닫았습니다."
          : "주식 시장을 열었습니다.",
        tone: "success",
      });
    } catch (failure) {
      if (owner.current === expectedOwner) {
        setHaltError(wisStockErrorMessage(failure));
        setHaltConflict(isWisStockRevisionConflict(failure));
      }
    } finally {
      if (owner.current === expectedOwner) {
        haltFlight.current = false;
        setHalting(false);
      }
    }
  };
  const stats = useMemo(
    () => ({
      count: market?.stocks.length || 0,
      automatic:
        market?.stocks.filter((stock) => stock.settings.automatic).length || 0,
    }),
    [market],
  );
  const typeStocks = useMemo(
    () =>
      (market?.stocks || []).filter(
        (stock) =>
          growthFilter === "ALL" ||
          (stock.settings.growthProfile || "HISTORICAL") === growthFilter,
      ),
    [market, growthFilter],
  );
  const periods = useMemo(
    () => [...new Set(typeStocks.map((stock) => stock.settings.period.trim()))],
    [typeStocks],
  );
  const selectedPeriod =
    periodFilter !== null && periods.includes(periodFilter)
      ? periodFilter
      : null;
  useEffect(() => {
    setPeriodFilter((current) =>
      current !== null && !periods.includes(current) ? null : current,
    );
  }, [periods]);
  const visibleStocks = useMemo(
    () =>
      selectedPeriod === null
        ? typeStocks
        : typeStocks.filter(
            (stock) => stock.settings.period.trim() === selectedPeriod,
          ),
    [typeStocks, selectedPeriod],
  );
  const marketOpen = market?.studentOpen === true && !market.rules.halted;
  const activeViewId =
    viewId === null
      ? null
      : visibleStocks.some((stock) => stock.id === viewId)
        ? viewId
        : visibleStocks[0]?.id || null;
  const viewedStock = visibleStocks.find((stock) => stock.id === activeViewId);
  useEffect(() => {
    setViewId(activeViewId);
  }, [activeViewId]);
  const indexChange = market?.marketIndex?.history.length
    ? market.marketIndex.value - market.marketIndex.previousClose
    : null;
  const indexPercent =
    indexChange !== null && market?.marketIndex?.previousClose
      ? (indexChange / market.marketIndex.previousClose) * 100
      : null;
  return (
    <section className="wis-stocks" aria-label="위스피(WsPI) 관리">
      <PortalSubNavigation
        title="위스피(WsPI)"
        activeLabel={
          {
            stocks: "종목 관리",
            rules: "시장 규칙",
            preview: "주식 차트 관리",
            investments: "학생 투자 현황",
          }[tab] || "종목 관리"
        }
        variant="tabs"
        actions={
          <>
            <span className="wis-stocks__closed" role="status">
              {marketOpen ? "거래 중" : "거래 중지"}
            </span>
            <InfoHelp label="주식 운영 기준">
              <p>
                시장을 열면 학생이 거래할 수 있습니다. 닫으면 거래만 중지하며,
                학생 메뉴 숨김은 설정의 인터페이스에서 변경합니다. 종목은 학기당{" "}
                {market?.maxStocks || 100}
                개까지, 가격 기록은 종목별 최근 {market?.historyLimit || 120}
                건까지 보관합니다. 설명과 가격 기록을 포함한 저장 용량을 넘으면
                등록을 중단합니다.
              </p>
            </InfoHelp>
          </>
        }
      >
        {[
          { key: "stocks", label: "종목 관리" },
          { key: "rules", label: "시장 규칙" },
          { key: "preview", label: "주식 차트 관리" },
          { key: "investments", label: "학생 투자 현황" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={
              "teacher-settings-section" +
              (tab === item.key ? " is-active" : "")
            }
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
        <div className="wis-stock-emergency" aria-label="시장 거래 제어">
          <button
            type="button"
            className={`wis-stock-emergency__button${marketOpen ? "" : " wis-stock-emergency__button--open"}`}
            disabled={!canManage || halting || !market}
            onClick={() => void changeHalted(marketOpen)}
          >
            {halting
              ? "처리 중…"
              : marketOpen
                ? "주식 시장 닫기"
                : "주식 시장 열기"}
          </button>
        </div>
      </PortalSubNavigation>
      {haltError && (
        <div className="wis-stocks__error" role="alert">
          <p>{haltError}</p>
          <button
            type="button"
            disabled={
              halting || !canManage || (haltConflict && (saving || loading))
            }
            onClick={() => {
              if (haltConflict)
                void load().then((result) => {
                  if (result) {
                    setHaltError("");
                    setHaltConflict(false);
                  }
                });
              else void changeHalted(haltIntent.current);
            }}
          >
            {haltConflict ? "최신 거래 상태 확인" : "거래 제어 다시 시도"}
          </button>
        </div>
      )}
      {market && tab === "stocks" && (
        <form
          className="wis-stocks__summary wis-stocks__schedule"
          onSubmit={activatePlan}
          aria-label="6주 상장 일정"
        >
          <strong>6주 상장 일정</strong>
          <InfoHelp label="6주 상장 일정">
            <p>
              시작일 오전 9시부터 기존 80개 기획 종목의 상장 순서를 적용합니다.
              시장이 열려 있는 거래 시간에 도래한 종목만 등록하며, 기존 종목
              설정은 유지합니다. 적용한 시작일은 바꿀 수 없습니다. 합병·퇴장은
              자동 실행하지 않습니다.
            </p>
          </InfoHelp>
          {schedule?.plan ? (
            <>
              <span>시작 {date(schedule.plan.startsAtMs)}</span>
              <span>
                상장 {schedule.listedCount} · 예정 {schedule.pendingCount}
              </span>
              {schedule.nextListingAtMs !== null && (
                <span>다음 상장 {date(schedule.nextListingAtMs)}</span>
              )}
            </>
          ) : canManage ? (
            <>
              <label>
                시작일{" "}
                <input
                  aria-label="상장 시작일"
                  type="date"
                  value={startsOn}
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  required
                  disabled={saving || loading}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </label>
              <button type="submit" disabled={saving || loading || conflict}>
                {saving ? "적용 중…" : "상장 일정 적용"}
              </button>
            </>
          ) : (
            <span>미적용</span>
          )}
        </form>
      )}
      {market && tab === "stocks" && (
        <div className="wis-stocks__summary">
          <span>
            등록 {stats.count} / {market.maxStocks}
          </span>
          <span>자동 변동 {stats.automatic}개</span>
          {market.updatedAtMs > 0 && (
            <span>최근 변경 {date(market.updatedAtMs)}</span>
          )}
        </div>
      )}
      {error && (
        <div className="wis-stocks__error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void load()}
          >
            {conflict ? "최신 자료 확인" : "다시 불러오기"}
          </button>
          {conflict && (
            <span>
              작성 중인 내용은 유지됩니다. 최신 자료를 확인한 뒤 다시 저장해
              주세요.
            </span>
          )}
        </div>
      )}
      {loading && <p role="status">주식 자료를 불러오는 중입니다.</p>}
      {market && tab === "stocks" && (
        <div className="wis-stocks__filters" aria-label="종목 필터">
          <label className="wis-stocks__type-filter">
            유형
            <select
              aria-label="종목 유형"
              value={growthFilter}
              onChange={(event) =>
                setGrowthFilter(event.target.value as typeof growthFilter)
              }
            >
              <option value="ALL">전체 유형</option>
              <option value="HISTORICAL">역사 종목</option>
              <option value="VALUE">가치 종목</option>
            </select>
          </label>
          <div
            className="wis-stocks__period-filters"
            role="group"
            aria-label="시대·주제 필터"
          >
            <span>시대·주제</span>
            <button
              type="button"
              aria-pressed={selectedPeriod === null}
              onClick={() => setPeriodFilter(null)}
            >
              전체
            </button>
            {periods.map((period) => (
              <button
                type="button"
                key={period}
                aria-pressed={selectedPeriod === period}
                onClick={() => setPeriodFilter(period)}
              >
                {period || "시대 미지정"}
              </button>
            ))}
          </div>
          <span className="wis-stocks__filter-count" aria-live="polite">
            전체 {market.stocks.length}개 중 {visibleStocks.length}개
          </span>
        </div>
      )}
      {market && (
        <div className="wis-stocks__management" hidden={tab !== "stocks"}>
          <div className="wis-stocks__workspace">
            <div className="wis-stocks__watchlist">
              <div className="wis-stocks__list-heading">
                <span>종목</span>
                <span>현재가</span>
                <span>
                  등락
                  <InfoHelp label="종목 등락 기준">
                    <p>
                      한국 시각 기준 전 거래일의 마지막 기록 가격과 비교합니다.
                      첫 거래일에는 첫 관측 가격과 비교하며, 가격 기록이 없으면
                      등락을 표시하지 않습니다.
                    </p>
                  </InfoHelp>
                </span>
              </div>
              <div
                className="wis-stocks__list"
                role="group"
                aria-label="종목 시세 목록"
                tabIndex={0}
              >
                <button
                  type="button"
                  className={`wis-stocks__market-row wis-stocks__quote-row${activeViewId === null ? " is-selected" : ""}`}
                  aria-pressed={activeViewId === null}
                  onClick={() => setViewId(null)}
                >
                  <span className="wis-stocks__row-name">
                    <strong>전체 위스피</strong>
                    <span>WsPI</span>
                  </span>
                  <span className="wis-stocks__row-price">
                    <strong>
                      {market.marketIndex?.history.length
                        ? quoteNumber(market.marketIndex.value, 2)
                        : "—"}
                    </strong>
                    <span>pt</span>
                  </span>
                  <span
                    className={`wis-stocks__row-change ${quoteDirection(indexChange)}`}
                  >
                    <strong>
                      {indexChange === null ? "—" : signedQuote(indexChange, 2)}
                    </strong>
                    <span>
                      {indexPercent === null
                        ? "—"
                        : `${signedQuote(indexPercent, 2)}%`}
                    </span>
                  </span>
                </button>
                {visibleStocks.length === 0 ? (
                  <p className="wis-stocks__empty">
                    {market.stocks.length === 0
                      ? "등록된 종목이 없습니다."
                      : "선택한 유형의 종목이 없습니다."}
                  </p>
                ) : (
                  visibleStocks.map((stock) => {
                    const quote = wisStockQuote(stock, market.updatedAtMs);
                    return (
                      <button
                        type="button"
                        key={stock.id}
                        className={`wis-stocks__row wis-stocks__quote-row${activeViewId === stock.id ? " is-selected" : ""}`}
                        aria-pressed={activeViewId === stock.id}
                        onClick={() => setViewId(stock.id)}
                      >
                        <span className="wis-stocks__row-name">
                          <strong>{stock.settings.name}</strong>
                          <span>{stock.settings.period || "시대 미지정"}</span>
                        </span>
                        <span className="wis-stocks__row-price">
                          <strong>{stock.price.toLocaleString()}</strong>
                          <span>위스</span>
                        </span>
                        <span
                          className={`wis-stocks__row-change ${quoteDirection(quote.change)}`}
                        >
                          <strong>
                            {quote.change === null
                              ? "—"
                              : signedQuote(quote.change)}
                          </strong>
                          <span>
                            {quote.percent === null
                              ? "—"
                              : `${signedQuote(quote.percent, 2)}%`}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <aside className="wis-stocks__detail" aria-label="선택 종목 그래프">
              {tab === "stocks" && (
                <WisStockMarketOverview
                  index={market.marketIndex}
                  stock={viewedStock}
                  asOfMs={market.updatedAtMs}
                  actions={
                    viewedStock && (
                      <button
                        ref={editButtonRef}
                        type="button"
                        className="wis-stocks__edit-button"
                        disabled={
                          saving ||
                          loading ||
                          (dirty && selectedId !== viewedStock.id)
                        }
                        title={
                          dirty && selectedId !== viewedStock.id
                            ? "작성 중인 종목을 저장하거나 닫아 주세요."
                            : undefined
                        }
                        onClick={() => choose(viewedStock)}
                      >
                        {canManage ? "종목 편집" : "종목 설정 보기"}
                      </button>
                    )
                  }
                />
              )}
            </aside>
          </div>
          {selectedId !== null && (
            <form
              ref={formRef}
              className="wis-stocks__editor"
              onSubmit={save}
              aria-label={
                selected
                  ? `${selected.settings.name} 종목 편집`
                  : "새 종목 등록"
              }
            >
              <div className="wis-stocks__editor-title">
                <h3>{selected ? selected.settings.name : "새 종목"}</h3>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setSelectedId(null);
                    requestAnimationFrame(() => editButtonRef.current?.focus());
                  }}
                >
                  닫기
                </button>
              </div>
              <fieldset disabled={!canManage || saving || loading}>
                {!selected && (
                  <label className="wis-stocks__wide">
                    <span>
                      종목 초안
                      <InfoHelp label="종목 초안">
                        <p>
                          6주 기획안에서 한 종목의 이름·설명을 가져옵니다.
                          작성한 내용은 선택한 초안으로 바뀌며, 아래 종목 등록을
                          눌러야 저장됩니다. 기획 종목의 자동 상장은 6주 상장
                          일정에서 별도로 적용합니다.
                        </p>
                      </InfoHelp>
                    </span>
                    <select
                      aria-label="종목 초안"
                      value={templateId}
                      onChange={(event) => {
                        const id = event.target.value;
                        setTemplateId(id);
                        if (id) setDraft(getWisStockTemplateSettings(id));
                      }}
                    >
                      <option value="">직접 작성</option>
                      {[0, 1, 2, 3, 4, 5, 6].map((week) => (
                        <optgroup
                          key={week}
                          label={
                            week === 0
                              ? "상시 · 가치 종목"
                              : `${week}주차 · ${wisStockCatalogWeeks[week - 1]}`
                          }
                        >
                          {wisStockCatalog
                            .filter((company) => company.week === week)
                            .map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  종목명
                  <input
                    value={draft.name}
                    maxLength={60}
                    required
                    onChange={(event) => set("name", event.target.value)}
                  />
                </label>
                <label>
                  시대·주제
                  <input
                    value={draft.period}
                    maxLength={80}
                    onChange={(event) => set("period", event.target.value)}
                  />
                </label>
                <label className="wis-stocks__wide">
                  역사 배경
                  <textarea
                    value={draft.description}
                    maxLength={1000}
                    rows={3}
                    onChange={(event) => set("description", event.target.value)}
                  />
                </label>
                <label>
                  기준가 (위스)
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    required
                    value={draft.initialPrice}
                    disabled={Boolean(selected)}
                    onChange={(event) =>
                      set("initialPrice", event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  변동 간격
                  <select
                    value={draft.intervalHours}
                    onChange={(event) =>
                      set("intervalHours", Number(event.target.value))
                    }
                  >
                    <option value={1}>1시간</option>
                    <option value={6}>6시간</option>
                    <option value={24}>24시간</option>
                  </select>
                </label>
                <label>
                  발행 주식 수
                  <input
                    type="number"
                    min={1}
                    max={1000000000}
                    step={1}
                    required
                    value={draft.issuedShares}
                    onChange={(event) =>
                      set("issuedShares", event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  주문 단위 (주)
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    required
                    value={draft.lotSize}
                    onChange={(event) =>
                      set("lotSize", event.target.valueAsNumber)
                    }
                  />
                </label>
                <label className="wis-stocks__wide">
                  거래 상태
                  <select
                    value={draft.tradingStatus}
                    onChange={(event) =>
                      set(
                        "tradingStatus",
                        event.target.value as WisStockSettings["tradingStatus"],
                      )
                    }
                  >
                    <option value="ACTIVE">매수·매도 가능</option>
                    <option value="SELL_ONLY">매도만 가능</option>
                    <option value="HALTED">거래 정지</option>
                  </select>
                </label>
                <label className="wis-stocks__wide">
                  <span>
                    가격 흐름
                    <InfoHelp label="가격 흐름">
                      <p>
                        역사 종목은 기본 변화율을 중심으로 추세와 조정이
                        이어집니다. 가치 종목은 장기 성장 기준을 따르지만 단기
                        하락과 급락이 생길 수 있습니다. 가격 상한과 거래 정지는
                        동일하게 적용됩니다. 자동 상장폐지는 하지 않습니다.
                      </p>
                    </InfoHelp>
                  </span>
                  <select
                    aria-label="가격 흐름"
                    value={draft.growthProfile || "HISTORICAL"}
                    onChange={(event) =>
                      set(
                        "growthProfile",
                        event.target.value as WisStockSettings["growthProfile"],
                      )
                    }
                  >
                    <option value="HISTORICAL">역사 종목</option>
                    <option value="VALUE">장기 가치 종목</option>
                  </select>
                </label>
                <label>
                  최저가 (위스)
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    required
                    value={draft.minimumPrice}
                    onChange={(event) =>
                      set("minimumPrice", event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  최고가 (위스)
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    required
                    value={draft.maximumPrice}
                    onChange={(event) =>
                      set("maximumPrice", event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  <span>
                    무작위 변동폭 (%){" "}
                    <InfoHelp label="무작위 변동폭">
                      <p>
                        추세·횡보·조정과 무작위 충격의 크기를 조절합니다. 매번
                        같은 폭으로 오르내리지 않으며, 일일 등락 한도와 종목의
                        최저·최고가를 함께 적용합니다.
                      </p>
                    </InfoHelp>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.01}
                    required
                    value={draft.volatilityBps / 100}
                    onChange={(event) =>
                      set(
                        "volatilityBps",
                        Math.round(event.target.valueAsNumber * 100),
                      )
                    }
                  />
                </label>
                <label>
                  <span>
                    기본 변화율 (%){" "}
                    <InfoHelp label="기본 변화율">
                      <p>
                        가격 흐름의 기본 방향입니다. −3%에서 +3%까지 설정하며,
                        실제 변화에는 추세·조정·무작위 충격이 함께 반영됩니다.
                      </p>
                    </InfoHelp>
                  </span>
                  <input
                    type="number"
                    min={-3}
                    max={3}
                    step={0.01}
                    required
                    value={draft.trendBps / 100}
                    onChange={(event) =>
                      set(
                        "trendBps",
                        Math.round(event.target.valueAsNumber * 100),
                      )
                    }
                  />
                </label>
                <label className="wis-stocks__automatic wis-stocks__wide">
                  <input
                    type="checkbox"
                    checked={draft.automatic}
                    onChange={(event) => set("automatic", event.target.checked)}
                  />
                  자동 가격 변동
                </label>
              </fieldset>
              {canManage && (
                <div className="wis-stocks__form-actions">
                  <button
                    type="submit"
                    className="wis-stocks__primary"
                    disabled={
                      saving ||
                      loading ||
                      conflict ||
                      (!dirty && Boolean(selected))
                    }
                  >
                    {saving ? "저장 중…" : selected ? "변경 저장" : "종목 등록"}
                  </button>
                </div>
              )}
            </form>
          )}
          {canManage && (
            <div className="wis-stocks__add-action">
              <button
                type="button"
                className="wis-stocks__primary"
                disabled={
                  saving || loading || dirty || stats.count >= market.maxStocks
                }
                onClick={() => choose()}
              >
                {stats.count >= market.maxStocks
                  ? "등록 한도 도달"
                  : "새 종목 추가"}
              </button>
            </div>
          )}
        </div>
      )}
      {market && (
        <div hidden={tab !== "rules"}>
          <WisStockMarketRules
            key={ownerKey}
            market={market}
            config={{ year, semester }}
            canManage={canManage}
            busy={saving || loading}
            onBusyChange={setSaving}
            onSaved={applyMarket}
            onReload={load}
          />
        </div>
      )}
      {market && tab === "preview" && (
        <WisStockChartPreview
          stocks={market.stocks}
          rules={market.rules}
          revision={market.revision}
          semesterId={market.semesterId}
        />
      )}
      {market && tab === "investments" && (
        <WisStockInvestmentBoard
          key={ownerKey}
          year={year}
          semester={semester}
        />
      )}
    </section>
  );
}
