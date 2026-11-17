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
  const [data, setData] = useState<WisStockInvestmentBoardState | null>(null);
  const [classes, setClasses] = useState<
    WisStockInvestmentBoardState["classes"]
  >([]);
  const [connection, setConnection] =
    useState<WisStockBoardConnection>("CONNECTING");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [classKey, setClassKey] = useState("all");
  const [sort, setSort] = useState("class");
  const [page, setPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [histories, setHistories] = useState<WisStockInvestmentHistory[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(0);
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
  // Sort the membership key so a rank-only change does not repeat history reads.
  const historyKeys = JSON.stringify(
    topReturns.map((row) => row.studentKey).sort(),
  );
  const sourceRevision = live ? data.sourceRevision : 0;
  useEffect(() => {
    let active = true;
    const studentKeys: string[] = JSON.parse(historyKeys);
    setHistories([]);
    setHistoryError("");
    setHistoryLoading(Boolean(live && studentKeys.length));
    if (!live || !studentKeys.length) return;
    const [grade = "", classNumber = ""] =
      classKey === "all" ? [] : classKey.split(":");
    void getWisStockInvestmentHistories({
      year,
      semester,
      grade,
      classNumber,
      studentKeys,
    })
      .then((next) => {
        if (active) setHistories(next);
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
  }, [
    year,
    semester,
    classKey,
    live,
    historyKeys,
    sourceRevision,
    historyRetry,
  ]);
  useEffect(() => {
    if (!live || !data) return;
    // Keep real quote observations without rereading immutable trade ledgers.
    setHistories((previous) =>
      previous.map((history) => {
        const row = data.rows.find(
          (item) => item.studentKey === history.studentKey,
        );
        if (!row || data.asOfMs <= history.asOfMs) return history;
        return {
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
        };
      }),
    );
  }, [data, live]);
  const historySeries = topReturns.map((row) => {
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
      {live && (
        <section
          className="wis-investment-board__returns"
          aria-label="보유 수익률 상위 5명"
        >
          <div className="wis-investment-board__returns-heading">
            <h3>보유 수익률 상위 5명</h3>
            <InfoHelp label="보유 수익률 변화 기준">
              <p>
                선택한 학급의 현재 보유 수익률 상위 5명을 비교합니다. 그때
                보유한 주식의 평가손익을 수수료가 포함된 보유 원가로 나눈
                비율이며, 실제 체결 내역과 저장된 시세로 계산합니다. 계좌 현금과
                실현손익은 제외하며, 보유 주식이나 시세 기록이 없는 구간은 선을
                잇지 않습니다.
              </p>
            </InfoHelp>
            <RefreshButton
              label="수익률 기록 새로고침"
              disabled={!topReturns.length}
              loading={historyLoading}
              onClick={() => setHistoryRetry((value) => value + 1)}
            />
          </div>
          {!topReturns.length ? (
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
            <WisStockReturnHistoryChart series={historySeries} />
          )}
        </section>
      )}
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
        className="wis-investment-board__table"
        tabIndex={0}
        role="region"
        aria-label="학생 투자 내역"
        aria-busy={connection === "CONNECTING" && !error}
      >
        {ready && rows.length > 0 ? (
          <table>
            <caption className="sr-only">
              학급별 학생 주식 투자 현황, 금액 단위 위스
            </caption>
            <thead>
              <tr>
                <th>학급</th>
                <th>번호</th>
                <th>이름</th>
                <th>계좌 현금</th>
                <th>매수 예약</th>
                <th>보유 종목</th>
                <th>주식 평가액</th>
                <th>총자산</th>
                <th>실현손익</th>
                <th>평가손익</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.studentKey}>
                  <td>
                    {row.grade}-{row.classNumber}
                  </td>
                  <td>{row.studentNumber}</td>
                  <td>{row.displayName}</td>
                  <td>{money(row.stockCash)}</td>
                  <td>{money(row.reservedCash)}</td>
                  <td>{row.holdingCount}개</td>
                  <td>{money(row.holdingValue)}</td>
                  <td>
                    <strong>{money(row.totalAssets)}</strong>
                  </td>
                  <td className={`is-${direction(row.realizedPnl)}`}>
                    {signed(row.realizedPnl)}
                  </td>
                  <td className={`is-${direction(row.unrealizedPnl)}`}>
                    {signed(row.unrealizedPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
