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
  YUT_ROLES,
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
import type useYutMusic from "../useYutMusic";
import { PROFESSIONS, YutSprite, YutIcon } from "./YutArt";
import YutBoard from "./YutBoard";
import YutThrow3D from "./YutThrow3D";
import "@fontsource/noto-serif-kr/600.css";
import "./yut.css";

/** The gauge changes the toss animation only; the server still chooses the result. */
function YutPowerThrow({
  disabled,
  onThrow,
}: {
  disabled: boolean;
  onThrow: (power: number) => void;
}) {
  const [charging, setCharging] = useState(false);
  const [power, setPower] = useState(0);
  const charge = useRef<{
    start: number;
    mode: "pointer" | "space" | "toggle";
  } | null>(null);
  const value = useRef(0);
  const frame = useRef(0);
  const cancel = useCallback(() => {
    charge.current = null;
    cancelAnimationFrame(frame.current);
    setCharging(false);
    setPower(0);
  }, []);
  const start = (mode: "pointer" | "space" | "toggle") => {
    if (disabled || charge.current) return;
    charge.current = { start: performance.now(), mode };
    setCharging(true);
    const tick = () => {
      if (!charge.current) return;
      const progress =
        ((performance.now() - charge.current.start) % 1800) / 1800;
      value.current = 0.12 + 0.88 * (1 - Math.abs(progress * 2 - 1));
      setPower(value.current);
      frame.current = requestAnimationFrame(tick);
    };
    tick();
  };
  const release = () => {
    if (!charge.current) return;
    const chosen = value.current;
    cancel();
    if (!disabled && !document.hidden) onThrow(chosen);
  };
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
      cancelAnimationFrame(frame.current);
      charge.current = null;
    };
  }, [cancel]);
  return (
    <div className={`yut-power-control ${charging ? "is-charging" : ""}`}>
      <div
        className="yut-power-meter"
        role="meter"
        aria-label="투척 힘"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(power * 100)}
        aria-valuetext="투척 연출의 세기이며 윷 결과에 영향을 주지 않습니다."
      >
        <span style={{ width: `${power * 100}%` }} />
        <i />
      </div>
      <button
        type="button"
        className="yut-button yut-button--primary yut-throw-button"
        disabled={disabled}
        aria-label={
          charging && charge.current?.mode === "toggle"
            ? "힘을 멈추고 던지기"
            : "윷 던지기"
        }
        aria-describedby="yut-power-help"
        aria-pressed={charging}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start("pointer");
        }}
        onPointerUp={() => {
          if (charge.current?.mode === "pointer") release();
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (charge.current?.mode === "pointer") cancel();
        }}
        onKeyDown={(event) => {
          if (event.code === "Space") {
            event.preventDefault();
            if (!event.repeat) start("space");
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onKeyUp={(event) => {
          if (event.code === "Space") {
            event.preventDefault();
            if (charge.current?.mode === "space") release();
          }
        }}
        onBlur={cancel}
        onClick={(event) => {
          if (event.detail === 0) {
            if (charge.current?.mode === "toggle") release();
            else start("toggle");
          }
        }}
      >
        <span>
          {charging
            ? charge.current?.mode === "toggle"
              ? "멈추고 던지기"
              : "손을 떼면 던집니다"
            : "윷 던지기"}
        </span>
        <YutIcon name="arrow" />
      </button>
      <span id="yut-power-help" className="yut-power-help">
        {charging
          ? "힘은 투척 연출에만 반영됩니다"
          : "누르고 있다가 떼기 · Space도 가능"}
      </span>
      <span className="yut-sr-only">
        Enter 또는 보조기기 클릭으로 힘 조절을 시작하고 다시 누르면 던집니다.
        Esc로 취소합니다.
      </span>
    </div>
  );
}

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
            복식을 함께 쓴 창작 캐릭터입니다. 싱글 모드는 컴퓨터 1~3명과 겨루며,
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
  angry: { symbol: "😠", label: "으으!" },
};
const portraitViewport = () =>
  typeof window !== "undefined" &&
  window.innerWidth <= 1023 &&
  window.innerHeight > window.innerWidth;
export default function YutGame({
  portal,
  preview = false,
  onBack,
  music,
  onMusicActiveChange,
}: {
  portal: "student" | "teacher";
  preview?: boolean;
  onBack: () => void;
  music: ReturnType<typeof useYutMusic>;
  onMusicActiveChange: (active: boolean) => void;
}) {
  const { config, currentUser } = useAuth();
  const [localMode, setLocalMode] = useState<YutLocalMode | null>(
    preview ? "preview" : null,
  );
  const local = localMode !== null;
  const [singleCount, setSingleCount] = useState<2 | 3 | 4>(4);
  const [throwPower, setThrowPower] = useState(0.65);
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
    power: number;
    room: YutRoom;
  } | null>(null);
  const [settledThrow, setSettledThrow] = useState<string | null>(null);
  const [landedThrow, setLandedThrow] = useState<string | null>(null);
  const [revealedThrows, setRevealedThrows] = useState<
    Record<string, { label: string; value: number; atMs: number }>
  >({});
  const generation = useRef(0);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const visualRoomId = useRef<string | null>(null);
  useEffect(() => {
    onMusicActiveChange(!portrait);
    return () => onMusicActiveChange(true);
  }, [portrait, onMusicActiveChange]);
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
  const celebrating = Boolean(
    currentToss &&
    currentToss.key === landedThrow &&
    currentToss.key !== settledThrow,
  );
  useEffect(() => {
    if (!celebrating || paused) return;
    const timer = window.setTimeout(() => setSettledThrow(landedThrow), 1350);
    return () => window.clearTimeout(timer);
  }, [celebrating, landedThrow, paused]);
  useEffect(() => {
    const changed = visualRoomId.current !== (room?.id || null);
    visualRoomId.current = room?.id || null;
    if (
      changed ||
      !room ||
      room.status === "waiting" ||
      room.status === "closed"
    ) {
      setToss(null);
      setSettledThrow(null);
      setLandedThrow(null);
      const remembered: Record<
        string,
        { label: string; value: number; atMs: number }
      > = {};
      for (const person of room?.players || [])
        if (
          person.lastThrow &&
          !(room?.pendingThrow && person.uid === room.turnUid)
        )
          remembered[person.uid] = person.lastThrow;
      setRevealedThrows(remembered);
    }
  }, [room?.id, room?.status]);
  useEffect(() => {
    if (!room || settling) return;
    setRevealedThrows((previous) => {
      const next = { ...previous };
      for (const person of room.players)
        if (person.lastThrow) next[person.uid] = person.lastThrow;
      return next;
    });
  }, [room?.id, room?.revision, settling]);
  useEffect(() => {
    if (throwKey && room?.pendingThrow)
      setToss({
        key: throwKey,
        sticks: room.pendingThrow.sticks,
        power:
          room.players.find((person) => person.uid === room.turnUid)?.lastThrow
            ?.power ?? 0.65,
        room,
      });
  }, [throwKey]);
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
          (available - overhead - 6) * (compact ? 12 / 5 : 9 / 7),
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
    setLandedThrow(null);
    setRevealedThrows({});
    setEmoteOpen(false);
    setEmoteError("");
    setEmotePending(false);
    emoteFlight.current = false;
    if (local) {
      setRoom(
        createYutPreview({
          mode: localMode || "preview",
          playerCount: singleCount,
        }),
      );
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
    if (
      portal === "student" &&
      ["create", "join"].includes(action) &&
      lobby?.enabled !== true
    )
      return;
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
    if (toss) {
      setLandedThrow(toss.key);
      const result = toss.room.pendingThrow;
      if (result && toss.room.turnUid)
        setRevealedThrows((previous) => ({
          ...previous,
          [toss.room.turnUid!]: { ...result, atMs: toss.room.lastEvent.atMs },
        }));
    }
  }, [toss]);
  useEffect(() => {
    if (moves.length && !moves.some((move) => move.pieceId === selectedPiece))
      setSelectedPiece(moves[0].pieceId);
  }, [room?.revision, uid, selectedPiece]);
  const movePiece = (move: YutMove) =>
    void command("move", { pieceId: move.pieceId, route: move.route });
  const beginLocal = (mode: YutLocalMode) => {
    music.start();
    if (!portrait && (portal === "teacher" || lobby?.enabled === true))
      setLocalMode(mode);
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
      aria-label="마우저구 윷놀이"
    >
      <div className="yut-topbar">
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
            aria-label={room ? "방 나가기" : "전체 게임"}
            title={room ? "방 나가기" : "전체 게임"}
            onClick={back}
            disabled={Boolean(pending)}
          >
            <YutIcon name="back" />
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
              馬 牛 豬 狗
            </span>
            <h1>
              마우저구<span>윷놀이</span>
            </h1>
            <div className="yut-title-rule" aria-hidden="true">
              <i />
              <span>윷</span>
              <i />
            </div>
          </div>
          <div className="yut-entry-menu">
            <fieldset className="yut-single-count">
              <legend>싱글 참가 인원</legend>
              {([2, 3, 4] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  className={singleCount === count ? "is-selected" : ""}
                  aria-pressed={singleCount === count}
                  onClick={() => setSingleCount(count)}
                  disabled={Boolean(pending) || loading}
                >
                  {count}명
                </button>
              ))}
            </fieldset>
            <button
              type="button"
              className="yut-button yut-button--primary yut-wide yut-single-start"
              onClick={() => beginLocal("single")}
              disabled={
                Boolean(pending) ||
                loading ||
                (portal === "student" && lobby?.enabled !== true)
              }
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
                  disabled={
                    busy || !lobby || (portal === "student" && !lobby.enabled)
                  }
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
                      disabled={
                        busy ||
                        !lobby ||
                        code.length !== 6 ||
                        (portal === "student" && !lobby.enabled)
                      }
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
              const person = room.players.find(
                (person) => YUT_ROLES.indexOf(person.role) === index,
              );
              const blocked = room.blockedSeats?.includes(index) || false;
              const canChange = room.hostUid === uid && !local;
              return (
                <div
                  key={index}
                  className={`yut-seat ${person ? "is-filled" : ""} ${blocked ? "is-blocked" : ""}`}
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
                  ) : canChange ? (
                    <button
                      type="button"
                      className="yut-seat-toggle"
                      aria-label={`${index + 1}번 자리 ${blocked ? "열기" : "막기"}`}
                      aria-pressed={blocked}
                      disabled={
                        busy ||
                        (!blocked && (room.blockedSeats?.length || 0) >= 2)
                      }
                      onClick={() =>
                        void command("seat", { seat: index, blocked: !blocked })
                      }
                    >
                      <span className="yut-empty-seat" aria-hidden="true">
                        {blocked ? "×" : "+"}
                      </span>
                      <strong>{blocked ? "막힌 자리" : "기다리는 자리"}</strong>
                      <span>{blocked ? "눌러서 열기" : "눌러서 막기"}</span>
                    </button>
                  ) : (
                    <>
                      <div className="yut-empty-seat" aria-hidden="true">
                        {blocked ? "×" : "—"}
                      </div>
                      <span>{blocked ? "막힌 자리" : "기다리는 자리"}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="yut-waiting-footer">
            <span>
              {room.players.length}/{4 - (room.blockedSeats?.length || 0)}명
            </span>
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
              <h1>마우저구 윷놀이</h1>
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
          <div
            className={`yut-match-stage ${settling || pending === "throw" ? "is-tossing" : ""}`}
          >
            <div className="yut-players" aria-label="참가자 현황">
              {(displayRoom || room).players.map((person) => {
                const activeTurn =
                  displayRoom?.turnUid === person.uid &&
                  room.status !== "finished";
                const last = revealedThrows[person.uid];
                return (
                  <div
                    className={`yut-player yut-player--seat-${YUT_ROLES.indexOf(person.role)} ${activeTurn ? "is-turn" : ""} ${!person.active ? "is-left" : ""}`}
                    key={person.uid}
                  >
                    <div className="yut-avatar">
                      {emoteBubble(person.uid)}
                      <YutSprite role={person.role} />
                    </div>
                    <div className="yut-player-details">
                      <strong title={person.name}>
                        {person.name}
                        {person.uid === uid && person.name !== "나" && (
                          <span className="yut-me">나</span>
                        )}
                      </strong>
                      <span>
                        {PROFESSIONS[person.role].clan} · 완주{" "}
                        {
                          person.pieces.filter(
                            (piece) => piece.node === "finish",
                          ).length
                        }
                        /2
                      </span>
                      <span className="yut-player-status">
                        {!person.active
                          ? "퇴장"
                          : room.status === "finished"
                            ? person.uid === room.winnerUid
                              ? "승리"
                              : "판 종료"
                            : activeTurn
                              ? person.uid === uid
                                ? "내 차례"
                                : "진행 중"
                              : "기다리는 중"}
                      </span>
                    </div>
                    {last && (
                      <span
                        className="yut-player-last"
                        aria-label={`마지막 윷 결과 ${last.label}`}
                      >
                        {last.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="yut-board-area">
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
                  <>
                    {(settling || pending === "throw") && (
                      <div className="yut-toss-dimmer" aria-hidden="true" />
                    )}
                    <YutThrow3D
                      power={currentToss?.power ?? throwPower}
                      throwKey={currentToss?.key || null}
                      sticks={currentToss?.sticks || null}
                      rolling={pending === "throw"}
                      onComplete={completeToss}
                    />
                    {celebrating && currentToss?.room.pendingThrow && (
                      <div
                        className="yut-landing-result"
                        role="status"
                        aria-live="assertive"
                      >
                        <strong>{currentToss.room.pendingThrow.label}!</strong>
                        <span>
                          {currentToss.room.pendingThrow.value}칸
                          {currentToss.room.pendingThrow.value >= 4
                            ? " · 한 번 더"
                            : ""}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="yut-finish" role="status">
                    {winner && <YutSprite role={winner.role} />}
                    <span>이번 판의 승자</span>
                    <h2>{winner?.name || "참가자"}</h2>
                  </div>
                )}
              </YutBoard>
            </div>
            <div className="yut-action-dock">
              <div className="yut-throw-result" role="status">
                {settling || pending === "throw" ? (
                  <span>
                    {celebrating ? "윷 결과를 확인하세요" : "윷을 던지는 중"}
                  </span>
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
                          createYutPreview({
                            mode: localMode || "preview",
                            playerCount: singleCount,
                          }),
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
                <YutPowerThrow
                  disabled={
                    busy || settling || portrait || hidden || Boolean(dialog)
                  }
                  onThrow={(power) => {
                    setThrowPower(power);
                    void command("throw", { power });
                  }}
                />
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
