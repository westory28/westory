import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getStudentRouteAccess } from "../../lib/studentMenuAccess";
import {
  STUDENT_WISPI_URL,
  STUDENT_WISPI_VIEWS,
  studentWispiViewSearch,
  type StudentWispiView,
} from "../../lib/studentWisStockTypes";
import {
  useStudentWisStockStatus,
  useWisStockFxRate,
} from "../../hooks/useStudentWisStocks";
import { getYearSemester } from "../../lib/semesterScope";
import {
  DOMESTIC_STOCK_VENUE,
  OVERSEAS_STOCK_VENUE,
} from "../../lib/studentWisStockVenue";
import StudentWisStockRanking from "./components/wispi/StudentWisStockRanking";
import StudentWisStockReadStatus from "./components/wispi/StudentWisStockReadStatus";
import StudentWisStockMarketView from "./components/wispi/StudentWisStockMarketView";
import StudentWisStockAccountView from "./components/wispi/StudentWisStockAccountView";
import StudentWisStockExchangePanel from "./components/wispi/StudentWisStockExchangePanel";
import { WisStockVenueContext } from "./components/wispi/wisStockVenueContext";
import "./components/wispi/studentWisStocks.css";

const money = (value: number) => value.toLocaleString("ko-KR");
type View = StudentWispiView;
const isView = (value: string | null): value is View =>
  STUDENT_WISPI_VIEWS.some((view) => view.id === value);

export default function StudentWisStocks() {
  const { currentUser, authGeneration, config, menuConfig } = useAuth();
  const scope = getYearSemester(config);
  const [params, setParams] = useSearchParams();
  // A tab hidden in the sitemap is also hidden here, so it never sends the
  // student to the hidden-menu redirect.
  const views = STUDENT_WISPI_VIEWS.filter(
    (view) =>
      getStudentRouteAccess(
        {
          pathname: STUDENT_WISPI_URL,
          search: studentWispiViewSearch(view.id),
        },
        config,
        menuConfig,
      ).allowed,
  );
  const requested = params.get("tab");
  const tab: View = isView(requested)
    ? requested
    : views.some((view) => view.id === "market")
      ? "market"
      : (views[0]?.id ?? "market");
  const go = (next: View, account?: "yus") => {
    if (next === tab && !account) return;
    const search = new URLSearchParams();
    if (next !== "market") search.set("tab", next);
    if (account) search.set("account", account);
    setParams(search);
  };
  const status = useStudentWisStockStatus();
  const overseasStatus = useStudentWisStockStatus(true, OVERSEAS_STOCK_VENUE);
  const opened = status.data?.studentOpen === true;
  const overseasOpened = overseasStatus.data?.studentOpen === true;
  const fx = useWisStockFxRate(opened && overseasOpened);
  const ownerKey = `${currentUser?.uid}:${scope.year}:${scope.semester}`;
  // A reconnect (returning to the browser tab, network change) briefly reloads
  // the public status. Views opened before stay mounted but hidden meanwhile,
  // so an open ticket, search, filter or draft amount survives.
  const keptOwner = useRef("");
  if (opened) keptOwner.current = ownerKey;
  else if (status.status !== "loading") keptOwner.current = "";
  const showStage =
    opened || (status.status === "loading" && keptOwner.current === ownerKey);
  const keptOverseasOwner = useRef("");
  if (overseasOpened) keptOverseasOwner.current = ownerKey;
  else if (overseasStatus.status !== "loading") keptOverseasOwner.current = "";
  const showOverseas =
    overseasOpened ||
    (overseasStatus.status === "loading" &&
      keptOverseasOwner.current === ownerKey);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);
  const tradingEnabled =
    opened && status.status === "ready" && !status.data.halted;
  const overseasTradingEnabled =
    overseasOpened &&
    overseasStatus.status === "ready" &&
    !overseasStatus.data.halted;
  const activeOverseas = tab === "overseas";
  const stopped = activeOverseas
    ? overseasOpened && overseasStatus.data?.halted === true
    : tab !== "exchange" && opened && status.data?.halted === true;
  const rate = fx.status === "ready" && fx.data ? fx.data : null;
  return (
    <main className="ws-page student-wispi">
      <header className="ws-page-header student-wispi-header">
        <h1>위스피(WsPI)</h1>
        {rate && (
          <p className="student-wispi-fx-chip">
            오늘 환율
            <strong>1,000유스 = {money(rate.rate)}위스</strong>
          </p>
        )}
      </header>
      <StudentWisStockReadStatus
        loading={status.status === "loading"}
        error={status.error}
        label="위스피"
        retry={status.retry}
      />
      {status.status === "ready" && !opened && (
        <p>아직 위스피가 열리지 않았습니다.</p>
      )}
      {showStage && (
        <>
          <nav
            className="ws-page-tabs"
            aria-label="위스피 메뉴"
            hidden={!opened}
          >
            {views.map((view) => (
              <button
                type="button"
                key={view.id}
                aria-pressed={tab === view.id}
                aria-current={tab === view.id ? "page" : undefined}
                onClick={() => go(view.id)}
              >
                {view.label}
              </button>
            ))}
          </nav>
          <div className="student-wispi-stage" hidden={!opened}>
            <div
              className={
                stopped
                  ? "student-wispi-content is-stopped"
                  : "student-wispi-content"
              }
              aria-hidden={stopped || undefined}
              ref={(node) => {
                if (node) node.inert = stopped;
              }}
            >
              {tab === "market" && (
                <WisStockVenueContext.Provider value={DOMESTIC_STOCK_VENUE}>
                  <StudentWisStockMarketView
                    key={`${ownerKey}:DOMESTIC`}
                    scope={scope}
                    ownerKey={ownerKey}
                    tradingEnabled={tradingEnabled}
                    tradingEpoch={status.data?.tradingEpoch}
                    onOpenAccount={() => go("account")}
                    onOpenExchange={() => go("exchange")}
                  />
                </WisStockVenueContext.Provider>
              )}
              {tab === "overseas" && (
                <>
                  {overseasStatus.status !== "ready" && (
                    <StudentWisStockReadStatus
                      loading={overseasStatus.status === "loading"}
                      error={overseasStatus.error}
                      label="해외 주식"
                      retry={overseasStatus.retry}
                    />
                  )}
                  {showOverseas ? (
                    <div hidden={!overseasOpened}>
                      <WisStockVenueContext.Provider
                        value={OVERSEAS_STOCK_VENUE}
                      >
                        <StudentWisStockMarketView
                          key={`${ownerKey}:OVERSEAS`}
                          scope={scope}
                          ownerKey={ownerKey}
                          tradingEnabled={overseasTradingEnabled}
                          tradingEpoch={overseasStatus.data?.tradingEpoch}
                          onOpenAccount={() => go("account", "yus")}
                          onOpenExchange={() => go("exchange")}
                        />
                      </WisStockVenueContext.Provider>
                    </div>
                  ) : (
                    overseasStatus.status === "ready" && (
                      <p className="student-wispi-muted">
                        아직 해외 주식 시장이 열리지 않았습니다.
                      </p>
                    )
                  )}
                </>
              )}
              {tab === "account" && (
                <StudentWisStockAccountView
                  key={`${ownerKey}:${params.get("account") || ""}`}
                  initialSide={params.get("account") === "yus" ? "YUS" : "WIS"}
                  scope={scope}
                  ownerKey={ownerKey}
                  tradingEnabled={tradingEnabled}
                  tradingEpoch={status.data?.tradingEpoch}
                  overseasOpened={overseasOpened}
                  overseasTradingEnabled={overseasTradingEnabled}
                  overseasTradingEpoch={overseasStatus.data?.tradingEpoch}
                  onOpenExchange={() => go("exchange")}
                />
              )}
              {tab === "exchange" && (
                <StudentWisStockExchangePanel
                  key={ownerKey}
                  scope={scope}
                  ownerKey={ownerKey}
                  overseasOpened={overseasOpened}
                  exchangeOpen={tradingEnabled && overseasTradingEnabled}
                />
              )}
              {tab === "ranking" && tradingEnabled && (
                <StudentWisStockRanking
                  key={`${ownerKey}:${authGeneration}:${status.data?.tradingEpoch}`}
                  {...scope}
                />
              )}
            </div>
            {stopped && (
              <div className="student-wispi-stopped" role="alert">
                <strong>
                  {activeOverseas
                    ? "해외 주식 거래가 중지되었습니다."
                    : "위스피의 거래가 중지되었습니다."}
                </strong>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
