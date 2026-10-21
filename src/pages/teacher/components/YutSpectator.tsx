import { useEffect, useRef, useState } from "react";
import { YUT_WAITING_MS } from "../../../../functions/yutCore.mjs";
import { getYutManagementProgress } from "../../../../functions/yutManagement.mjs";
import { InlineLoading } from "../../../components/common/LoadingState";
import YutBoard from "../../../components/common/weplay/yut/YutBoard";
import {
  PROFESSIONS,
  YutPortrait,
} from "../../../components/common/weplay/yut/YutArt";
import {
  subscribeYutRoom,
  yutErrorMessage,
  type YutRoom,
} from "../../../lib/yut";
import type { WeplayConfig } from "../../../lib/weplay";
import "./YutSpectator.css";

type View = {
  key: string;
  status: "loading" | "live" | "paused" | "error" | "ended";
  room: YutRoom | null;
  message?: string;
};
const doNothing = () => {};

export default function YutSpectator({
  config,
  roomId,
  actorKey,
  serverOffsetMs = 0,
}: {
  config: WeplayConfig;
  roomId: string;
  actorKey: string;
  serverOffsetMs?: number;
}) {
  const year = config?.year;
  const semester = config?.semester;
  const key = JSON.stringify([actorKey, year, semester, roomId]);
  const identity = useRef(key);
  identity.current = key;
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [clock, setClock] = useState(Date.now);
  const current = view?.key === key ? view : null;
  const room = current?.status === "live" ? current.room : null;

  useEffect(() => {
    let active = true;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    let expiry: number | undefined;
    let terminal: { status: "error" | "ended"; message: string } | undefined;
    const stop = () => {
      generation += 1;
      unsubscribe?.();
      unsubscribe = undefined;
      window.clearTimeout(expiry);
    };
    const publish = (status: View["status"], message?: string) =>
      setView({ key, status, room: null, message });
    const connect = () => {
      stop();
      if (!active || identity.current !== key) return;
      if (document.hidden) {
        publish("paused", "관전이 일시 중지되었습니다.");
        return;
      }
      if (terminal) {
        publish(terminal.status, terminal.message);
        return;
      }
      if (!actorKey || !year || !semester || !roomId) {
        publish("error", "계정과 현재 학기를 확인한 뒤 다시 열어 주세요.");
        return;
      }
      publish("loading");
      const token = generation;
      const valid = () =>
        active &&
        token === generation &&
        identity.current === key &&
        !document.hidden;
      const fail = (error: unknown) => {
        if (!valid()) return;
        stop();
        terminal = { status: "error", message: yutErrorMessage(error) };
        publish(terminal.status, terminal.message);
      };
      const end = (message: string) => {
        stop();
        terminal = { status: "ended", message };
        publish(terminal.status, terminal.message);
      };
      try {
        const off = subscribeYutRoom(
          { year, semester },
          roomId,
          (next) => {
            if (!valid()) return;
            if (!next || next.status === "closed") {
              end("방이 닫혔습니다.");
              return;
            }
            if (
              next.id !== roomId ||
              !Number.isFinite(next.expiresAtMs) ||
              (next.status === "waiting" && !Number.isFinite(next.createdAtMs))
            ) {
              fail(new Error("방 상태를 확인할 수 없습니다."));
              return;
            }
            const expiresAtMs =
              next.status === "waiting"
                ? Math.min(next.expiresAtMs, next.createdAtMs + YUT_WAITING_MS)
                : next.expiresAtMs;
            const remaining = expiresAtMs - (Date.now() + serverOffsetMs);
            if (remaining <= 0) {
              end("방 이용 시간이 지났습니다.");
              return;
            }
            window.clearTimeout(expiry);
            expiry = window.setTimeout(
              () => {
                if (!valid()) return;
                end("방 이용 시간이 지났습니다.");
              },
              Math.min(remaining, 2147483647),
            );
            setView({ key, status: "live", room: next });
          },
          fail,
          (connected) => {
            if (valid() && !connected) publish("loading");
          },
        );
        // A synchronous error must also release the just-created listener.
        if (valid()) unsubscribe = off;
        else off();
      } catch (error) {
        fail(error);
      }
    };
    const visibility = () => {
      if (document.hidden) {
        stop();
        publish("paused", "관전이 일시 중지되었습니다.");
      } else connect();
    };
    document.addEventListener("visibilitychange", visibility);
    connect();
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, actorKey, year, semester, roomId, attempt, serverOffsetMs]);

  useEffect(() => {
    if (!room || room.status !== "playing") return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [key, room?.id, room?.status]);

  if (!current || current.status === "loading") return <InlineLoading />;
  if (!room)
    return (
      <div className="yut-spectator-message" role="status">
        <p>{current.message}</p>
        {(current.status === "error" || current.status === "ended") && (
          <button
            type="button"
            className="yut-management-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            다시 연결
          </button>
        )}
      </div>
    );

  const progress = getYutManagementProgress(room);
  const turn = room.players.find((person) => person.uid === room.turnUid);
  const winner = room.players.find((person) => person.uid === room.winnerUid);
  const seconds = Math.max(
    0,
    Math.ceil((room.turnDeadlineMs - (clock + serverOffsetMs)) / 1000),
  );
  const phase = room.phase === "throw" ? "윷 던지기" : "말 이동";

  return (
    <section
      className="yut-spectator yut-game"
      aria-label="읽기 전용 윷놀이 관전"
    >
      <div className="yut-spectator-status" aria-live="polite">
        {room.status === "waiting" ? (
          <strong>
            시작 대기 · {room.players.filter((person) => person.active).length}/
            {room.maxPlayers || 4}명
          </strong>
        ) : room.status === "finished" ? (
          <strong>{winner ? `${winner.name} 승리` : "경기 종료"}</strong>
        ) : (
          <>
            <strong>{turn?.name || "참가자"} 차례</strong>
            <span>{phase}</span>
            <span
              role="timer"
              aria-live="off"
              aria-label={`${phase} 남은 시간`}
            >
              {seconds > 0 ? `${seconds}초` : "다음 상태 대기"}
            </span>
            {room.pendingThrow && (
              <span>
                {room.pendingThrow.label} · {room.pendingThrow.value}칸
              </span>
            )}
          </>
        )}
      </div>
      <div className="yut-spectator-layout">
        <div className="yut-spectator-board">
          <YutBoard
            room={room}
            uid=""
            selectedPiece=""
            onSelectPiece={doNothing}
            moves={[]}
            onMove={doNothing}
            disabled
            revealMoves={false}
          />
        </div>
        <ul className="yut-spectator-players" aria-label="참가자 현황">
          {room.players.map((person) => {
            const leading = progress.leadingUids.includes(person.uid);
            const finished = person.pieces.filter(
              (piece) => piece.node === "finish",
            ).length;
            return (
              <li key={person.uid}>
                <YutPortrait role={person.role} />
                <div>
                  <strong>{person.name}</strong>
                  <span>
                    {PROFESSIONS[person.role].clan} · 완주 {finished}/
                    {person.pieces.length}
                  </span>
                  <span>
                    {!person.active
                      ? "퇴장"
                      : room.status === "finished"
                        ? person.uid === room.winnerUid
                          ? "승리"
                          : "경기 종료"
                        : room.status === "waiting"
                          ? person.ready
                            ? "준비 완료"
                            : "준비 중"
                          : person.uid === room.turnUid
                            ? "현재 차례"
                            : "기다리는 중"}
                    {leading &&
                      ` · ${progress.leadingUids.length > 1 ? "공동 선두" : "선두"}`}
                  </span>
                  {person.lastThrow && (
                    <span>최근 윷 · {person.lastThrow.label}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
