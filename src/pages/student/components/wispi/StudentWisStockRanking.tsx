import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import {
  getStockRanking,
  getStockRankingDetail,
  type RankingRow,
  type StockRanking,
  type StockRankingDetail,
} from "../../../../lib/studentWisStockRanking";
import type { WisStockScope } from "../../../../lib/studentWisStockTypes";

const Chart = lazy(() => import("../../../../components/common/LazyChart"));
const dayMs = 86_400_000;
const koreaOffset = 9 * 3_600_000;
const koreaDay = () => Math.floor((Date.now() + koreaOffset) / dayMs);
const dateTime = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const shortDate = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});
const shortTime = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Seoul",
});
const percent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;

function InvestmentDetail({ detail }: { detail: StockRankingDetail }) {
  const [showRecords, setShowRecords] = useState(false);
  const start = detail.points[0]?.atMs ?? detail.asOfMs;
  const end = detail.points.at(-1)?.atMs ?? detail.asOfMs;
  const axisDate = end - start >= dayMs ? shortDate : shortTime;
  const axisTicks = start === end ? [start] : [start, (start + end) / 2, end];
  return (
    <div className="student-wispi-rank-detail">
      <section>
        <h3>최근 30일 보유 수익률</h3>
        {detail.points.some((point) => point.returnPercent !== null) ? (
          <>
            <div
              className="student-wispi-rank-chart"
              role="img"
              aria-label={`${detail.displayName} 보유 수익률 추이`}
            >
              <Suspense
                fallback={<p role="status">그래프를 불러오는 중입니다.</p>}
              >
                <Chart
                  type="line"
                  data={{
                    datasets: [
                      {
                        label: "보유 수익률",
                        data: detail.points.map((point) => ({
                          x: point.atMs,
                          y: point.returnPercent,
                        })),
                        borderColor: "#2563eb",
                        backgroundColor: "#2563eb",
                        borderWidth: 2,
                        pointRadius: detail.points.length > 30 ? 1 : 3,
                        clip: 4,
                        spanGaps: false,
                      },
                    ],
                  }}
                  options={{
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    normalized: true,
                    parsing: false,
                    interaction: {
                      intersect: false,
                      mode: "nearest",
                      axis: "x",
                    },
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          title: (items: { parsed: { x: number } }[]) =>
                            items.length
                              ? dateTime.format(items[0].parsed.x)
                              : "",
                          label: (item: { parsed: { y: number } }) =>
                            percent(item.parsed.y),
                        },
                      },
                    },
                    scales: {
                      x: {
                        type: "linear",
                        min: start === end ? start - 1 : start,
                        max: start === end ? end + 1 : end,
                        afterBuildTicks: (axis: {
                          ticks: { value: number }[];
                        }) => {
                          axis.ticks = axisTicks.map((value) => ({ value }));
                        },
                        ticks: {
                          callback: (value: number) => axisDate.format(value),
                        },
                      },
                      y: {
                        ticks: {
                          maxTicksLimit: 5,
                          callback: (value: number) => percent(value),
                        },
                      },
                    },
                  }}
                />
              </Suspense>
            </div>
            <details
              className="student-wispi-rank-records"
              onToggle={(event) => setShowRecords(event.currentTarget.open)}
            >
              <summary>수익률 기록 보기</summary>
              {showRecords && (
                <ul className="student-wispi-list">
                  {detail.points.map((point) => (
                    <li key={point.atMs}>
                      <time dateTime={new Date(point.atMs).toISOString()}>
                        {dateTime.format(point.atMs)}
                      </time>
                      <strong>
                        {point.returnPercent === null
                          ? "기록 없음"
                          : percent(point.returnPercent)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </>
        ) : (
          <p className="student-wispi-muted">
            이 기간에 수익률 기록이 없습니다.
          </p>
        )}
      </section>
      <section>
        <h3>보유 종목</h3>
        {detail.holdings.length ? (
          <ul className="student-wispi-list">
            {detail.holdings.map((holding, index) => (
              <li key={index}>
                <span>{holding.name}</span>
                <strong>{holding.quantity.toLocaleString("ko-KR")}주</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="student-wispi-muted">보유한 종목이 없습니다.</p>
        )}
      </section>
    </div>
  );
}

function DailyRanking({
  year,
  semester,
  reload,
}: WisStockScope & { reload: () => void }) {
  const id = useId();
  const [ranking, setRanking] = useState<StockRanking | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<
    Record<number, StockRankingDetail | "error">
  >({});
  const pending = useRef(new Set<number>());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void getStockRanking({ year, semester }, active.signal)
      .then((data) => {
        if (!active.signal.aborted) setRanking(data);
      })
      .catch(() => {
        if (!active.signal.aborted) setError("랭킹을 불러오지 못했습니다.");
      });
    return () => active.abort();
  }, [year, semester]);
  async function showDetail(row: RankingRow) {
    setSelected(row.rank);
    const signal = controller.current?.signal;
    if (
      !ranking ||
      !signal ||
      signal.aborted ||
      pending.current.has(row.rank) ||
      (details[row.rank] && details[row.rank] !== "error")
    )
      return;
    pending.current.add(row.rank);
    setDetails((previous) => {
      const next = { ...previous };
      delete next[row.rank];
      return next;
    });
    try {
      const data = await getStockRankingDetail(
        { year, semester },
        ranking,
        row,
        signal,
      );
      if (!signal.aborted)
        setDetails((previous) => ({ ...previous, [row.rank]: data }));
    } catch (failure) {
      if (signal.aborted) return;
      const code = String((failure as { code?: string })?.code || "");
      if (/failed-precondition|not-found/.test(code)) reload();
      else if (/permission-denied|unauthenticated/.test(code)) {
        setRanking(null);
        setError(
          "랭킹 이용 권한을 확인하지 못했습니다. 다시 로그인한 뒤 확인해 주세요.",
        );
      } else setDetails((previous) => ({ ...previous, [row.rank]: "error" }));
    } finally {
      pending.current.delete(row.rank);
    }
  }
  return (
    <section className="student-wispi-ranking" aria-labelledby={id}>
      <div className="student-wispi-inline">
        <h2 id={id}>보유 수익률 상위 5명</h2>
        {ranking && (
          <time
            className="student-wispi-muted"
            dateTime={new Date(ranking.asOfMs).toISOString()}
          >
            전일 {dateTime.format(ranking.asOfMs)} 기준 · 한국 시간
          </time>
        )}
      </div>
      {error ? (
        <div role="alert" className="student-wispi-error">
          <p>{error}</p>
          <button type="button" onClick={reload}>
            다시 불러오기
          </button>
        </div>
      ) : !ranking ? (
        <p role="status">랭킹을 불러오는 중입니다.</p>
      ) : ranking.status === "NOT_READY" ? (
        <div>
          <p role="status">아직 전날 랭킹이 준비되지 않았습니다.</p>
          <button type="button" onClick={reload}>
            다시 불러오기
          </button>
        </div>
      ) : !ranking.rows.length ? (
        <p>전날 보유 수익률이 집계된 학생이 없습니다.</p>
      ) : (
        <ol className="student-wispi-rank-list">
          {ranking.rows.map((row) => {
            const expanded = row.rank === selected;
            const detail = details[row.rank];
            const panelId = `${id}-rank-${row.rank}`;
            return (
              <li key={row.rank}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={() =>
                    expanded ? setSelected(null) : void showDetail(row)
                  }
                >
                  <span className="student-wispi-rank-number">
                    {row.rank}위
                  </span>
                  <strong>{row.displayName}</strong>
                  <b
                    className={
                      row.returnPercent > 0
                        ? "is-up"
                        : row.returnPercent < 0
                          ? "is-down"
                          : "is-flat"
                    }
                  >
                    {percent(row.returnPercent)}
                  </b>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m3 6 5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {expanded && (
                  <div id={panelId}>
                    {!detail ? (
                      <p role="status">투자 기록을 불러오는 중입니다.</p>
                    ) : detail === "error" ? (
                      <div role="alert" className="student-wispi-error">
                        <p>투자 기록을 불러오지 못했습니다.</p>
                        <button
                          type="button"
                          onClick={() => void showDetail(row)}
                        >
                          다시 불러오기
                        </button>
                      </div>
                    ) : (
                      <InvestmentDetail detail={detail} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default function StudentWisStockRanking(scope: WisStockScope) {
  const [day, setDay] = useState(koreaDay);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const midnight = (day + 1) * dayMs - koreaOffset;
    const refreshDay = () => setDay(koreaDay());
    const timer = window.setTimeout(
      refreshDay,
      Math.max(0, midnight - Date.now()),
    );
    window.addEventListener("focus", refreshDay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshDay);
    };
  }, [day]);
  return (
    <DailyRanking
      key={`${day}:${attempt}`}
      {...scope}
      reload={() => setAttempt((value) => value + 1)}
    />
  );
}
