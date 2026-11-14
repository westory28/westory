import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { animate, createScope } from "animejs";
import { useAuth } from "../../../../contexts/AuthContext";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import InfoHelp from "../../../../components/common/InfoHelp";
import RefreshButton from "../../../../components/common/RefreshButton";
import { getYearSemester } from "../../../../lib/semesterScope";
import {
  getWisStockManagement,
  saveWisStock,
  wisStockErrorMessage,
  type WisStock,
  type WisStockConfig,
  type WisStockManagement,
  type WisStockSettings,
} from "../../../../lib/wisStocksClient";
import "./TeacherWisStocks.css";

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
});
const date = (value: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(value);
function StockChart({ stock }: { stock: WisStock }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scope = createScope({
      root,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (context && !context.matches.reduceMotion)
        animate(".wis-stock-chart__plot", {
          opacity: [0, 1],
          y: [8, 0],
          duration: 300,
          ease: "out(3)",
        });
    });
    return () => scope.revert();
  }, [stock.id, stock.updatedAtMs]);
  const prices = stock.history.map((point) => point.price);
  const low = Math.min(...prices),
    high = Math.max(...prices),
    range = Math.max(1, high - low);
  const times = stock.history.map((point) => point.atMs);
  const firstAtMs = Math.min(...times),
    lastAtMs = Math.max(...times);
  const timeRange = lastAtMs - firstAtMs;
  const points = stock.history
    .map(
      (point) =>
        `${16 + (timeRange > 0 ? (point.atMs - firstAtMs) / timeRange : 0) * 568},${152 - ((point.price - low) / range) * 120}`,
    )
    .join(" ");
  return (
    <div ref={root} className="wis-stock-chart">
      <div className="wis-stock-chart__values">
        <span>최고 {high.toLocaleString()} 위스</span>
        <span>최저 {low.toLocaleString()} 위스</span>
      </div>
      <svg
        viewBox="0 0 600 176"
        role="img"
        aria-label={`${stock.settings.name} 가격 변동. 현재 ${stock.price.toLocaleString()} 위스, 최근 변동 ${prices.length}건.`}
      >
        <line
          x1="16"
          y1="152"
          x2="584"
          y2="152"
          className="wis-stock-chart__axis"
        />
        <g className="wis-stock-chart__plot">
          <polyline points={points} fill="none" />
          {stock.history.length === 1 && <circle cx="16" cy="152" r="4" />}
        </g>
      </svg>
      <div className="wis-stock-chart__values">
        <span>{date(firstAtMs)}</span>
        <span>{date(lastAtMs)}</span>
      </div>
    </div>
  );
}
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
  const ownerKey = `${currentUser?.uid || ""}:${authGeneration}:${year}:${semester}`;
  const generation = useRef(0);
  const owner = useRef(ownerKey);
  owner.current = ownerKey;
  const [market, setMarket] = useState<WisStockManagement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      const currentSelection = editor.current;
      if (currentSelection.selectedId && !currentSelection.dirty) {
        const updated = result.stocks.find(
          (stock) => stock.id === currentSelection.selectedId,
        );
        if (updated) setDraft({ ...updated.settings });
      }
      setMarket(result);
    } catch (failure) {
      if (sequence === generation.current && owner.current === ownerKey)
        setError(wisStockErrorMessage(failure));
    } finally {
      if (sequence === generation.current && owner.current === ownerKey)
        setLoading(false);
    }
  }, [ownerKey, year, semester]);
  useEffect(() => {
    setMarket(null);
    setSelectedId(null);
    setDraft(emptySettings());
    setError("");
    setSaving(false);
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
  const set = <K extends keyof WisStockSettings>(
    key: K,
    value: WisStockSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const choose = (stock?: WisStock) => {
    setSelectedId(stock?.id || "");
    setDraft(stock ? { ...stock.settings } : emptySettings());
    setError("");
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
    );
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!market || selectedId === null || saving || !canManage) return;
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
      setMarket(result);
      setSelectedId(result.savedStockId);
      setDraft({
        ...result.stocks.find((stock) => stock.id === result.savedStockId)!
          .settings,
      });
      showToast({
        title: result.changed
          ? "종목을 저장했습니다."
          : "저장된 내용을 확인했습니다.",
        tone: "success",
      });
    } catch (failure) {
      if (sequence === generation.current && owner.current === expectedOwner)
        setError(wisStockErrorMessage(failure));
    } finally {
      if (sequence === generation.current && owner.current === expectedOwner)
        setSaving(false);
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
  return (
    <section className="wis-stocks" aria-label="위스 주식 관리">
      <div className="wis-stocks__toolbar">
        <div className="wis-stocks__title">
          <h2>위스 주식</h2>
          <span className="wis-stocks__closed">학생 비공개</span>
          <InfoHelp label="주식 운영 기준">
            <p>
              교사 준비용 모의 시장입니다. 학생 조회와 매매는 닫혀 있습니다.
              종목은 학기당 40개까지, 가격 변동은 종목별 최근 120건까지
              보관합니다. 자동 변동은 매시간 확인하며 정한 간격이 지난 종목만
              반영합니다.
            </p>
          </InfoHelp>
        </div>
        <div className="wis-stocks__actions">
          <RefreshButton onClick={load} loading={loading} disabled={saving} />
          {canManage && (
            <button
              type="button"
              className="wis-stocks__primary"
              disabled={
                !market ||
                loading ||
                saving ||
                stats.count >= (market?.maxStocks || 40)
              }
              onClick={() => choose()}
            >
              종목 등록
            </button>
          )}
        </div>
      </div>
      {market && (
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
        <p className="wis-stocks__error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">주식 자료를 불러오는 중입니다.</p>}
      {market && !loading && (
        <div
          className={`wis-stocks__workspace${selectedId !== null ? " is-editing" : ""}`}
        >
          <div className="wis-stocks__list">
            {market.stocks.length === 0 ? (
              <p className="wis-stocks__empty">등록된 종목이 없습니다.</p>
            ) : (
              market.stocks.map((stock) => (
                <button
                  type="button"
                  key={stock.id}
                  className={`wis-stocks__row${selectedId === stock.id ? " is-selected" : ""}`}
                  disabled={saving}
                  aria-pressed={selectedId === stock.id}
                  onClick={() => choose(stock)}
                >
                  <span className="wis-stocks__row-name">
                    <strong>{stock.settings.name}</strong>
                    <span>{stock.settings.period || "시대 미지정"}</span>
                  </span>
                  <span className="wis-stocks__row-price">
                    <strong>{stock.price.toLocaleString()} 위스</strong>
                    <span>
                      {stock.settings.automatic
                        ? `${stock.settings.intervalHours}시간마다 자동`
                        : "자동 변동 정지"}
                    </span>
                  </span>
                </button>
              ))
            )}
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
                  onClick={() => setSelectedId(null)}
                >
                  닫기
                </button>
              </div>
              {selected && (
                <>
                  <div className="wis-stocks__quote">
                    <strong>
                      {selected.price.toLocaleString()} <small>위스</small>
                    </strong>
                    <span>현재가</span>
                  </div>
                  <StockChart stock={selected} />
                </>
              )}
              <fieldset disabled={!canManage || saving}>
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
                        각 변동 시점에 선택한 폭 안에서 오르거나 내립니다. 예:
                        3%는 −3%에서 +3%입니다.
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
                        무작위 변동에 더하는 변화율입니다. −3%에서 +3%까지
                        설정할 수 있습니다.
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
                    disabled={saving || (!dirty && Boolean(selected))}
                  >
                    {saving ? "저장 중…" : selected ? "변경 저장" : "종목 등록"}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
