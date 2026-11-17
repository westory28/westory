import { useEffect, useMemo, useRef, useState } from "react";
import { animate, createScope } from "animejs";
import InfoHelp from "../../../../components/common/InfoHelp";
import RefreshButton from "../../../../components/common/RefreshButton";
import WisStockReturnHistoryChart from "./WisStockReturnHistoryChart";
import {
  getWisStockInvestmentHistories,
  wisStockInvestmentHistoryError,
  type WisStockInvestmentHistory,
} from "../../../../lib/wisStockInvestmentHistoryClient";
import { topWisStockHoldingReturns } from "./wisStockInvestmentReturns";
import {
  watchWisStockInvestmentBoard,
  type WisStockBoardConnection,
  type WisStockInvestmentBoardState,
} from "../../../../lib/wisStockInvestmentBoardClient";
import "./WisStockInvestmentBoard.css";

const money = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString("ko-KR");
const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
const direction = (value: number | undefined) =>
  !value ? "flat" : value > 0 ? "up" : "down";
const time = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Seoul",
});
const PAGE_SIZE = 20;
const periods = [
  { days: 1, label: "1일" },
  { days: 7, label: "1주" },
  { days: 30, label: "1개월" },
  { days: Infinity, label: "전체" },
];
const holdingReturn = (row: WisStockInvestmentBoardState["rows"][number]) =>
  row.holdingCount > 0 && row.holdingCostBasis > 0
    ? (row.unrealizedPnl / row.holdingCostBasis) * 100
    : null;
const percent = (value: number | null) =>
  value === null
    ? "미보유"
    : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
export default function WisStockInvestmentBoard({
  year,
  semester,
}: {
  year: string;
  semester: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(false);
  const [snapshot, setData] = useState<WisStockInvestmentBoardState | null>(
    null,
  );
  const [classes, setClasses] = useState<
    WisStockInvestmentBoardState["classes"]
  >([]);
  const [connection, setConnection] =
    useState<WisStockBoardConnection>("CONNECTING");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [classKey, setClassKey] = useState("all");
  // A scope change renders before the watcher effect clears its old snapshot.
  // Gate that snapshot synchronously so old students never enter the new request.
  const data =
    snapshot?.semesterId === `${year}-${semester}` &&
    (classKey === "all"
      ? !snapshot.grade && !snapshot.classNumber
      : `${snapshot.grade}:${snapshot.classNumber}` === classKey)
      ? snapshot
      : null;
  const [sort, setSort] = useState("class");
  const [page, setPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [histories, setHistories] = useState<WisStockInvestmentHistory[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [selectedStudentKey, setSelectedStudentKey] = useState("");
  const [periodDays, setPeriodDays] = useState(Infinity);
  // View-local reuse only. Source/session/connection/scope changes discard it.
  const historyCache = useRef({
    scope: "",
    entries: new Map<string, WisStockInvestmentHistory>(),
  });
  useEffect(() => setSelectedStudentKey(""), [year, semester, classKey]);
  const expanded = fullscreen || pageFullscreen;
  useEffect(() => {
    setError("");
    setData(null);
    setConnection("CONNECTING");
    const [grade, classNumber] = classKey === "all" ? [] : classKey.split(":");
    try {
      return watchWisStockInvestmentBoard(
        { year, semester, ...(grade ? { grade, classNumber } : {}) },
        (next) => {
          setData(next);
          if (classKey === "all") setClasses(next.classes);
        },
        (next) => {
          setConnection(next);
          if (next !== "CONNECTED") setData(null);
        },
        (failure) => {
          setError(failure.message);
          setData(null);
        },
      );
    } catch {
      setError("조회 범위를 확인하지 못했습니다. 다시 시도해 주세요.");
    }
  }, [year, semester, classKey, retry]);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!pageFullscreen) {
      if (restoreFocus.current) {
        root.current
          ?.querySelector<HTMLButtonElement>(".wis-investment-board__screen")
          ?.focus();
        restoreFocus.current = false;
      }
      return;
    }
    const modal = dialog.current;
    if (!modal) return;
    const overflow = document.body.style.overflow;
    modal.showModal();
    document.body.style.overflow = "hidden";
    restoreFocus.current = true;
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
    };
  }, [pageFullscreen]);
  const revision = data?.revision;
  useEffect(() => {
    if (data?.status !== "READY") return;
    const scope = createScope({
      root,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
    }).add((context) => {
      if (context && !context.matches.reduce)
        animate(".wis-investment-board__number", {
          opacity: [0.55, 1],
          duration: 350,
          ease: "out(2)",
        });
    });
    return () => scope.revert();
  }, [revision]);
  const rows = useMemo(
    () =>
      [...(data?.rows || [])].sort((a, b) => {
        const order =
          sort === "assets"
            ? b.totalAssets - a.totalAssets
            : sort === "pnl"
              ? b.unrealizedPnl - a.unrealizedPnl
              : 0;
        return (
          order ||
          Number(a.grade) - Number(b.grade) ||
          Number(a.classNumber) - Number(b.classNumber) ||
          Number(a.studentNumber) - Number(b.studentNumber) ||
          a.studentKey.localeCompare(b.studentKey)
        );
      }),
    [data, sort],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(
    activePage * PAGE_SIZE,
    (activePage + 1) * PAGE_SIZE,
  );
  const totals = data?.totals;
  const ready = data?.status === "READY";
  const live = !error && ready && connection === "CONNECTED";
  const topReturns = useMemo(
    () => (live ? topWisStockHoldingReturns(data?.rows || []) : []),
    [data, live],
  );
  const selectedStudent = live
    ? rows.find((row) => row.studentKey === selectedStudentKey)
    : undefined;
  const chartRows = selectedStudent
    ? [{ ...selectedStudent, returnPercent: holdingReturn(selectedStudent) }]
    : topReturns;
  // Rank/order changes alone do not repeat history reads.
  const historyKeys = JSON.stringify(
    chartRows.map((row) => row.studentKey).sort(),
  );
  const sourceRevision = live ? data.sourceRevision : 0;
  const historyScope = JSON.stringify([
    year,
    semester,
    classKey,
    sourceRevision,
    historyRetry,
  ]);
  useEffect(() => {
    let active = true;
    const studentKeys: string[] = JSON.parse(historyKeys);
    setHistories([]);
    setHistoryError("");
    setHistoryLoading(false);
    if (!live) {
      historyCache.current = { scope: "", entries: new Map() };
      return;
    }
    if (historyCache.current.scope !== historyScope)
      historyCache.current = { scope: historyScope, entries: new Map() };
    if (!studentKeys.length) return;
    const missing = studentKeys.filter(
      (key) => !historyCache.current.entries.has(key),
    );
    const showCached = () =>
      setHistories(
        studentKeys.map((key) => historyCache.current.entries.get(key)!),
      );
    if (!missing.length) {
      showCached();
      return;
    }
    setHistoryLoading(true);
    const [grade = "", classNumber = ""] =
      classKey === "all" ? [] : classKey.split(":");
    void getWisStockInvestmentHistories({
      year,
      semester,
      grade,
      classNumber,
      studentKeys: missing,
    })
      .then((next) => {
        if (!active || historyCache.current.scope !== historyScope) return;
        next.forEach((history) =>
          historyCache.current.entries.set(history.studentKey, history),
        );
        showCached();
      })
      .catch((failure) => {
        if (active) setHistoryError(wisStockInvestmentHistoryError(failure));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [year, semester, classKey, live, historyKeys, historyScope]);
  useEffect(() => {
    if (!live || !data || historyCache.current.scope !== historyScope) return;
    // Keep actual quote observations for visited students without rereading ledgers.
    const cached = historyCache.current.entries;
    cached.forEach((history, key) => {
      const row = data.rows.find((item) => item.studentKey === key);
      if (!row || data.asOfMs <= history.asOfMs) return;
      cached.set(key, {
        ...history,
        asOfMs: data.asOfMs,
        priceRevision: data.priceRevision,
        points: [
          ...history.points,
          {
            atMs: data.asOfMs,
            holdingValue: row.holdingValue,
            holdingCostBasis: row.holdingCostBasis,
          },
        ],
      });
    });
    setHistories((previous) =>
      previous.map((history) => cached.get(history.studentKey) || history),
    );
  }, [data, live, historyScope]);
  const historySeries = chartRows.map((row) => {
    const history = histories.find(
      (item) =>
        item.studentKey === row.studentKey &&
        item.semesterId === `${year}-${semester}`,
    );
    return {
      studentKey: row.studentKey,
      studentName: row.displayName,
      studentLabel: `${row.grade}-${row.classNumber} · ${row.studentNumber}번`,
      returnPercent: row.returnPercent,
      // The latest point is the actual scoped board observation, not an
      // interpolated or synthetic past return. Price updates add no requests.
      observations: history
        ? [
            ...history.points,
            ...(data && data.asOfMs > history.asOfMs
              ? [
                  {
                    atMs: data.asOfMs,
                    holdingValue: row.holdingValue,
                    holdingCostBasis: row.holdingCostBasis,
                  },
                ]
              : []),
          ]
        : [],
    };
  });
  const chartAsOfMs = Math.max(
    data?.asOfMs || 0,
    ...histories.map((history) => history.asOfMs),
  );
  const chartRange = Number.isFinite(periodDays)
    ? {
        fromMs: Math.max(1, chartAsOfMs - periodDays * 86_400_000),
        toMs: chartAsOfMs,
      }
    : undefined;
  const chartTitle = selectedStudent
    ? `${selectedStudent.displayName}의 보유 수익률`
    : "보유 수익률 상위 5명";
  const status = error
    ? "연결 오류"
    : connection === "PAUSED"
      ? "구독 일시 중지"
      : connection === "OFFLINE"
        ? "오프라인"
        : connection === "CONNECTING"
          ? "연결 중"
          : ready
            ? "실시간 연결"
            : "투자 현황 대기";
  const screen = async () => {
    setScreenError("");
    if (pageFullscreen) {
      setPageFullscreen(false);
      return;
    }
    if (document.fullscreenElement === root.current) {
      try {
        await document.exitFullscreen();
      } catch {
        setScreenError("전체 화면을 닫지 못했습니다. Esc 키로 닫아 주세요.");
      }
      return;
    }
    try {
      if (root.current?.requestFullscreen)
        await root.current.requestFullscreen();
      else setPageFullscreen(true);
    } catch {
      // Preserve presentation, focus trap and Escape when native fullscreen is
      // denied, without changing permissions or adding a data subscription.
      setPageFullscreen(true);
    }
  };
  const stats = [
    { label: "투자 학생", value: totals?.studentCount, unit: "명" },
    { label: "계좌 현금", value: totals?.stockCash, unit: "위스" },
    { label: "매수 예약", value: totals?.reservedCash, unit: "위스" },
    { label: "주식 평가액", value: totals?.holdingValue, unit: "위스" },
    { label: "실현손익", value: totals?.realizedPnl, unit: "위스", pnl: true },
    {
      label: "평가손익",
      value: totals?.unrealizedPnl,
      unit: "위스",
      pnl: true,
    },
  ];
  const content = (
    <div
      ref={root}
      className={`wis-investment-board${expanded ? " is-fullscreen" : ""}`}
      aria-label="학생 투자 현황 전광판"
    >
      <div className="wis-investment-board__toolbar">
        <h2 className={expanded ? "" : "sr-only"}>학생 투자 현황</h2>
        <label>
          학급
          <select
            aria-label="투자 현황 학급"
            value={classKey}
            onChange={(event) => {
              setClassKey(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">전체</option>
            {classes.map((item) => (
              <option
                key={`${item.grade}:${item.classNumber}`}
                value={`${item.grade}:${item.classNumber}`}
              >
                {item.grade}학년 {item.classNumber}반
              </option>
            ))}
          </select>
        </label>
        <InfoHelp label="투자 현황 기준">
          <p>
            주식 계좌의 현금에는 매수 예약금이 포함됩니다. 총자산은 계좌 현금과
            체결된 주식 평가액의 합계입니다. 평가손익은 매수 수수료를 포함한
            보유 원가와 비교하며, 실현손익과 구분합니다. 일반 지갑의 위스는
            포함하지 않습니다.
          </p>
        </InfoHelp>
        <button
          type="button"
          className="wis-investment-board__screen"
          onClick={() => void screen()}
        >
          {expanded ? "전체 화면 닫기" : "전광판 보기"}
        </button>
      </div>
      <div className="wis-investment-board__status" role="status">
        <span className={live ? "is-live" : ""}>{status}</span>
        {ready && (
          <time dateTime={new Date(data.asOfMs).toISOString()}>
            {time.format(data.asOfMs)} 기준
          </time>
        )}
      </div>
      {(error || screenError) && (
        <div role="alert" className="wis-stocks__error">
          <p>{error || screenError}</p>
          {error && (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 연결
            </button>
          )}
        </div>
      )}
      <div className="wis-investment-board__stats" aria-label="투자 합계">
        {stats.map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong
              className={`wis-investment-board__number${stat.pnl ? ` is-${direction(stat.value)}` : ""}`}
            >
              {stat.pnl && stat.value !== undefined
                ? signed(stat.value)
                : money(stat.value)}{" "}
              <small>{stat.unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="wis-investment-board__workspace">
        <section
          className="wis-investment-board__students"
          aria-label="투자 학생 목록"
        >
          <div className="wis-investment-board__list-heading">
            <span>
              {ready ? `${rows.length.toLocaleString()}명` : "학생별 투자 현황"}
            </span>
            <label>
              정렬
              <select
                aria-label="투자 현황 정렬"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(0);
                }}
              >
                <option value="class">학급·번호</option>
                <option value="assets">총자산 높은 순</option>
                <option value="pnl">평가손익 높은 순</option>
              </select>
            </label>
          </div>
          <div
            className="wis-investment-board__list"
            tabIndex={0}
            role="region"
            aria-label="학생 투자 내역"
            aria-busy={connection === "CONNECTING" && !error}
          >
            {ready && rows.length > 0 ? (
              <ul>
                {pageRows.map((row) => {
                  const value = holdingReturn(row);
                  return (
                    <li key={row.studentKey}>
                      <button
                        type="button"
                        className="wis-investment-board__student"
                        aria-pressed={
                          selectedStudent?.studentKey === row.studentKey
                        }
                        onClick={() => setSelectedStudentKey(row.studentKey)}
                      >
                        <span className="wis-investment-board__identity">
                          <strong>{row.displayName}</strong>
                          <small>
                            {row.grade}학년 {row.classNumber}반 ·{" "}
                            {row.studentNumber}번
                          </small>
                        </span>
                        <span className="wis-investment-board__student-values">
                          <strong
                            className={`is-${direction(value ?? undefined)}`}
                          >
                            {percent(value)}
                          </strong>
                          <small>총자산 {money(row.totalAssets)} 위스</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="wis-investment-board__empty">
                <strong>
                  {error
                    ? "투자 현황을 불러오지 못했습니다."
                    : connection === "CONNECTING"
                      ? "투자 현황을 확인하고 있습니다."
                      : connection === "PAUSED" || connection === "OFFLINE"
                        ? "실시간 연결이 중지되었습니다."
                        : ready
                          ? "투자 내역이 없습니다."
                          : "아직 집계된 투자 현황이 없습니다."}
                </strong>
              </div>
            )}
          </div>
          <div className="wis-investment-board__pagination">
            <span>
              {activePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              이전
            </button>
            <button
              type="button"
              disabled={activePage + 1 >= pageCount}
              onClick={() => setPage(activePage + 1)}
            >
              다음
            </button>
          </div>
        </section>
        <section
          className="wis-investment-board__returns"
          aria-label="학생 보유 수익률"
          data-view={selectedStudent ? "student" : "top-five"}
        >
          <div className="wis-investment-board__returns-heading">
            <h3>{chartTitle}</h3>
            <InfoHelp label="보유 수익률 변화 기준">
              <p>
                현재 보유 수익률 상위 5명 또는 선택한 학생의 기록입니다. 당시
                주식 평가손익을 수수료가 포함된 보유 원가로 나눈 비율이며, 계좌
                현금과 실현손익은 제외합니다. 보관된 실제 시세와 체결 기록을
                사용하며, 시세 기록이 없거나 주식을 보유하지 않은 구간은 선을
                잇지 않습니다. 기간은 마지막 확인 시각부터 최근 24시간·7일·30일
                또는 보관된 전체 기록입니다.
              </p>
            </InfoHelp>
            <RefreshButton
              label="수익률 기록 새로고침"
              disabled={!live || !chartRows.length}
              loading={historyLoading}
              onClick={() => setHistoryRetry((value) => value + 1)}
            />
          </div>
          <div className="wis-investment-board__chart-controls">
            <div
              className="ws-page-tabs"
              role="group"
              aria-label="수익률 조회 기간"
            >
              {periods.map((period) => (
                <button
                  key={period.label}
                  type="button"
                  aria-pressed={periodDays === period.days}
                  onClick={() => setPeriodDays(period.days)}
                >
                  {period.label}
                </button>
              ))}
            </div>
            {selectedStudent && (
              <button
                type="button"
                className="wis-investment-board__top-five"
                onClick={() => setSelectedStudentKey("")}
              >
                상위 5명 보기
              </button>
            )}
          </div>
          {!live ? (
            <p className="wis-investment-board__returns-empty">
              투자 현황이 연결되면 수익률 기록을 확인할 수 있습니다.
            </p>
          ) : !chartRows.length ? (
            <p className="wis-investment-board__returns-empty">
              보유 주식이 있는 학생이 없습니다.
            </p>
          ) : historyError ? (
            <div className="wis-stocks__error" role="alert">
              <p>{historyError}</p>
              <button
                type="button"
                onClick={() => setHistoryRetry((value) => value + 1)}
              >
                수익률 기록 다시 조회
              </button>
            </div>
          ) : historyLoading ? (
            <p className="wis-return-history__notice" role="status">
              수익률 기록을 확인하고 있습니다.
            </p>
          ) : (
            <WisStockReturnHistoryChart
              series={historySeries}
              range={chartRange}
              label={chartTitle}
            />
          )}
          {selectedStudent && (
            <dl
              className="wis-investment-board__detail"
              aria-label={`${selectedStudent.displayName} 투자 상세`}
            >
              {[
                { label: "계좌 현금", value: money(selectedStudent.stockCash) },
                {
                  label: "매수 예약",
                  value: money(selectedStudent.reservedCash),
                },
                {
                  label: "보유 종목",
                  value: `${selectedStudent.holdingCount}개`,
                },
                {
                  label: "주식 평가액",
                  value: money(selectedStudent.holdingValue),
                },
                {
                  label: "보유 원가",
                  value: money(selectedStudent.holdingCostBasis),
                },
                { label: "총자산", value: money(selectedStudent.totalAssets) },
                {
                  label: "실현손익",
                  value: signed(selectedStudent.realizedPnl),
                  className: `is-${direction(selectedStudent.realizedPnl)}`,
                },
                {
                  label: "평가손익",
                  value: signed(selectedStudent.unrealizedPnl),
                  className: `is-${direction(selectedStudent.unrealizedPnl)}`,
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd className={item.className}>
                    {item.value}
                    {item.label !== "보유 종목" && <small> 위스</small>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
  return pageFullscreen ? (
    <dialog
      ref={dialog}
      className="wis-investment-board-dialog"
      aria-label="학생 투자 현황 전광판"
      onCancel={(event) => {
        event.preventDefault();
        setPageFullscreen(false);
      }}
    >
      {content}
    </dialog>
  ) : (
    content
  );
}
