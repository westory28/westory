import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import {
  getStockRanking,
  getStockRankingDetail,
  type RankingRow,
  type StockRanking,
  type StockRankingDetail,
} from "../../../../lib/studentWisStockRanking";
import type { WisStockScope } from "../../../../lib/studentWisStockTypes";
import StudentWisStockReadStatus from "./StudentWisStockReadStatus";
import WisStockLoadMore from "../../../../components/common/WisStockLoadMore";

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
const percent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const colors = ["#2563eb", "#15803d", "#dc2626", "#92400e", "#1f2937"];
const dashes = [[], [8, 4], [2, 4], [10, 3, 2, 3], [12, 4, 4, 4]];

function ReturnChart({ series }: { series: StockRankingDetail[] }) {
  const points = series.flatMap((item) => item.points);
  const values = points.flatMap((point) =>
    point.returnPercent === null ? [] : [point.returnPercent],
  );
  const start = points.reduce(
    (minimum, point) => Math.min(minimum, point.atMs),
    Infinity,
  );
  const end = points.reduce(
    (maximum, point) => Math.max(maximum, point.atMs),
    0,
  );
  const axisTicks = start === end ? [start] : [start, (start + end) / 2, end];
  if (!values.length)
    return (
      <p className="student-wispi-muted">이 기간에 수익률 기록이 없습니다.</p>
    );
  return (
    <>
      <ul className="student-wispi-rank-legend" aria-label="그래프 학생">
        {series.map((item, index) => (
          <li key={item.rank}>
            <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true">
              <path
                d="M0 6H28"
                stroke={colors[index]}
                strokeWidth="2"
                strokeDasharray={dashes[index].join(" ")}
              />
            </svg>
            <span>{item.displayName}</span>
          </li>
        ))}
      </ul>
      <div
        className="student-wispi-rank-chart"
        role="img"
        aria-label={`${series.map((item) => item.displayName).join(", ")} 최근 30일 보유 수익률 추이`}
      >
        <Suspense
          fallback={<StudentWisStockReadStatus loading label="수익률 그래프" />}
        >
          <Chart
            type="line"
            data={{
              datasets: series.map((item, index) => ({
                label: item.displayName,
                data: item.points.map((point) => ({
                  x: point.atMs,
                  y: point.returnPercent,
                })),
                borderColor: colors[index],
                backgroundColor: colors[index],
                borderDash: dashes[index],
                borderWidth: 2,
                pointRadius: item.points.length > 30 ? 1 : 3,
                clip: 4,
                spanGaps: false,
              })),
            }}
            options={{
              animation: false,
              responsive: true,
              maintainAspectRatio: false,
              parsing: false,
              interaction: { intersect: false, mode: "nearest", axis: "x" },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: (items: { parsed: { x: number } }[]) =>
                      items.length ? dateTime.format(items[0].parsed.x) : "",
                    label: (item: {
                      dataset: { label: string };
                      parsed: { y: number };
                    }) => `${item.dataset.label} ${percent(item.parsed.y)}`,
                  },
                },
              },
              scales: {
                x: {
                  type: "linear",
                  min: start === end ? start - 1 : start,
                  max: start === end ? end + 1 : end,
                  afterBuildTicks: (axis: { ticks: { value: number }[] }) => {
                    axis.ticks = axisTicks.map((value) => ({ value }));
                  },
                  ticks: {
                    callback: (value: number) => shortDate.format(value),
                  },
                },
                y: {
                  beginAtZero: true,
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
    </>
  );
}

function DailyRanking({
  year,
  semester,
  reload,
}: WisStockScope & { reload: () => void }) {
  const id = useId();
  const [filter, setFilter] = useState("all");
  const [ranking, setRanking] = useState<StockRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<
    Record<number, StockRankingDetail | "error">
  >({});
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  const [myClassKey, setMyClassKey] = useState("");
  const pending = useRef(new Set<number>());
  const controller = useRef<AbortController | null>(null);
  const pagePending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    pending.current = new Set();
    pagePending.current = false;
    setRanking(null);
    setDetails({});
    setSelected(null);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setPageError("");
    void getStockRanking({ year, semester }, active.signal, { filter })
      .then((data) => {
        if (active.signal.aborted) return;
        setRanking(data);
        setOptions(data.classes);
        setMyClassKey(data.myClassKey);
        setDetails(
          Object.fromEntries(
            data.charts.map((detail) => [detail.rank, detail]),
          ),
        );
      })
      .catch((failure) => {
        if (!active.signal.aborted) setError(readProblem(failure));
      })
      .finally(() => {
        if (!active.signal.aborted) setLoading(false);
      });
    return () => active.abort();
  }, [year, semester, filter, attempt]);

  async function loadMore() {
    const signal = controller.current?.signal;
    if (
      !ranking?.nextCursor ||
      !ranking.hasMore ||
      !signal ||
      signal.aborted ||
      pagePending.current
    )
      return;
    pagePending.current = true;
    setLoadingMore(true);
    setPageError("");
    try {
      const page = await getStockRanking({ year, semester }, signal, {
        filter,
        cursor: ranking.nextCursor,
        chartCount: Math.max(0, 5 - ranking.charts.length),
      });
      if (signal.aborted) return;
      if (page.dayKey !== ranking.dayKey) {
        reload();
        return;
      }
      setRanking(
        (previous) =>
          previous && {
            ...page,
            charts: [...previous.charts, ...page.charts].slice(0, 5),
            rows: [
              ...previous.rows,
              ...page.rows.filter(
                (row) => !previous.rows.some((old) => old.rank === row.rank),
              ),
            ],
          },
      );
      setDetails((previous) => ({
        ...previous,
        ...Object.fromEntries(
          page.charts.map((detail) => [detail.rank, detail]),
        ),
      }));
    } catch (failure) {
      if (!signal.aborted) {
        const code = String((failure as { code?: string })?.code || "");
        if (/permission-denied|unauthenticated/.test(code)) {
          setRanking(null);
          setDetails({});
          setError(readProblem(failure));
        } else setPageError(readProblem(failure));
      }
    } finally {
      if (!signal.aborted) {
        pagePending.current = false;
        setLoadingMore(false);
      }
    }
  }

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
        setDetails({});
        setError(readProblem(failure));
      } else setDetails((previous) => ({ ...previous, [row.rank]: "error" }));
    } finally {
      if (!signal.aborted) pending.current.delete(row.rank);
    }
  }
  const detail = selected === null ? null : details[selected];
  const selectedRow = ranking?.rows.find((row) => row.rank === selected);
  const series =
    selected === null
      ? ranking?.charts || []
      : detail && detail !== "error"
        ? [detail]
        : [];
  return (
    <section className="student-wispi-ranking" aria-labelledby={id}>
      <div className="student-wispi-inline">
        <h2 id={id}>보유 수익률 랭킹</h2>
        {ranking && (
          <time
            className="student-wispi-muted"
            dateTime={new Date(ranking.asOfMs).toISOString()}
          >
            전일 {dateTime.format(ranking.asOfMs)} 기준 · 한국 시간
          </time>
        )}
      </div>
      <div className="student-wispi-ranking-filters" aria-label="랭킹 범위">
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          전체 순위
        </button>
        <button
          type="button"
          aria-pressed={
            filter === "my-class" || (!!myClassKey && filter === myClassKey)
          }
          disabled={!myClassKey}
          onClick={() => setFilter("my-class")}
        >
          우리 학급 순위
        </button>
        <select
          aria-label="랭킹 학급 선택"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">전체</option>
          {myClassKey && <option value="my-class">우리 학급</option>}
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <StudentWisStockReadStatus
        loading={loading}
        error={error}
        label="투자 랭킹"
        retry={() => setAttempt((value) => value + 1)}
      />
      {!loading &&
        !error &&
        ranking &&
        (ranking.status === "NOT_READY" ? (
          <div>
            <p role="status">아직 전날 랭킹이 준비되지 않았습니다.</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              다시 확인
            </button>
          </div>
        ) : !ranking.rows.length && !ranking.hasMore ? (
          <p>전날 보유 수익률이 집계된 학생이 없습니다.</p>
        ) : (
          <div className="student-wispi-ranking-layout">
            <div className="student-wispi-ranking-results">
              <ol className="student-wispi-rank-list">
                {ranking.rows.map((row) => (
                  <li className="student-wispi-rank-entry" key={row.rank}>
                    <button
                      type="button"
                      aria-pressed={row.rank === selected}
                      aria-controls={`${id}-chart`}
                      onClick={() =>
                        row.rank === selected
                          ? setSelected(null)
                          : void showDetail(row)
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
                    </button>
                  </li>
                ))}
                {(loadingMore || pageError) && (
                  <li className="student-wispi-rank-more-row">
                    <StudentWisStockReadStatus
                      loading={loadingMore}
                      error={pageError}
                      label="다음 순위"
                      retry={() => void loadMore()}
                    />
                  </li>
                )}
                {ranking.hasMore && !pageError && (
                  <li className="student-wispi-rank-more-row">
                    <WisStockLoadMore
                      loading={loadingMore}
                      onClick={() => void loadMore()}
                    />
                  </li>
                )}
              </ol>
            </div>
            <section
              className="student-wispi-rank-detail"
              id={`${id}-chart`}
              aria-label="보유 수익률 그래프"
            >
              <div className="student-wispi-inline">
                <h3>
                  {selectedRow
                    ? `${selectedRow.displayName} 보유 수익률`
                    : "상위 5명 보유 수익률"}
                </h3>
                {selected !== null && (
                  <button type="button" onClick={() => setSelected(null)}>
                    상위 5명
                  </button>
                )}
              </div>
              <p className="student-wispi-muted">최근 30일</p>
              <StudentWisStockReadStatus
                loading={selected !== null && !detail}
                error={detail === "error" ? "연결 확인" : ""}
                label="수익률 그래프"
                retry={
                  selectedRow ? () => void showDetail(selectedRow) : undefined
                }
              />
              {!!series.length && <ReturnChart series={series} />}
            </section>
          </div>
        ))}
    </section>
  );
}
function readProblem(failure: unknown) {
  const code = String((failure as { code?: string })?.code || "");
  if (/unauthenticated/.test(code)) return "로그인 상태를 확인해 주세요.";
  if (/permission-denied/.test(code)) return "현재 랭킹에 접근할 수 없습니다.";
  return "연결 확인";
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
