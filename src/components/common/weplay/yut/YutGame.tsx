import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  commandYutRoom,
  getYutLobby,
  subscribeYutRoom,
  yutErrorMessage,
  type YutCommand,
  type YutLobby,
  type YutMove,
  type YutRoom,
} from "../../../../lib/yut";
import {
  getLegalYutMoves,
  addYutEmote,
  YUT_EMOTE_COOLDOWN_MS,
  YUT_EMOTE_VISIBLE_MS,
  type YutEmoteKind,
} from "../../../../../functions/yutCore.mjs";
import {
  advanceYutPreviewBot,
  createYutPreview,
  previewYutCommand,
  YUT_PREVIEW_UID,
  type YutLocalMode,
} from "../../../../lib/yutPreview";
import useYutMusic from "../useYutMusic";
import { PROFESSIONS, YutSprite, YutIcon } from "./YutArt";
import YutBoard from "./YutBoard";
import YutThrow3D from "./YutThrow3D";
import "@fontsource/noto-serif-kr/600.css";
import "./yut.css";

function GameDialog({
  kind,
  onClose,
  onConfirm,
}: {
  kind: "rules" | "leave";
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="yut-dialog"
      ref={ref}
      onCancel={onClose}
      aria-labelledby="yut-dialog-title"
    >
      <div className="yut-dialog-top">
        <h2 id="yut-dialog-title">
          {kind === "rules" ? "윷판의 약속" : "이 판에서 나갈까요?"}
        </h2>
        <button
          type="button"
          className="yut-plain"
          aria-label="닫기"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {kind === "rules" ? (
        <>
          <ol className="yut-rules">
            <li>두 말을 모두 한 바퀴 돌려 완주하면 이깁니다.</li>
            <li>
              도·개·걸·윷·모는 각각 1·2·3·4·5칸입니다. 먼저 말을 옮긴 뒤 다음
              윷을 던집니다.
            </li>
            <li>윷·모가 나오거나 다른 사람의 말을 잡으면 한 번 더 던집니다.</li>
            <li>
              같은 편의 말이 만나면 업고 함께 이동합니다. 모서리와 가운데에서는
              길을 고를 수 있습니다.
            </li>
            <li>
              한 차례는 60초입니다. 시간이 지나면 다음 차례로 넘길 수 있습니다.
              이번 판에는 빽도가 없습니다.
            </li>
          </ol>
          <p className="yut-rule-note">
            네 말의 능력은 같습니다. 부여의 마가·우가·저가·구가 이름과 조선 문관
            복식을 함께 쓴 창작 캐릭터입니다. 싱글 모드는 컴퓨터 세 명과 겨루며,
            위스와 플레이 기록을 남기지 않습니다.
          </p>
          <button
            type="button"
            className="yut-button yut-button--primary"
            onClick={onClose}
          >
            알겠습니다
          </button>
        </>
      ) : (
        <>
          <p>진행 중인 판에서 나가면 내 말이 제외됩니다.</p>
          <div className="yut-dialog-actions">
            <button className="yut-button" type="button" onClick={onClose}>
              계속하기
            </button>
            <button
              className="yut-button yut-button--danger"
              type="button"
              onClick={onConfirm}
            >
              방 나가기
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

const requestKey = () => crypto.randomUUID();
const EMOTES: Record<YutEmoteKind, { symbol: string; label: string }> = {
  hello: { symbol: "👋", label: "안녕!" },
  nice: { symbol: "👏", label: "좋아요!" },
  oops: { symbol: "😅", label: "아차!" },
  wow: { symbol: "😮", label: "우와!" },
  thanks: { symbol: "🙏", label: "고마워요!" },
  gg: { symbol: "🤝", label: "즐거웠어요!" },
};
const portraitViewport = () =>
  typeof window !== "undefined" &&
  window.innerWidth <= 1023 &&
  window.innerHeight > window.innerWidth;
export default function YutGame({
  portal,
  preview = false,
  onBack,
}: {
  portal: "student" | "teacher";
  preview?: boolean;
  onBack: () => void;
}) {
  const { config, currentUser } = useAuth();
  const [localMode, setLocalMode] = useState<YutLocalMode | null>(
    preview ? "preview" : null,
  );
  const local = localMode !== null;
  const shellRef = useRef<HTMLElement>(null);
  const [portrait, setPortrait] = useState(portraitViewport);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [boardMaxWidth, setBoardMaxWidth] = useState(720);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [emotePending, setEmotePending] = useState(false);
  const [emoteError, setEmoteError] = useState("");
  const emotePanel = useRef<HTMLDivElement>(null);
  const emoteButton = useRef<HTMLButtonElement>(null);
  const emoteFlight = useRef(false);
  const pauseStart = useRef<number | null>(null);
  const [room, setRoom] = useState<YutRoom | null>(null);
  const [lobby, setLobby] = useState<YutLobby | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [retry, setRetry] = useState(0);
  const [code, setCode] = useState("");
  const [selectedPiece, setSelectedPiece] = useState("1");
  const [dialog, setDialog] = useState<"rules" | "leave" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [toss, setToss] = useState<{
    key: string;
    sticks: boolean[];
    room: YutRoom;
  } | null>(null);
  const [settledThrow, setSettledThrow] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const music = useYutMusic(!portrait);
  const uid = local ? YUT_PREVIEW_UID : currentUser?.uid || "";
  const identity = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}:${localMode || "online"}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const roomRef = useRef(room);
  roomRef.current = room;
  const paused = local && (hidden || portrait);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const currentToss = toss?.room.id === room?.id ? toss : null;
  const retainedThrow =
    currentToss &&
    room?.pendingThrow &&
    currentToss.room.turnUid === room.turnUid &&
    currentToss.room.turnDeadlineMs === room.turnDeadlineMs &&
    currentToss.sticks.every(
      (value, index) => value === room.pendingThrow?.sticks[index],
    );
  const throwKey = room?.pendingThrow
    ? room.lastEvent.kind === "throw"
      ? `${room.id}:${room.turnUid}:${room.lastEvent.atMs}`
      : retainedThrow
        ? currentToss.key
        : `${room.id}:${room.turnUid}:${room.turnDeadlineMs}:${room.pendingThrow.sticks.join("")}`
    : null;
  const settling = Boolean(
    (throwKey && throwKey !== settledThrow) ||
    (currentToss && currentToss.key !== settledThrow),
  );
  const settlingRef = useRef(settling);
  settlingRef.current = settling;
  useEffect(() => {
    if (throwKey && room?.pendingThrow)
      setToss({ key: throwKey, sticks: room.pendingThrow.sticks, room });
  }, [throwKey]);
  useEffect(() => {
    if (!room || room.status === "waiting" || room.status === "closed") {
      setToss(null);
      setSettledThrow(null);
    }
  }, [room?.id, room?.status]);
  const acceptRoom = useCallback((next: YutRoom | null) => {
    setRoom((previous) =>
      previous &&
      next &&
      previous.id === next.id &&
      (previous.syncRevision ?? previous.revision) >
        (next.syncRevision ?? next.revision)
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    const measure = () => {
      const top = Math.max(
        0,
        shellRef.current?.getBoundingClientRect().top || 0,
      );
      const available = window.innerHeight - top - 20;
      const compact =
        window.innerWidth > window.innerHeight && window.innerHeight <= 560;
      const board = shellRef.current?.querySelector(".yut-isometric-board");
      const overhead =
        board && shellRef.current
          ? shellRef.current.getBoundingClientRect().height -
            board.getBoundingClientRect().height
          : compact
            ? 180
            : 330;
      setPortrait(portraitViewport());
      setBoardMaxWidth(
        Math.max(
          compact ? 260 : 320,
          (available - overhead - 6) * (compact ? 9 / 5 : 9 / 7),
        ),
      );
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [room?.status, portrait]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!local || room?.status !== "playing") {
      pauseStart.current = null;
      return;
    }
    if (paused) {
      pauseStart.current ??= Date.now();
      return;
    }
    if (pauseStart.current !== null) {
      const elapsed = Date.now() - pauseStart.current;
      pauseStart.current = null;
      const current = roomRef.current;
      if (current?.status === "playing") {
        const next = {
          ...current,
          turnDeadlineMs: current.turnDeadlineMs + elapsed,
        };
        roomRef.current = next;
        setRoom(next);
        setClock(Date.now());
      }
    }
  }, [paused, local, room?.status]);
  useEffect(() => {
    if (!emoteOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!emotePanel.current?.contains(event.target as Node))
        setEmoteOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEmoteOpen(false);
        emoteButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [emoteOpen]);
  const requestLandscape = async () => {
    try {
      if (!document.fullscreenElement)
        await shellRef.current?.requestFullscreen?.();
    } catch {
      /* Manual rotation remains available. */
    }
    try {
      await (
        screen.orientation as ScreenOrientation & {
          lock?: (orientation: string) => Promise<void>;
        }
      ).lock?.("landscape");
    } catch {
      /* iOS and unsupported browsers use manual rotation. */
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const run = ++generation.current;
    pendingRef.current = false;
    setPending("");
    setError("");
    setNote("");
    setDisconnected(false);
    setRoom(null);
    setLobby(null);
    setToss(null);
    setSettledThrow(null);
    setEmoteOpen(false);
    setEmoteError("");
    setEmotePending(false);
    emoteFlight.current = false;
    if (local) {
      setRoom(createYutPreview({ mode: localMode || "preview" }));
      setServerOffset(0);
      setClock(Date.now());
      setNeedsSync(false);
      setLoading(false);
      return;
    }
    if (!currentUser || !config?.year || !config?.semester) {
      setLoading(false);
      setError("로그인과 현재 학기 정보를 확인해 주세요.");
      return;
    }
    setLoading(true);
    void getYutLobby(config)
      .then((data) => {
        if (!mounted.current || generation.current !== run) return;
        setLobby(data);
        setServerOffset(data.serverNowMs - Date.now());
        setClock(Date.now());
        setNeedsSync(false);
        acceptRoom(data.room);
      })
      .catch((failure) => {
        if (mounted.current && generation.current === run)
          setError(yutErrorMessage(failure));
      })
      .finally(() => {
        if (mounted.current && generation.current === run) setLoading(false);
      });
    return () => {
      generation.current++;
    };
    // Scope changes invalidate every pending response and room subscription.
  }, [identity, retry, acceptRoom]);

  useEffect(() => {
    if (local || !room?.id || !uid || !config) return;
    const scope = identity,
      id = room.id;
    let active = true;
    return (() => {
      const unsubscribe = subscribeYutRoom(
        config,
        id,
        (next) => {
          if (
            !active ||
            identityRef.current !== scope ||
            roomRef.current?.id !== id
          )
            return;
          if (
            next &&
            next.status !== "closed" &&
            next.participantUids.includes(uid)
          ) {
            acceptRoom(next);
            setDisconnected(false);
          } else {
            roomRef.current = null;
            acceptRoom(null);
            setNote("방이 닫혔습니다. 새 판을 열 수 있습니다.");
          }
        },
        (failure) => {
          if (
            active &&
            identityRef.current === scope &&
            roomRef.current?.id === id
          ) {
            setDisconnected(true);
            setError(yutErrorMessage(failure));
          }
        },
      );
      return () => {
        active = false;
        unsubscribe();
      };
    })();
  }, [
    room?.id,
    identity,
    local,
    uid,
    config?.year,
    config?.semester,
    acceptRoom,
  ]);

  useEffect(() => {
    if (!room || paused) return;
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [room?.id, paused]);
  useEffect(() => {
    if (
      !local ||
      room?.status !== "playing" ||
      room.turnUid === uid ||
      settling ||
      paused
    )
      return;
    const timer = window.setTimeout(
      () => {
        const current = roomRef.current;
        if (!current || settlingRef.current || pausedRef.current) return;
        try {
          const next = advanceYutPreviewBot(current);
          roomRef.current = next;
          setRoom(next);
        } catch (failure) {
          setError(yutErrorMessage(failure));
        }
      },
      room.phase === "throw" ? 850 : 1100,
    );
    return () => window.clearTimeout(timer);
  }, [local, room, uid, settling, paused]);

  const command = async (
    action: YutCommand["action"],
    extra: Partial<YutCommand> = {},
  ) => {
    if (pendingRef.current || disconnected || needsSync || loading) return;
    if ((portrait || hidden) && !["leave", "close"].includes(action)) return;
    if ((action === "throw" || action === "move") && settlingRef.current)
      return;
    music.start();
    setError("");
    setNote("");
    if (local) {
      try {
        if (action === "leave" || action === "close") {
          if (preview) onBack();
          else setLocalMode(null);
          return;
        }
        if (roomRef.current) {
          const next = previewYutCommand(roomRef.current, { action, ...extra });
          roomRef.current = next;
          setRoom(next);
          setClock(Date.now());
        }
      } catch (failure) {
        setError(yutErrorMessage(failure));
      }
      return;
    }
    const scope = identityRef.current,
      run = generation.current;
    const oldRoomId = room?.id;
    pendingRef.current = true;
    setPending(action);
    try {
      const result = await commandYutRoom(config, {
        action,
        requestKey: requestKey(),
        ...(room ? { roomId: room.id, expectedRevision: room.revision } : {}),
        ...extra,
      });
      if (
        !mounted.current ||
        identityRef.current !== scope ||
        generation.current !== run
      )
        return;
      if (oldRoomId && roomRef.current && roomRef.current.id !== oldRoomId)
        return;
      setServerOffset(result.serverNowMs - Date.now());
      setClock(Date.now());
      setDisconnected(false);
      setError("");
      if (action === "leave" || action === "close") roomRef.current = null;
      acceptRoom(action === "leave" || action === "close" ? null : result.room);
    } catch (failure) {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run
      ) {
        setError(yutErrorMessage(failure));
        setNeedsSync(true);
      }
    } finally {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run
      ) {
        pendingRef.current = false;
        setPending("");
      }
    }
  };
  const player = room?.players.find((item) => item.uid === uid);
  const turn = room?.players.find((item) => item.uid === room.turnUid);
  const winner = room?.players.find((item) => item.uid === room.winnerUid);
  const myTurn = room?.turnUid === uid;
  const moves = room ? getLegalYutMoves(room, uid) : [];
  const seconds = room
    ? Math.max(
        0,
        Math.ceil(
          (room.turnDeadlineMs - clock - (local ? 0 : serverOffset)) / 1000,
        ),
      )
    : 0;
  const busy = Boolean(pending) || disconnected || needsSync || loading;
  const serverClock = clock + (local ? 0 : serverOffset);
  const emoteCooldown = Math.max(
    0,
    Math.ceil(
      ((room?.emotes?.[uid]?.atMs || 0) + YUT_EMOTE_COOLDOWN_MS - serverClock) /
        1000,
    ),
  );
  const sendEmote = async (kind: YutEmoteKind) => {
    if (!room || emoteFlight.current || emoteCooldown || portrait || hidden)
      return;
    const scope = identityRef.current,
      id = room.id;
    emoteFlight.current = true;
    setEmotePending(true);
    setEmoteError("");
    try {
      if (local) {
        const current = roomRef.current;
        if (current) {
          const next = addYutEmote(
            current,
            uid,
            kind,
            requestKey(),
            Date.now(),
          );
          roomRef.current = next;
          setRoom(next);
          setClock(Date.now());
        }
      } else {
        const result = await commandYutRoom(config, {
          action: "emote",
          kind,
          roomId: id,
          requestKey: requestKey(),
        });
        if (
          !mounted.current ||
          identityRef.current !== scope ||
          roomRef.current?.id !== id
        )
          return;
        setServerOffset(result.serverNowMs - Date.now());
        acceptRoom(result.room);
      }
      setEmoteOpen(false);
    } catch (failure) {
      if (
        mounted.current &&
        identityRef.current === scope &&
        roomRef.current?.id === id
      )
        setEmoteError(yutErrorMessage(failure));
    } finally {
      if (mounted.current && identityRef.current === scope) {
        emoteFlight.current = false;
        setEmotePending(false);
      }
    }
  };
  const emoteBubble = (playerUid: string) => {
    const emote = room?.emotes?.[playerUid];
    if (
      !emote ||
      serverClock >= emote.atMs + YUT_EMOTE_VISIBLE_MS ||
      !EMOTES[emote.kind]
    )
      return null;
    return (
      <span
        className="yut-emote-bubble"
        role="status"
        data-emote-kind={emote.kind}
      >
        <span aria-hidden="true">{EMOTES[emote.kind].symbol}</span>
        {EMOTES[emote.kind].label}
      </span>
    );
  };
  const displayRoom =
    settling && currentToss && (!throwKey || currentToss.key === throwKey)
      ? currentToss.room
      : room;
  const resultVisible = !settling && pending !== "throw";
  const displayTurn = displayRoom?.players.find(
    (item) => item.uid === displayRoom.turnUid,
  );
  const primaryAction =
    room?.status === "finished"
      ? "again"
      : seconds === 0
        ? "skip"
        : myTurn && room?.phase === "throw"
          ? "throw"
          : null;
  const completeToss = useCallback(() => {
    if (toss) setSettledThrow(toss.key);
  }, [toss]);
  useEffect(() => {
    if (moves.length && !moves.some((move) => move.pieceId === selectedPiece))
      setSelectedPiece(moves[0].pieceId);
  }, [room?.revision, uid, selectedPiece]);
  const movePiece = (move: YutMove) =>
    void command("move", { pieceId: move.pieceId, route: move.route });
  const beginLocal = (mode: YutLocalMode) => {
    music.start();
    if (!portrait) setLocalMode(mode);
  };
  const back = () => {
    if (room) setDialog("leave");
    else {
      if (document.fullscreenElement === shellRef.current)
        void document.exitFullscreen?.();
      onBack();
    }
  };

  return (
    <section
      ref={shellRef}
      className={`yut-game ${room ? "yut-game--in-room" : ""}`}
      style={
        { "--yut-board-max-width": `${boardMaxWidth}px` } as React.CSSProperties
      }
      aria-label="사농공상 윷놀이"
    >
      <div className="yut-topbar">
        <button
          type="button"
          className="yut-icon-button"
          aria-label={room ? "방 나가기" : "전체 게임"}
          title={room ? "방 나가기" : "전체 게임"}
          onClick={back}
          disabled={Boolean(pending)}
        >
          <YutIcon name="back" />
        </button>
        <span className="yut-topbar-brand">
          WESTORY <b>·</b> WEPLAY
        </span>
        <div className="yut-topbar-actions">
          {room && !portrait && (
            <div className="yut-emote-control" ref={emotePanel}>
              <button
                ref={emoteButton}
                type="button"
                className="yut-icon-button"
                aria-label="감정표현"
                title="감정표현"
                aria-expanded={emoteOpen}
                aria-controls="yut-emote-menu"
                onClick={() => {
                  setEmoteOpen((value) => !value);
                  setEmoteError("");
                }}
              >
                <YutIcon name="emote" />
              </button>
              {emoteOpen && (
                <div
                  className="yut-emote-menu"
                  id="yut-emote-menu"
                  role="group"
                  aria-label="감정표현 선택"
                >
                  <div className="yut-emote-options">
                    {(Object.keys(EMOTES) as YutEmoteKind[]).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={emotePending || emoteCooldown > 0}
                        onClick={() => void sendEmote(kind)}
                        aria-label={EMOTES[kind].label}
                      >
                        <span aria-hidden="true">{EMOTES[kind].symbol}</span>
                        <span>{EMOTES[kind].label}</span>
                      </button>
                    ))}
                  </div>
                  {emoteCooldown > 0 && (
                    <p role="status">
                      {emoteCooldown}초 뒤 다시 보낼 수 있습니다.
                    </p>
                  )}
                  {emoteError && <p role="alert">{emoteError}</p>}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="yut-icon-button"
            aria-label="게임 규칙 보기"
            title="게임 규칙"
            onClick={() => setDialog("rules")}
          >
            <YutIcon name="info" />
          </button>
          <button
            type="button"
            className="yut-icon-button"
            aria-label={
              music.failed
                ? "음악 재시도"
                : music.enabled
                  ? "음악 끄기"
                  : "음악 켜기"
            }
            title={
              music.failed
                ? "음악 재시도"
                : music.enabled
                  ? "음악 끄기"
                  : "음악 켜기"
            }
            aria-pressed={music.enabled}
            onClick={music.toggle}
          >
            <YutIcon name={music.enabled ? "sound" : "muted"} />
          </button>
        </div>
      </div>
      {(error || note || disconnected || needsSync) && (
        <div
          className={`yut-message ${error || disconnected || needsSync ? "is-error" : ""}`}
          role={error || disconnected || needsSync ? "alert" : "status"}
        >
          <span>{error || note || "방 상태를 다시 확인해 주세요."}</span>
          {!local && (error || disconnected || needsSync) && (
            <button
              type="button"
              className="yut-button"
              onClick={() => setRetry((value) => value + 1)}
              disabled={Boolean(pending) || loading}
            >
              방 상태 다시 확인
            </button>
          )}
          {!disconnected && !needsSync && (
            <button
              type="button"
              className="yut-icon-button"
              aria-label="알림 닫기"
              onClick={() => {
                setError("");
                setNote("");
              }}
            >
              ×
            </button>
          )}
        </div>
      )}
      {portrait ? (
        <div className="yut-orientation-gate" role="status">
          <YutIcon name="rotate" />
          <h1>가로로 펼치는 윷판</h1>
          <p>휴대폰을 가로로 돌려 주세요.</p>
          <button
            className="yut-button yut-button--primary"
            type="button"
            onClick={() => void requestLandscape()}
          >
            가로 전체 화면으로 열기
          </button>
          {room?.status === "playing" && !local && (
            <p className="yut-orientation-notice">
              온라인 판의 차례 시간은 계속 흐릅니다.
            </p>
          )}
        </div>
      ) : !room ? (
        <div className="yut-entry">
          <div className="yut-entry-scene" aria-hidden="true" />
          <div className="yut-entry-title">
            <span className="yut-title-ornament" aria-hidden="true">
              四 民 遊 戱
            </span>
            <h1>
              사농공상<span>윷놀이</span>
            </h1>
            <div className="yut-title-rule" aria-hidden="true">
              <i />
              <span>윷</span>
              <i />
            </div>
          </div>
          <div className="yut-entry-menu">
            <button
              type="button"
              className="yut-button yut-button--primary yut-wide yut-single-start"
              onClick={() => beginLocal("single")}
              disabled={Boolean(pending) || loading}
            >
              싱글 모드 시작 <YutIcon name="arrow" />
            </button>
            {loading ? (
              <p className="yut-loading" role="status">
                윷판을 준비하고 있습니다.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="yut-button yut-wide"
                  disabled={busy || !lobby}
                  onClick={() => void command("create")}
                >
                  {pending === "create" ? "방을 여는 중…" : "새로운 판 만들기"}
                  <YutIcon name="arrow" />
                </button>
                <form
                  className="yut-join"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.trim())
                      void command("join", { code: code.trim().toUpperCase() });
                  }}
                >
                  <label className="yut-label" htmlFor="yut-room-code">
                    친구의 방 코드
                  </label>
                  <div>
                    <input
                      id="yut-room-code"
                      value={code}
                      onChange={(event) =>
                        setCode(
                          event.target.value
                            .replace(/[^a-zA-Z0-9]/g, "")
                            .slice(0, 6)
                            .toUpperCase(),
                        )
                      }
                      placeholder="6자리 코드"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={6}
                      disabled={busy}
                    />
                    <button
                      className="yut-button"
                      type="submit"
                      disabled={busy || !lobby || code.length !== 6}
                    >
                      {pending === "join" ? "입장 중" : "들어가기"}
                    </button>
                  </div>
                </form>
              </>
            )}
            {portal === "teacher" && (
              <button
                type="button"
                className="yut-practice"
                onClick={() => beginLocal("preview")}
                disabled={Boolean(pending) || loading}
              >
                대기실부터 체험하기
                <YutIcon name="arrow" />
              </button>
            )}
            <p className="yut-entry-meta">
              싱글 1인 · 온라인 2–4인 <span>·</span> 위스 변동 없음
            </p>
          </div>
        </div>
      ) : room.status === "waiting" ? (
        <div className="yut-waiting">
          <div className="yut-waiting-heading">
            <div>
              <span className="yut-eyebrow">
                {local ? "체험 · 기록 미반영" : room.classLabel}
              </span>
              <h1>한 판의 인연</h1>
            </div>
            <div className="yut-room-code">
              {local ? (
                <span>컴퓨터와 연습</span>
              ) : (
                <>
                  <span>방 코드</span>
                  <strong>{room.code}</strong>
                  <button
                    type="button"
                    className="yut-icon-button"
                    aria-label="방 코드 복사"
                    title="방 코드 복사"
                    onClick={() => {
                      void navigator.clipboard?.writeText(room.code).then(
                        () => setNote("방 코드를 복사했습니다."),
                        () => setNote(`방 코드: ${room.code}`),
                      );
                    }}
                  >
                    <YutIcon name="copy" />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="yut-waiting-seats">
            {[0, 1, 2, 3].map((index) => {
              const person = room.players[index];
              return (
                <div
                  key={index}
                  className={`yut-seat ${person ? "is-filled" : ""}`}
                >
                  {person ? (
                    <>
                      <span className="yut-seat-job">
                        {PROFESSIONS[person.role].clan}
                        <small>
                          {PROFESSIONS[person.role].name} ·{" "}
                          {PROFESSIONS[person.role].job}
                        </small>
                      </span>
                      <div className="yut-avatar">
                        {emoteBubble(person.uid)}
                        <YutSprite role={person.role} />
                      </div>
                      <strong>
                        {person.name}
                        {person.uid === uid && person.name !== "나" && (
                          <span className="yut-me">나</span>
                        )}
                      </strong>
                      <span
                        className={`yut-seat-status ${person.ready ? "is-ready" : ""}`}
                      >
                        {person.uid === room.hostUid
                          ? "방장"
                          : person.ready
                            ? "준비 완료"
                            : "준비 중"}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="yut-empty-seat" aria-hidden="true">
                        —
                      </div>
                      <span>기다리는 자리</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="yut-waiting-footer">
            <span>{room.players.length}/4명</span>
            {room.hostUid === uid ? (
              <button
                className="yut-button yut-button--primary"
                type="button"
                onClick={() => void command("start")}
                disabled={
                  busy ||
                  room.players.length < 2 ||
                  room.players.some((person) => !person.ready)
                }
              >
                {pending === "start" ? "시작하는 중…" : "윷판 펼치기"}
                <YutIcon name="arrow" />
              </button>
            ) : (
              <button
                className={`yut-button ${player?.ready ? "" : "yut-button--primary"}`}
                type="button"
                disabled={busy}
                onClick={() => void command("ready", { ready: !player?.ready })}
              >
                {player?.ready ? "준비 취소" : "준비 완료"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="yut-match">
          <div className="yut-match-heading">
            <div>
              <h1>사농공상</h1>
              <span className="yut-eyebrow">
                {local
                  ? `${localMode === "single" ? "싱글 모드" : "교사 체험"} · 기록 미반영`
                  : `${room.classLabel} · ${room.code}`}
              </span>
            </div>
            <div className="yut-turn-state">
              {room.status === "finished" && !settling ? (
                <span>판 종료</span>
              ) : (
                <>
                  <span aria-live="polite">
                    {displayRoom?.turnUid === uid
                      ? "내 차례"
                      : `${displayTurn?.name || "친구"}의 차례`}
                  </span>
                  <strong className={seconds <= 10 ? "is-low" : ""}>
                    {seconds}
                    <small>초</small>
                  </strong>
                </>
              )}
            </div>
          </div>
          <div className="yut-players">
            {(displayRoom || room).players.map((person) => (
              <div
                className={`yut-player ${displayRoom?.turnUid === person.uid ? "is-turn" : ""} ${!person.active ? "is-left" : ""}`}
                key={person.uid}
              >
                <div className="yut-avatar">
                  {emoteBubble(person.uid)}
                  <YutSprite role={person.role} />
                </div>
                <div>
                  <strong title={person.name}>
                    {person.name}
                    {person.uid === uid && person.name !== "나" && (
                      <span className="yut-me">나</span>
                    )}
                  </strong>
                  <span>
                    {PROFESSIONS[person.role].clan} <b>·</b>{" "}
                    {person.active
                      ? `${person.pieces.filter((piece) => piece.node === "finish").length}/2`
                      : "퇴장"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="yut-match-stage">
            <YutBoard
              room={displayRoom || room}
              uid={uid}
              selectedPiece={selectedPiece}
              onSelectPiece={setSelectedPiece}
              moves={moves}
              onMove={movePiece}
              disabled={busy || settling || seconds === 0}
              revealMoves={resultVisible}
            >
              {room.status !== "finished" || settling ? (
                <YutThrow3D
                  throwKey={currentToss?.key || null}
                  sticks={currentToss?.sticks || null}
                  rolling={pending === "throw"}
                  onComplete={completeToss}
                />
              ) : (
                <div className="yut-finish" role="status">
                  {winner && <YutSprite role={winner.role} />}
                  <span>이번 판의 승자</span>
                  <h2>{winner?.name || "참가자"}</h2>
                </div>
              )}
            </YutBoard>
            <div className="yut-action-dock">
              <div className="yut-throw-result" role="status">
                {settling || pending === "throw" ? (
                  <span>윷을 던지는 중</span>
                ) : room.pendingThrow ? (
                  <>
                    <strong>{room.pendingThrow.label}</strong>
                    <span>
                      {room.pendingThrow.value}칸
                      {room.pendingThrow.value >= 4 && " · 한 번 더"}
                    </span>
                  </>
                ) : room.status === "finished" ? (
                  <span>한 판, 잘 놀았습니다.</span>
                ) : !myTurn ? (
                  <span>{turn?.name || "친구"} 님의 차례</span>
                ) : null}
              </div>
              {primaryAction === "again" && !settling ? (
                <button
                  className="yut-button yut-button--primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    local
                      ? setRoom(
                          createYutPreview({ mode: localMode || "preview" }),
                        )
                      : void command("leave")
                  }
                >
                  새 판 준비하기
                  <YutIcon name="arrow" />
                </button>
              ) : primaryAction === "skip" ? (
                <button
                  type="button"
                  className="yut-button yut-button--primary"
                  disabled={busy}
                  onClick={() => void command("skip")}
                >
                  다음 차례로 넘기기
                </button>
              ) : primaryAction === "throw" ? (
                <button
                  className="yut-button yut-button--primary yut-throw-button"
                  type="button"
                  disabled={busy || settling}
                  onClick={() => void command("throw")}
                >
                  {pending === "throw" ? "윷을 던지는 중…" : "윷 던지기"}
                  <YutIcon name="arrow" />
                </button>
              ) : myTurn && room.phase === "move" && resultVisible ? (
                <div
                  className="yut-home-tray"
                  role="group"
                  aria-label="출발 전 말 선택"
                >
                  {player?.pieces
                    .filter((piece) => piece.node === "home")
                    .map((piece) => (
                      <button
                        type="button"
                        className={`yut-home-piece ${selectedPiece === piece.id ? "is-selected" : ""}`}
                        key={piece.id}
                        disabled={busy}
                        aria-pressed={selectedPiece === piece.id}
                        aria-label={`말 ${piece.id}, 출발 전, 선택`}
                        onClick={() => setSelectedPiece(piece.id)}
                      >
                        <YutSprite role={player.role} />
                        <span>말 {piece.id}</span>
                      </button>
                    ))}
                  <span className="yut-move-hint">
                    윷판의 목적지를 선택하세요
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="yut-event" aria-live="polite">
            {resultVisible && room.lastEvent.kind !== "throw"
              ? room.lastEvent.text
              : ""}
          </div>
        </div>
      )}
      {dialog && (
        <GameDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void command("leave");
          }}
        />
      )}
    </section>
  );
}
