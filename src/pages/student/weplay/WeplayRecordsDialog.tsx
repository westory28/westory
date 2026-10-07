import { useEffect, useId, useRef, useState } from "react";
import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayDifficulty,
  type WeplayLobby,
} from "../../../lib/weplay";
import WeplayLobbyIcon from "./WeplayLobbyIcon";

export type WeplayRecordsView = "ranking" | "history";
const date = (value: number) =>
  new Date(value).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
const signed = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

export default function WeplayRecordsDialog({
  view,
  lobby,
  difficulty,
  onDifficultyChange,
  onClose,
}: {
  view: WeplayRecordsView;
  lobby: WeplayLobby;
  difficulty: WeplayDifficulty;
  onDifficultyChange: (difficulty: WeplayDifficulty) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const helpId = useId();
  const help = useRef<HTMLSpanElement>(null);
  const helpPinned = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = () => {
    helpPinned.current = false;
    setHelpOpen(false);
  };
  const backdropDown = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    closeButton.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const ranking = lobby.rankingByDifficulty[difficulty] || [];
  const rewards = lobby.period?.rankingRewards[difficulty];
  const rewardFor = (rank: number) =>
    rewards?.[rank === 1 ? "first" : rank === 2 ? "second" : "third"];
  const outside = (
    event:
      | React.PointerEvent<HTMLDialogElement>
      | React.MouseEvent<HTMLDialogElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  return (
    <dialog
      ref={dialog}
      className={`weplay-records-dialog is-${view}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (helpOpen) closeHelp();
        else onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onPointerDown={(event) => {
        backdropDown.current = outside(event);
        if (!help.current?.contains(event.target as Node)) closeHelp();
      }}
      onClick={(event) => {
        if (backdropDown.current && outside(event)) onClose();
        backdropDown.current = false;
      }}
    >
      <div className="weplay-records-header">
        <h2 id={titleId}>
          <WeplayLobbyIcon name={view === "ranking" ? "ranking" : "history"} />
          {view === "ranking" ? "우리 반 랭킹" : "내 기록"}
        </h2>
        {view === "ranking" && (
          <span
            ref={help}
            className="weplay-ranking-help"
            onMouseEnter={() => setHelpOpen(true)}
            onMouseLeave={() => {
              if (!helpPinned.current) setHelpOpen(false);
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                closeHelp();
            }}
          >
            <button
              type="button"
              aria-label="랭킹 기준 안내"
              aria-expanded={helpOpen}
              aria-describedby={helpOpen ? helpId : undefined}
              onFocus={() => setHelpOpen(true)}
              onClick={() => {
                helpPinned.current = !helpPinned.current;
                setHelpOpen(helpPinned.current);
              }}
            >
              <WeplayLobbyIcon name="info" />
            </button>
            {helpOpen && (
              <span id={helpId} role="tooltip">
                도전 모드의 한 판 최고 점수로 순위를 정합니다. 같은 점수는 먼저
                달성한 기록이 앞섭니다.
              </span>
            )}
          </span>
        )}
        <button
          ref={closeButton}
          type="button"
          className="weplay-records-close"
          aria-label="닫기"
          onClick={onClose}
        >
          <WeplayLobbyIcon name="close" />
        </button>
      </div>
      {view === "ranking" ? (
        <>
          <div
            className="weplay-mode weplay-rank-difficulties"
            role="group"
            aria-label="난이도별 랭킹"
          >
            {(Object.keys(WEPLAY_DIFFICULTY_LABELS) as WeplayDifficulty[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={difficulty === value}
                  onClick={() => onDifficultyChange(value)}
                >
                  {WEPLAY_DIFFICULTY_LABELS[value]}
                </button>
              ),
            )}
          </div>
          {lobby.period && (
            <p className="weplay-ranking-period">
              {date(lobby.period.startsAtMs)} ~{" "}
              {date(lobby.period.endsAtMs - 1)}
              <span>한 판 최고 기록</span>
            </p>
          )}
          <div
            className="weplay-podium-stage"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(23,30,36,.88), rgba(22,60,78,.82)), url("${import.meta.env.BASE_URL}assets/weplay/naval/sea-battle.webp")`,
            }}
          >
            <ol className="weplay-podium" aria-label="상위 3위 시상대">
              {[1, 2, 3].map((rank) => {
                const row = ranking.find((entry) => entry.rank === rank);
                const reward = rewardFor(rank);
                return (
                  <li
                    key={rank}
                    className={`weplay-podium-place place-${rank}${row?.isMe ? " is-me" : ""}`}
                    aria-label={`${rank}위 ${row?.studentLabel || "기록 없음"}`}
                  >
                    <div className="weplay-podium-player">
                      <span className="weplay-rank-pennant" aria-hidden="true">
                        <WeplayLobbyIcon name="anchor" />
                      </span>
                      <strong className="weplay-podium-name">
                        {row ? (
                          <>
                            {row.studentLabel}
                            {row.isMe && <span className="weplay-me">나</span>}
                          </>
                        ) : (
                          "기록 없음"
                        )}
                      </strong>
                      <span className="weplay-podium-score">
                        {row ? `${row.score.toLocaleString()}점` : "—"}
                      </span>
                    </div>
                    <div className="weplay-podium-step">
                      <strong>
                        {rank}
                        <small>위</small>
                      </strong>
                      {reward !== undefined && (
                        <span>{reward.toLocaleString()} 위스</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          {!ranking.length && (
            <p className="weplay-records-empty">아직 도전 기록이 없습니다.</p>
          )}
          {ranking.length > 3 && (
            <ol
              className="weplay-ranking weplay-ranking-tail"
              start={4}
              aria-label="4위 이하 랭킹"
            >
              {ranking
                .filter((row) => row.rank > 3)
                .map((row) => (
                  <li key={row.rank} className={row.isMe ? "is-me" : ""}>
                    <span className="weplay-tail-rank">{row.rank}위</span>
                    <span className="weplay-tail-name">
                      {row.studentLabel}
                      {row.isMe && <span className="weplay-me">나</span>}
                    </span>
                    <strong>{row.score.toLocaleString()}점</strong>
                  </li>
                ))}
            </ol>
          )}
        </>
      ) : lobby.records.length ? (
        <ul className="weplay-personal-records">
          {lobby.records.map((record) => (
            <li key={record.sessionId}>
              <div className="weplay-record-meta">
                <time dateTime={new Date(record.finishedAtMs).toISOString()}>
                  {date(record.finishedAtMs)}
                </time>
                <span>
                  {record.mode === "practice" ? "연습" : "도전"} ·{" "}
                  {WEPLAY_DIFFICULTY_LABELS[record.difficulty]}
                </span>
              </div>
              <div className="weplay-record-score">
                <strong>
                  {record.score.toLocaleString()}
                  <small>점</small>
                </strong>
                <span>
                  {record.correctCount}/{record.totalWords}개
                </span>
                <span
                  className={`weplay-record-wis${record.netWis > 0 ? " is-gain" : ""}`}
                >
                  {record.mode === "practice"
                    ? "위스 변동 없음"
                    : `${signed(record.netWis)} 위스`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="weplay-records-empty">아직 게임 기록이 없습니다.</p>
      )}
    </dialog>
  );
}
