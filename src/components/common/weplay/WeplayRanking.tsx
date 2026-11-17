import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../../contexts/AuthContext";
import {
  canAccessTeacherPortal,
  canReadLessonManagement,
  isAdminUser,
} from "../../../lib/permissions";
import {
  getWeplayRanking,
  getWeplayRankingWeek,
  invalidateWeplayRanking,
  type WeplayRanking as RankingData,
} from "../../../lib/weplayRanking";
import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayGameId,
} from "../../../lib/weplay";
import { RHYTHM_SONGS } from "./rhythm/rhythmSongs";
import "./weplay-ranking.css";

const rhythms = [
  { id: "normal", label: "자진모리" },
  { id: "hard", label: "휘모리" },
];
const themes = {
  "history-rain": "naval",
  "joseon-yut": "yut",
  "gungdeok-rock": "rhythm",
};
const titles = {
  "history-rain": "해전 전적장",
  "joseon-yut": "윷놀이 명예방",
  "gungdeok-rock": "신명나는 명인록",
};

function RankIcon({ gameId }: { gameId: WeplayGameId }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {gameId === "history-rain" ? (
        <>
          <path d="M16 3v18M16 5l10 4-10 4M5 21h23l-5 6H10zM3 29h26" />
          <path d="M8 19V9l6 5" />
        </>
      ) : gameId === "joseon-yut" ? (
        <>
          <rect
            x="5"
            y="4"
            width="8"
            height="24"
            rx="4"
            transform="rotate(-15 9 16)"
          />
          <rect
            x="19"
            y="4"
            width="8"
            height="24"
            rx="4"
            transform="rotate(15 23 16)"
          />
          <path d="M8 11h2M8 16h2M22 11h2M22 16h2" />
        </>
      ) : (
        <>
          <circle cx="16" cy="17" r="10" />
          <circle cx="16" cy="17" r="6" />
          <path d="M6 3l5 8M26 3l-5 8M9 28l-2 2M23 28l2 2" />
        </>
      )}
    </svg>
  );
}

export default function WeplayRanking({
  gameId,
  initialCategory,
  disabled = false,
  onOpen,
  portal = "student",
}: {
  gameId: WeplayGameId;
  initialCategory?: string;
  disabled?: boolean;
  onOpen?: () => void;
  portal?: "student" | "teacher";
}) {
  const auth = useAuth();
  const { currentUser, config, userData, authGeneration, authPhase } = auth;
  const teacher = portal === "teacher";
  const teacherAllowed =
    isAdminUser(userData, currentUser?.email) ||
    (userData?.role === "staff" &&
      canAccessTeacherPortal(userData, currentUser?.email) &&
      canReadLessonManagement(userData, currentUser?.email));
  const scope = JSON.stringify([
    portal,
    currentUser?.uid,
    authGeneration,
    authPhase,
    config?.year,
    config?.semester,
    userData?.role,
    userData?.grade,
    userData?.class,
    userData?.enrollmentStatus,
    userData?.enrollmentUpdatedAt,
    userData?.registrationApprovalStatus,
    userData?.staffPermissions,
    userData?.teacherPortalEnabled,
  ]);
  const [openScope, setOpenScope] = useState("");
  const open = openScope === scope;
  const [category, setCategory] = useState(
    initialCategory ||
      (gameId === "history-rain"
        ? "mild"
        : gameId === "joseon-yut"
          ? "wins"
          : `${RHYTHM_SONGS[0].id}:normal`),
  );
  const [data, setData] = useState<RankingData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [classId, setClassId] = useState("");
  const [week, setWeek] = useState(getWeplayRankingWeek);
  const classesLoaded = useRef(false);
  const [classOptions, setClassOptions] = useState<
    { id: string; label: string }[]
  >([]);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const ready =
    !!currentUser &&
    authPhase === "ready" &&
    !disabled &&
    (!teacher || teacherAllowed);
  const close = () => {
    setOpenScope("");
    button.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    setOpenScope("");
    setData(null);
    setError(false);
    invalidateWeplayRanking(gameId, false);
  }, [scope, disabled, gameId]);
  useEffect(() => () => invalidateWeplayRanking(gameId, false), [gameId]);
  useEffect(() => {
    setClassId("");
    classesLoaded.current = false;
    setClassOptions([]);
  }, [scope]);
  useEffect(() => {
    if (!open || !ready) return;
    const syncWeek = () => {
      if (document.visibilityState === "hidden") return;
      const next = getWeplayRankingWeek();
      setWeek((previous) =>
        previous.startsAtMs === next.startsAtMs ? previous : next,
      );
    };
    const timer = window.setTimeout(
      syncWeek,
      Math.max(0, week.endsAtMs - Date.now()) + 50,
    );
    document.addEventListener("visibilitychange", syncWeek);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", syncWeek);
    };
  }, [open, ready, week.endsAtMs]);
  useEffect(() => {
    if (!open || !ready) return;
    let active = true;
    setData(null);
    setError(false);
    void getWeplayRanking(config, scope, gameId, category, {
      view: classId ? "class" : "all",
      ...(classId ? { classId } : {}),
      ...(!classesLoaded.current ? { includeClasses: true } : {}),
    })
      .then((value) => {
        if (active) {
          setData(value);
          if (value.classes) {
            setClassOptions(value.classes);
            classesLoaded.current = true;
          }
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [
    open,
    ready,
    scope,
    gameId,
    category,
    retry,
    config?.year,
    config?.semester,
    teacher,
    classId,
    week.startsAtMs,
  ]);
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [open]);
  const [songId, difficulty] = category.split(":");
  const period = data?.week || data?.period || week;
  const formatDate = (time: number) =>
    new Date(time).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    });
  if (teacher && !teacherAllowed) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`weplay-ranking-launch weplay-ranking--${themes[gameId]}`}
        disabled={!ready}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setCategory(initialCategory || category);
          setWeek(getWeplayRankingWeek());
          onOpen?.();
          setOpenScope(scope);
        }}
      >
        <RankIcon gameId={gameId} />
        <span>랭킹</span>
      </button>
      {open &&
        ready &&
        button.current &&
        createPortal(
          <div
            className={`weplay-ranking-overlay weplay-ranking--${themes[gameId]}`}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
              if (event.key !== "Tab") return;
              const controls = Array.from(
                panel.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),select:not(:disabled),[tabindex="0"]',
                ) || [],
              );
              const first = controls[0],
                last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div
              ref={panel}
              className="weplay-ranking-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="weplay-ranking-heading">
                <div className="weplay-ranking-title">
                  {gameId !== "gungdeok-rock" && (
                    <span className="weplay-ranking-emblem">
                      <RankIcon gameId={gameId} />
                    </span>
                  )}
                  <div>
                    <span>이번 주 · 상위 {data?.limit || 50}위</span>
                    <h2 id={titleId}>{titles[gameId]}</h2>
                  </div>
                </div>
                <button
                  className="weplay-ranking-close"
                  type="button"
                  onClick={close}
                  aria-label="랭킹 닫기"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    fill="none"
                  >
                    <path
                      d="m5 5 10 10M15 5 5 15"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="weplay-ranking-filters">
                <div className="weplay-ranking-options">
                  <label>
                    범위
                    <select
                      aria-label="랭킹 범위"
                      value={classId}
                      onChange={(event) => setClassId(event.target.value)}
                    >
                      <option value="">전체</option>
                      {classOptions.length > 0 && (
                        <optgroup label="학급별">
                          {classOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </label>
                </div>
                {gameId === "history-rain" && (
                  <div
                    className="weplay-ranking-options"
                    aria-label="랭킹 난이도"
                  >
                    {Object.entries(WEPLAY_DIFFICULTY_LABELS).map(
                      ([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={category === id}
                          onClick={() => setCategory(id)}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                )}
                {gameId === "gungdeok-rock" && (
                  <div className="weplay-ranking-options">
                    <label>
                      곡
                      <select
                        aria-label="랭킹 곡"
                        value={songId}
                        onChange={(event) =>
                          setCategory(`${event.target.value}:${difficulty}`)
                        }
                      >
                        {RHYTHM_SONGS.map((song) => (
                          <option key={song.id} value={song.id}>
                            {song.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      장단
                      <select
                        aria-label="랭킹 장단"
                        value={difficulty}
                        onChange={(event) =>
                          setCategory(`${songId}:${event.target.value}`)
                        }
                      >
                        {rhythms.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <p className="weplay-ranking-metric">
                {gameId === "joseon-yut"
                  ? "온라인 완주 우승"
                  : gameId === "history-rain"
                    ? "도전 최고 점수"
                    : "도전 곡·장단별 최고 점수"}
                {` · ${formatDate(period.startsAtMs)}–${formatDate(period.endsAtMs - 1)}`}
              </p>
              {data?.trackingSinceMs &&
                data.trackingSinceMs > period.startsAtMs && (
                  <p className="weplay-ranking-metric">
                    {new Date(data.trackingSinceMs).toLocaleDateString("ko-KR")}
                    부터 기록
                  </p>
                )}
              <div
                className="weplay-ranking-content"
                aria-live="polite"
                aria-busy={!data && !error}
              >
                <table
                  className="weplay-ranking-table"
                  aria-label="이번 주 랭킹"
                >
                  <thead>
                    <tr>
                      <th scope="col">순위</th>
                      <th scope="col">학번</th>
                      <th scope="col">이름</th>
                      <th scope="col">
                        {gameId === "joseon-yut" ? "승수" : "점수"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="weplay-ranking-rows">
                    {error ? (
                      <tr>
                        <td colSpan={4} className="weplay-ranking-state">
                          <div role="alert">
                            <p>랭킹을 불러오지 못했습니다.</p>
                            <button
                              type="button"
                              onClick={() => setRetry((value) => value + 1)}
                            >
                              다시 불러오기
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : !data ? (
                      <tr>
                        <td colSpan={4} className="weplay-ranking-state">
                          <p role="status">랭킹을 불러오고 있습니다.</p>
                        </td>
                      </tr>
                    ) : !data.rows.length ? (
                      <tr>
                        <td colSpan={4} className="weplay-ranking-state">
                          <p>이번 주 기록이 없습니다.</p>
                        </td>
                      </tr>
                    ) : (
                      data.rows.map((row, index) => (
                        <tr
                          key={`${row.rank}/${index}`}
                          className={row.isMe ? "is-me" : ""}
                        >
                          <td className="weplay-ranking-place">
                            {row.rank}
                            <small>위</small>
                          </td>
                          <td>{row.studentId || row.studentNumber || "—"}</td>
                          <td>
                            {row.studentName || row.studentLabel}
                            {row.isMe && <em>나</em>}
                          </td>
                          <td>
                            {row.score.toLocaleString()}
                            <small>
                              {gameId === "joseon-yut" ? "승" : "점"}
                            </small>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>,
          button.current.closest(".naval-game, .weplay-game") ||
            button.current.parentElement!,
        )}
    </>
  );
}
