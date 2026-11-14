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
import { getYearSemester } from "../../../../lib/semesterScope";
import {
  wisStockCatalog,
  wisStockCatalogWeeks,
  getWisStockTemplateSettings,
} from "../../../../lib/wisStockCatalog";
import {
  getWisStockManagement,
  saveWisStock,
  setWisStockMarketHalted,
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
  const [confirmResume, setConfirmResume] = useState(false);
  const haltIntent = useRef(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
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
    setTemplateId("");
    setDraft(emptySettings());
    setError("");
    setSaving(false);
    setConflict(false);
    setHalting(false);
    haltFlight.current = false;
    setHaltError("");
    setHaltConflict(false);
    setConfirmResume(false);
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
  const set = <K extends keyof WisStockSettings>(
    key: K,
    value: WisStockSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const choose = (stock?: WisStock) => {
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
    setConfirmResume(false);
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
          ? "시장 거래를 정지했습니다."
          : "시장 거래를 재개했습니다.",
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
  return (
    <section className="wis-stocks" aria-label="위스피(WsPI) 관리">
      <PortalSubNavigation
        title="위스피(WsPI)"
        activeLabel={
          {
            stocks: "종목 관리",
            rules: "시장 규칙",
            preview: "주식 차트 관리",
          }[tab] || "종목 관리"
        }
        variant="tabs"
        actions={
          <>
            <span className="wis-stocks__closed">학생 비공개</span>
            <InfoHelp label="주식 운영 기준">
              <p>
                교사 준비용 모의 시장입니다. 종목과 규칙을 저장해도 학생에게
                공개되지 않습니다. 종목은 학기당 {market?.maxStocks || 100}
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
          {market?.rules.halted && <span role="status">거래 정지 중</span>}
          <button
            type="button"
            className="wis-stock-emergency__button"
            disabled={!canManage || halting}
            onClick={() => {
              if (!market?.rules.halted) void changeHalted(true);
              else if (confirmResume) void changeHalted(false);
              else setConfirmResume(true);
            }}
          >
            {halting
              ? "처리 중…"
              : market?.rules.halted
                ? confirmResume
                  ? "거래 재개 확인"
                  : "시장 거래 재개"
                : "시장 거래 정지"}
          </button>
          {confirmResume && !halting && (
            <button type="button" onClick={() => setConfirmResume(false)}>
              재개 취소
            </button>
          )}
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
      {market && (
        <div
          className={`wis-stocks__workspace${selectedId !== null ? " is-editing" : ""}`}
          hidden={tab !== "stocks"}
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
                  disabled={saving || loading}
                  aria-pressed={selectedId === stock.id}
                  onClick={() => choose(stock)}
                >
                  {wisStockCatalog.find(
                    (company) => company.name === stock.settings.name,
                  )?.logoUrl && (
                    <img
                      className="wis-stocks__catalog-logo"
                      src={
                        wisStockCatalog.find(
                          (company) => company.name === stock.settings.name,
                        )!.logoUrl
                      }
                      width={32}
                      height={32}
                      alt=""
                    />
                  )}
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
              <fieldset disabled={!canManage || saving || loading}>
                {!selected && (
                  <label className="wis-stocks__wide">
                    <span>
                      종목 초안
                      <InfoHelp label="종목 초안">
                        <p>
                          6주 기획안에서 한 종목의 이름·설명을 가져옵니다.
                          작성한 내용은 선택한 초안으로 바뀌며, 아래 종목 등록을
                          눌러야 저장됩니다. 기획안의 상장·등락·퇴장 일정은 자동
                          실행되지 않습니다.
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
                disabled={saving || loading || stats.count >= market.maxStocks}
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
    </section>
  );
}
