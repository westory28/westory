import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  commandYutRoom,
  getYutLobby,
  subscribeYutRoom,
  yutErrorMessage,
  normalizeYutSettings,
  YUT_PRIVATE_DAILY_LIMIT,
  type YutCommand,
  type YutLobby,
  type YutMove,
  type YutRoom,
  type YutSettings,
} from "../../../../lib/yut";
import {
  getLegalYutMoves,
  YUT_ROLES,
  YUT_MOVE_ANIMATION_MS,
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
import {
  PROFESSIONS,
  YUT_CHARACTER_SHEETS,
  YutSprite,
  YutPortrait,
  YutIcon,
  YutOrientationGuide,
} from "./YutArt";
import YutBoard, { yutNodeLabel } from "./YutBoard";
import YutThrow3D from "./YutThrow3D";
import { YutTurnGauge } from "./YutReactions";
import YutVictoryCast from "./YutVictoryCast";
import YutStackChoice from "./YutStackChoice";
import { YutEntryScene } from "./YutEntryScene";
import WeplayGameLoading from "../WeplayGameLoading";
import useYutSoundEffects from "../useYutSoundEffects";
import { acquirePageScrollLock } from "../../../../lib/pageScrollLock";
import "@fontsource/noto-serif-kr/600.css";
import "./yut.css";
import "./yut-feedback.css";
import "./yut-menu-controls.css";

async function withYutTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              Object.assign(
                new Error(
                  "연결이 지연되었습니다. 방 상태를 다시 확인해 주세요.",
                ),
                { code: "deadline-exceeded" },
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}
const uncertainYutFailure = (failure: unknown) => {
  const code = String((failure as { code?: string })?.code || "");
  return !code || /deadline|unavailable|network|internal|unknown/.test(code);
};

export function YutVictory({
  room,
  uid,
  local,
  busy,
  onClaim,
}: {
  room: YutRoom;
  uid: string;
  local: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  const winner = room.players.find((player) => player.uid === room.winnerUid);
  const reward = local ? undefined : room.reward;
  return (
    <div
      className="yut-victory"
      role="status"
      aria-live="polite"
      data-winner={room.winnerUid || ""}
    >
      <div className="yut-victory-petals" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <i
            key={index}
            style={{ "--petal-index": index } as React.CSSProperties}
          />
        ))}
      </div>
      <YutVictoryCast room={room} />
      <span className="yut-victory-ribbon">이번 판의 우승</span>
      <h2>{winner?.name || "참가자"}</h2>
      <strong className="yut-victory-congratulation">축하합니다!</strong>
      {reward && (
        <div className="yut-reward-receipt" data-reward-status={reward.status}>
          {reward.status === "paid" ? (
            <>
              <strong>+{reward.amount.toLocaleString()} 위스</strong>
              <span>우승 보상 지급 완료</span>
            </>
          ) : reward.status === "pending" ? (
            <>
              <strong>{reward.amount.toLocaleString()} 위스 지급 대기</strong>
              {reward.uid === uid ? (
                <button
                  className="yut-button"
                  type="button"
                  disabled={busy}
                  onClick={onClaim}
                >
                  보상 지급 다시 시도
                </button>
              ) : (
                <span>우승자의 보상 지급을 기다리고 있습니다.</span>
              )}
            </>
          ) : (
            <span>
              {room.finishReason === "forfeit"
                ? "중도 퇴장으로 끝난 판은 보상이 없습니다."
                : "이번 판은 위스 보상이 없습니다."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** V2 strength changes probabilities; the server still draws and validates the result. */
export function YutPowerThrow({
  disabled,
  onThrow,
  rulesVersion = 2,
}: {
  disabled: boolean;
  onThrow: (power: number) => void;
  rulesVersion?: number;
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
      const progress = Math.min(
        1,
        (performance.now() - charge.current.start) / 1200,
      );
      value.current = 0.12 + 0.88 * progress;
      setPower(value.current);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
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
        aria-valuetext={`힘 ${Math.round(power * 100)}%. ${rulesVersion === 1 ? "투척 연출의 세기이며 결과 확률에 영향을 주지 않습니다." : "힘에 따라 확률이 달라지며 결과는 확정되지 않습니다."}`}
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
          ? rulesVersion === 1
            ? "힘은 투척 연출에만 반영됩니다"
            : "세게 던질수록 윷·모 확률이 높아집니다"
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
  throwSeconds = 5,
  moveSeconds = 25,
  blocked = false,
  pieceCount = 2,
  rulesVersion = 2,
}: {
  kind: "rules" | "leave";
  onClose: () => void;
  onConfirm: () => void;
  throwSeconds?: number;
  moveSeconds?: number;
  blocked?: boolean;
  pieceCount?: number;
  rulesVersion?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      className="yut-dialog"
      ref={ref}
      {...(blocked ? { inert: "" } : {})}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onClose();
      }}
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
            <li>
              내 말 {pieceCount}개를 모두 먼저 완주시키면 이깁니다. 남은 칸보다
              큰 결과가 나와도 출발 발판에 도착하며 완주합니다.
            </li>
            <li>
              도·개·걸·윷·모는 각각 1·2·3·4·5칸입니다. 먼저 말을 옮긴 뒤 다음
              윷을 던집니다.
            </li>
            <li>윷·모가 나오거나 다른 사람의 말을 잡으면 한 번 더 던집니다.</li>
            <li>
              번호가 붙은 말을 고르고, 빛나는 발판을 선택한 뒤 결정 버튼을 눌러
              이동합니다. 모서리와 가운데에서는 지름길을 고를 수 있습니다.
            </li>
            <li>
              {rulesVersion === 1
                ? "내 말이 있는 칸에 도착하면 자동으로 업습니다."
                : "내 말이 있는 칸에 도착하면 업고 가기와 따로 가기를 고릅니다."}{" "}
              업힌 말은 함께 움직이며, 잡히면 함께 출발 전으로 돌아갑니다.
            </li>
            <li>
              {rulesVersion === 1
                ? "윷가락 앞뒤가 나올 확률은 같습니다. 힘은 투척 연출에만 반영됩니다."
                : "약하게 던지면 도·개, 세게 던지면 윷·모의 확률이 높아집니다. 힘을 맞춰도 결과가 확정되지는 않습니다."}
            </li>
            <li>
              윷은 {throwSeconds}초 안에 던져 주세요. 시간이 지나면 다음 차례로
              넘어갑니다. 이동할 길은 {moveSeconds}초 안에 결정합니다. 투척·이동
              연출은 제한 시간에 포함되지 않으며, 빽도는 없습니다.
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

function CreateRoomDialog({
  initialCount,
  allowPrivate,
  remaining,
  onClose,
  onCreate,
}: {
  initialCount: 2 | 3 | 4;
  allowPrivate: boolean;
  remaining: number | null;
  onClose: () => void;
  onCreate: (maxPlayers: 2 | 3 | 4, visibility: "public" | "private") => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [count, setCount] = useState(initialCount);
  const [privateRoom, setPrivateRoom] = useState(false);
  useEffect(() => {
    const node = ref.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="yut-dialog yut-create-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="yut-create-title"
    >
      <div className="yut-dialog-top">
        <h2 id="yut-create-title">새 판 만들기</h2>
        <button
          type="button"
          className="yut-icon-button"
          aria-label="닫기"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <fieldset className="yut-single-count">
        <legend>참가 인원</legend>
        {([2, 3, 4] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={count === value ? "is-selected" : ""}
            aria-pressed={count === value}
            onClick={() => setCount(value)}
          >
            {value}명
          </button>
        ))}
      </fieldset>
      <label className="yut-private-option">
        <input
          type="checkbox"
          checked={privateRoom}
          disabled={!allowPrivate || remaining === 0}
          onChange={(event) => setPrivateRoom(event.target.checked)}
        />
        <span>비밀방으로 만들기</span>
      </label>
      {remaining !== null && (
        <p className="yut-private-quota">
          오늘 비밀방 참가 {remaining}/{YUT_PRIVATE_DAILY_LIMIT}회 남음
        </p>
      )}
      <div className="yut-dialog-actions">
        <button type="button" className="yut-button" onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          className="yut-button yut-button--primary"
          onClick={() => onCreate(count, privateRoom ? "private" : "public")}
        >
          만들기
        </button>
      </div>
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
  initialSettings,
}: {
  portal: "student" | "teacher";
  preview?: boolean;
  onBack: () => void;
  music: ReturnType<typeof useYutMusic>;
  onMusicActiveChange: (active: boolean) => void;
  initialSettings?: YutSettings;
}) {
  const { config, currentUser } = useAuth();
  const sounds = useYutSoundEffects();
  useEffect(() => {
    const warm = (file: string, priority: "high" | "low" = "low") => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = priority;
      image.src = `${import.meta.env.BASE_URL}assets/weplay/yut/${file}`;
    };
    // Give the first visible/walking poses priority; short later reactions are
    // warmed during idle time so their first frame is ready when it is needed.
    YUT_CHARACTER_SHEETS.slice(0, 4).forEach((action, index) =>
      warm(`animation-${action}.webp`, index < 2 ? "high" : "low"),
    );
    const later = () => {
      YUT_CHARACTER_SHEETS.slice(4).forEach((action) =>
        warm(`animation-${action}.webp`),
      );
      warm("stack-choice-carry.webp");
      warm("stack-choice-separate.webp");
    };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(later, { timeout: 1500 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(later, 200);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    // Load before the first result exists, so its short reveal never swaps fonts.
    void document.fonts
      .load('400 120px "Yut Brush"', "도개걸윷모!")
      .catch(() => {});
  }, []);
  const [localMode, setLocalMode] = useState<YutLocalMode | null>(
    preview ? "preview" : null,
  );
  const local = localMode !== null;
  const [singleCount, setSingleCount] = useState<2 | 3 | 4>(
    initialSettings?.defaultPlayerCount ?? 4,
  );
  const [singleOpen, setSingleOpen] = useState(false);
  const localPlayerName = useRef<{ scope: string; name?: string }>();
  const [throwPower, setThrowPower] = useState(0.65);
  const shellRef = useRef<HTMLElement>(null);
  const [portraitDevice, setPortraitDevice] = useState(portraitViewport);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [fullscreenMode, setFullscreenMode] = useState<
    "native" | "page" | null
  >(null);
  const fullscreen = fullscreenMode !== null;
  const portrait = portraitDevice && !fullscreen;
  const viewport = useRef({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fullscreenSize, setFullscreenSize] = useState(viewport.current);
  const rotatedFullscreen =
    fullscreen && fullscreenSize.height > fullscreenSize.width;
  const canvasWidth = fullscreen
    ? Math.max(fullscreenSize.width, fullscreenSize.height)
    : viewport.current.width;
  const canvasHeight = fullscreen
    ? Math.min(fullscreenSize.width, fullscreenSize.height)
    : viewport.current.height;
  const [moving, setMoving] = useState(false);
  const [selectedMove, setSelectedMove] = useState<YutMove | null>(null);
  const [stackChoice, setStackChoice] = useState<{
    move: YutMove;
    roomId: string;
    revision: number;
  } | null>(null);
  const autoSkipKey = useRef("");
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
  const localSettings = useRef(normalizeYutSettings(initialSettings));
  const settings = normalizeYutSettings(
    initialSettings || lobby?.settings || localSettings.current,
  );
  const remainingPrivate = lobby?.privatePlaysRemaining ?? null;
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  const [throwDelayed, setThrowDelayed] = useState(false);
  const networkBusy = loading || Boolean(pending);
  useEffect(() => {
    setThrowDelayed(false);
    if (pending !== "throw") return;
    const timer = window.setTimeout(() => setThrowDelayed(true), 2500);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const [disconnected, setDisconnected] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [retry, setRetry] = useState(0);
  const [code, setCode] = useState("");
  const [selectedPiece, setSelectedPiece] = useState("1");
  const [dialog, setDialog] = useState<"rules" | "leave" | "create" | null>(
    null,
  );
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
  const roomEpoch = useRef(0);
  const recoveryCommand = useRef<{ scope: string; data: YutCommand } | null>(
    null,
  );
  const clockSample = useRef({ latency: Infinity, atMs: 0 });
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const visualRoomId = useRef<string | null>(null);
  useEffect(() => {
    onMusicActiveChange(!portrait);
    return () => onMusicActiveChange(true);
  }, [portrait, onMusicActiveChange]);
  const uid = local ? YUT_PREVIEW_UID : currentUser?.uid || "";
  const accountScope = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}`;
  const identity = `${accountScope}:${localMode || "online"}`;
  const singlePlayerName =
    portal === "student" && localPlayerName.current?.scope === accountScope
      ? localPlayerName.current.name
      : undefined;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const roomRef = useRef(room);
  roomRef.current = room;
  const modeUnavailable =
    portal === "student" &&
    (local
      ? !settings.allowSolo
      : Boolean(
          room &&
          (!settings.allowMultiplayer ||
            (room.visibility !== "public" && !settings.allowPrivateRooms)),
        ));
  useEffect(() => {
    if (!modeUnavailable) return;
    generation.current++;
    pendingRef.current = false;
    setPending("");
    setDisconnected(false);
    setNeedsSync(false);
    setError("");
    setEmoteOpen(false);
    roomRef.current = null;
    setRoom(null);
    if (local) setLocalMode(null);
    else
      setLobby((previous) =>
        previous ? { ...previous, room: null } : previous,
      );
    setNote("이 게임 방식은 지금 이용할 수 없습니다.");
  }, [modeUnavailable, local]);
  const paused = local && (hidden || portrait || modeUnavailable);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const movingRef = useRef(moving);
  movingRef.current = moving;
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
    if (moving) return;
    if (throwKey && room?.pendingThrow)
      setToss({
        key: throwKey,
        sticks: room.pendingThrow.sticks,
        power:
          room.players.find((person) => person.uid === room.turnUid)?.lastThrow
            ?.power ?? 0.65,
        room,
      });
  }, [throwKey, moving]);
  const acceptRoom = useCallback((next: YutRoom | null) => {
    const previous = roomRef.current;
    if (
      previous &&
      next &&
      previous.id === next.id &&
      (previous.syncRevision ?? previous.revision) >
        (next.syncRevision ?? next.revision)
    )
      return;
    roomRef.current = next;
    setRoom(next);
  }, []);
  const recordServerTime = useCallback(
    (serverNowMs: number, sentAtMs: number) => {
      const receivedAtMs = Date.now(),
        latency = Math.max(0, receivedAtMs - sentAtMs);
      // A delayed response must not shift an already accurate turn clock back.
      if (
        latency <= clockSample.current.latency ||
        receivedAtMs - clockSample.current.atMs > 60000
      ) {
        clockSample.current = { latency, atMs: receivedAtMs };
        setServerOffset(serverNowMs - (sentAtMs + receivedAtMs) / 2);
      }
      setClock(receivedAtMs);
    },
    [],
  );

  useEffect(() => {
    const measure = () => {
      const compact = canvasWidth > canvasHeight && canvasHeight <= 560;
      shellRef.current?.style.setProperty(
        "--yut-toolbar-width",
        `${shellRef.current.querySelector<HTMLElement>(".yut-floating-controls")?.offsetWidth || 200}px`,
      );
      // The board belongs to its frame. Page scrolling and browser chrome must
      // never change its scale while a player is choosing or moving a piece.
      const available =
        shellRef.current?.querySelector<HTMLElement>(".yut-game-content")
          ?.clientHeight || canvasHeight;
      const height = (selector: string) =>
        shellRef.current?.querySelector<HTMLElement>(selector)?.offsetHeight ||
        0;
      const style = (selector: string) => {
        const node = shellRef.current?.querySelector(selector);
        return node ? getComputedStyle(node) : null;
      };
      const value = (input?: string) => parseFloat(input || "0") || 0;
      const matchStyle = style(".yut-match"),
        boardStyle = style(".yut-isometric-board-wrap"),
        dockStyle = style(".yut-action-dock");
      const shellStyle = shellRef.current
        ? getComputedStyle(shellRef.current)
        : null;
      const overhead =
        height(".yut-action-dock") +
        height(".yut-event") +
        value(matchStyle?.paddingTop) +
        value(matchStyle?.paddingBottom) +
        value(boardStyle?.paddingTop) +
        value(dockStyle?.marginTop) +
        value(shellStyle?.borderTopWidth) +
        value(shellStyle?.borderBottomWidth) +
        8;
      setBoardMaxWidth(
        Math.max(
          compact ? 260 : 320,
          (available - overhead - 6) * (compact ? 3 : 5 / 2),
        ),
      );
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    let frameWidth = shellRef.current?.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = shellRef.current?.clientWidth;
      if (window.innerWidth <= 1023 && frameWidth === nextWidth) return;
      frameWidth = nextWidth;
      measure();
    });
    const frameNode = shellRef.current?.closest(".weplay-game-frame");
    if (frameNode) observer.observe(frameNode);
    const resize = () => {
      if (
        window.innerWidth <= 1023 &&
        window.innerWidth === viewport.current.width
      )
        return;
      viewport.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      setPortraitDevice(portraitViewport());
      setFullscreenSize(viewport.current);
      measure();
    };
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [room?.status, portrait, fullscreen, canvasWidth, canvasHeight]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    const onFullscreen = () => {
      const active = document.fullscreenElement === shellRef.current;
      if (active) {
        viewport.current = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        setFullscreenSize(viewport.current);
      }
      setFullscreenMode(active ? "native" : null);
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const release = acquirePageScrollLock();
    const previousFocus = document.activeElement as HTMLElement | null;
    if (fullscreenMode === "page")
      shellRef.current
        ?.querySelector<HTMLButtonElement>(".yut-floating-fullscreen")
        ?.focus();
    const escape = (event: KeyboardEvent) => {
      if (
        fullscreenMode !== "page" ||
        shellRef.current?.querySelector("dialog[open]")
      )
        return;
      if (event.key === "Escape") setFullscreenMode(null);
      if (event.key === "Tab") {
        const controls = Array.from(
          shellRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ) || [],
        ).filter(
          (node) => node.getClientRects().length && !node.closest("[inert]"),
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      release();
      document.removeEventListener("keydown", escape);
      if (fullscreenMode === "page") {
        const returnTo =
          shellRef.current?.querySelector<HTMLButtonElement>(
            ".yut-orientation-gate button",
          ) || previousFocus;
        if (returnTo?.isConnected) returnTo.focus();
      }
    };
  }, [fullscreen, fullscreenMode]);
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
          phaseStartsAtMs: (current.phaseStartsAtMs || 0) + elapsed,
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
  const requestGameFullscreen = async () => {
    viewport.current = { width: window.innerWidth, height: window.innerHeight };
    setFullscreenSize(viewport.current);
    try {
      if (shellRef.current?.requestFullscreen) {
        await shellRef.current.requestFullscreen();
        return;
      }
    } catch {
      /* iPhone and restricted browsers use the same fixed game view below. */
    }
    setFullscreenMode("page");
  };
  const exitGameFullscreen = () => {
    if (document.fullscreenElement === shellRef.current)
      void document.exitFullscreen?.();
    else setFullscreenMode(null);
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
    const scope = identity;
    roomEpoch.current++;
    roomRef.current = null;
    if (recoveryCommand.current?.scope !== scope)
      recoveryCommand.current = null;
    clockSample.current = { latency: Infinity, atMs: 0 };
    pendingRef.current = false;
    setPending("");
    setMoving(false);
    setSelectedMove(null);
    autoSkipKey.current = "";
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
    setSingleOpen(false);
    setEmoteError("");
    setEmotePending(false);
    emoteFlight.current = false;
    if (local) {
      setRoom(
        createYutPreview({
          mode: localMode || "preview",
          playerCount: singleCount,
          throwSeconds: localSettings.current.throwSeconds,
          moveSeconds: localSettings.current.moveSeconds,
          playerName: singlePlayerName,
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
    const recovery = recoveryCommand.current;
    const readLobby = async () => {
      if (recovery) {
        // Only the explicit recovery button replays the exact uncertain request.
        // The server receipt prevents a second throw/join even after a lost reply.
        try {
          await withYutTimeout(commandYutRoom(config, recovery.data));
          if (recoveryCommand.current === recovery)
            recoveryCommand.current = null;
        } catch (failure) {
          if (
            !uncertainYutFailure(failure) &&
            recoveryCommand.current === recovery
          )
            recoveryCommand.current = null;
          throw failure;
        }
      }
      if (
        !mounted.current ||
        generation.current !== run ||
        identityRef.current !== scope
      )
        return null;
      const sentAtMs = Date.now();
      return { data: await withYutTimeout(getYutLobby(config)), sentAtMs };
    };
    void readLobby()
      .then((response) => {
        if (
          !response ||
          !mounted.current ||
          generation.current !== run ||
          identityRef.current !== scope
        )
          return;
        const { data, sentAtMs } = response;
        setLobby(data);
        if (data.settings) {
          localSettings.current = normalizeYutSettings(data.settings);
          setSingleCount(data.settings.defaultPlayerCount);
        }
        recordServerTime(data.serverNowMs, sentAtMs);
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
  }, [identity, retry, acceptRoom, recordServerTime]);

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
          const current = roomRef.current;
          if (
            next &&
            current &&
            (next.syncRevision ?? next.revision) <
              (current.syncRevision ?? current.revision)
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
            roomEpoch.current++;
            recoveryCommand.current = null;
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
        (connected) => {
          if (
            active &&
            identityRef.current === scope &&
            roomRef.current?.id === id
          )
            setDisconnected(!connected);
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
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [room?.id, paused]);
  useEffect(() => {
    if (
      !local ||
      room?.status !== "playing" ||
      room.turnUid === uid ||
      settling ||
      moving ||
      paused
    )
      return;
    const timer = window.setTimeout(
      () => {
        const current = roomRef.current;
        if (
          !current ||
          settlingRef.current ||
          pausedRef.current ||
          movingRef.current
        )
          return;
        try {
          const next = advanceYutPreviewBot(current);
          roomRef.current = next;
          setRoom(next);
        } catch (failure) {
          setError(yutErrorMessage(failure));
        }
      },
      Math.max(
        room.phase === "throw" ? 650 : 900,
        (room.phaseStartsAtMs || 0) - Date.now() + 30,
      ),
    );
    return () => window.clearTimeout(timer);
  }, [local, room, uid, settling, moving, paused]);

  const command = async (
    action: YutCommand["action"],
    extra: Partial<YutCommand> = {},
    automatic = false,
  ) => {
    if (
      pendingRef.current ||
      disconnected ||
      needsSync ||
      loading ||
      (modeUnavailable && !["leave", "close"].includes(action))
    )
      return;
    if (
      portal === "student" &&
      ["create", "join", "match"].includes(action) &&
      (lobby?.enabled !== true ||
        !settings.allowMultiplayer ||
        (action === "join" && !settings.allowPrivateRooms))
    )
      return;
    if ((portrait || hidden) && !["leave", "close"].includes(action)) return;
    if (
      (action === "throw" || action === "move") &&
      (settlingRef.current ||
        movingRef.current ||
        (roomRef.current?.phaseStartsAtMs || 0) >
          Date.now() + (local ? 0 : serverOffset))
    )
      return;
    if (
      ["throw", "move", "skip", "start"].includes(action) &&
      roomRef.current?.status === "finished"
    )
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
    const epoch = roomEpoch.current;
    const activeRoom = roomRef.current;
    const oldRoomId = activeRoom?.id;
    pendingRef.current = true;
    setPending(action);
    const data: YutCommand = {
      action,
      requestKey: requestKey(),
      ...(activeRoom
        ? { roomId: activeRoom.id, expectedRevision: activeRoom.revision }
        : {}),
      ...extra,
    };
    const recovery = { scope, data };
    recoveryCommand.current = recovery;
    const sentAtMs = Date.now();
    try {
      const result = await withYutTimeout(commandYutRoom(config, data));
      if (
        !mounted.current ||
        identityRef.current !== scope ||
        generation.current !== run ||
        roomEpoch.current !== epoch
      )
        return;
      if (oldRoomId && roomRef.current && roomRef.current.id !== oldRoomId)
        return;
      if (recoveryCommand.current === recovery) recoveryCommand.current = null;
      recordServerTime(result.serverNowMs, sentAtMs);
      setDisconnected(false);
      setError("");
      if (action === "leave" || action === "close") {
        roomEpoch.current++;
        roomRef.current = null;
      }
      acceptRoom(action === "leave" || action === "close" ? null : result.room);
      if (action === "leave" || action === "close") {
        const refreshedAtMs = Date.now();
        const refreshed = await withYutTimeout(getYutLobby(config));
        if (
          mounted.current &&
          identityRef.current === scope &&
          generation.current === run
        ) {
          setLobby(refreshed);
          recordServerTime(refreshed.serverNowMs, refreshedAtMs);
        }
      }
    } catch (failure) {
      if (!uncertainYutFailure(failure) && recoveryCommand.current === recovery)
        recoveryCommand.current = null;
      if (
        automatic &&
        /aborted|failed-precondition/.test(
          String((failure as { code?: string })?.code),
        )
      )
        return;
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run &&
        roomEpoch.current === epoch
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
  // Legacy matches without rulesVersion keep V1 until they finish. A waiting
  // room upgrades on start, so lobby/waiting/preview instructions default to V2.
  const rulesVersion =
    room &&
    ["playing", "finished"].includes(room.status) &&
    room.rulesVersion !== 2
      ? 1
      : 2;
  const turn = room?.players.find((item) => item.uid === room.turnUid);
  const myTurn = room?.turnUid === uid;
  const moves = room ? getLegalYutMoves(room, uid) : [];
  const seconds = room
    ? Math.max(
        0,
        Math.ceil(
          (room.turnDeadlineMs -
            Math.max(
              room.phaseStartsAtMs || 0,
              clock + (local ? 0 : serverOffset),
            )) /
            1000,
        ),
      )
    : 0;
  const busy =
    Boolean(pending) || disconnected || needsSync || loading || modeUnavailable;
  const serverClock = clock + (local ? 0 : serverOffset);
  const phaseWaiting = Boolean(
    room && serverClock < (room.phaseStartsAtMs || 0),
  );
  const finishing = Boolean(
    room?.status === "finished" &&
    (moving ||
      (room.lastEvent.move &&
        serverClock < room.lastEvent.atMs + YUT_MOVE_ANIMATION_MS)),
  );
  const applauded = useRef(new Set<string>());
  useEffect(() => {
    if (!room || room.status !== "finished" || !room.winnerUid || finishing)
      return;
    const key = `${room.id}:${room.winnerUid}`;
    if (applauded.current.has(key)) return;
    applauded.current.add(key);
    if (!hidden && !portrait) sounds.applause();
  }, [
    room?.id,
    room?.status,
    room?.winnerUid,
    finishing,
    hidden,
    portrait,
    sounds.applause,
  ]);
  useEffect(() => {
    if (
      !room ||
      room.status !== "playing" ||
      room.phase !== "throw" ||
      seconds > 0 ||
      busy ||
      settling ||
      moving ||
      paused ||
      hidden ||
      portrait
    )
      return;
    const position = room.players.findIndex((person) => person.uid === uid);
    const fallbackDelay =
      local || room.turnUid === uid
        ? 0
        : room.hostUid === uid
          ? 800
          : 1400 + Math.max(0, position) * 300;
    if (serverClock < room.turnDeadlineMs + fallbackDelay) return;
    const key = `${room.id}:${room.turnUid}:${room.turnDeadlineMs}`;
    if (autoSkipKey.current === key) return;
    autoSkipKey.current = key;
    void command("skip", {}, true);
  }, [
    room?.id,
    room?.revision,
    seconds,
    serverClock,
    busy,
    settling,
    moving,
    paused,
    hidden,
    portrait,
  ]);
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
    const run = generation.current;
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
        const sentAtMs = Date.now();
        const result = await withYutTimeout(
          commandYutRoom(config, {
            action: "emote",
            kind,
            roomId: id,
            requestKey: requestKey(),
          }),
        );
        if (
          !mounted.current ||
          identityRef.current !== scope ||
          generation.current !== run ||
          roomRef.current?.id !== id
        )
          return;
        recordServerTime(result.serverNowMs, sentAtMs);
        acceptRoom(result.room);
      }
      setEmoteOpen(false);
    } catch (failure) {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run &&
        roomRef.current?.id === id
      )
        setEmoteError(yutErrorMessage(failure));
    } finally {
      if (
        mounted.current &&
        identityRef.current === scope &&
        generation.current === run
      ) {
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
  const selectPiece = useCallback((pieceId: string) => {
    setSelectedPiece(pieceId);
    setSelectedMove(null);
    setStackChoice(null);
  }, []);
  useEffect(() => {
    if (moves.length && !moves.some((move) => move.pieceId === selectedPiece))
      selectPiece(moves[0].pieceId);
  }, [room?.revision, uid, selectedPiece, selectPiece]);
  const movePiece = (move: YutMove) => {
    if (move.pieceId === selectedPiece) setSelectedMove(move);
  };
  useEffect(() => {
    setSelectedMove(null);
    setStackChoice(null);
  }, [room?.id, room?.revision, uid, selectedPiece]);
  useEffect(() => {
    if (seconds === 0 || portrait || hidden || busy) setStackChoice(null);
  }, [seconds, portrait, hidden, busy]);
  const confirmMove = (move: YutMove, stack?: boolean) => {
    const current = roomRef.current;
    if (
      !current ||
      move.pieceId !== selectedPiece ||
      current.status !== "playing" ||
      current.turnUid !== uid ||
      busy ||
      seconds === 0
    )
      return;
    const legal = getLegalYutMoves(current, uid).find(
      (candidate) =>
        candidate.pieceId === move.pieceId &&
        candidate.route === move.route &&
        candidate.targetNode === move.targetNode,
    );
    if (!legal) return;
    if (legal.canStack && stack === undefined) {
      setStackChoice({
        move: legal,
        roomId: current.id,
        revision: current.revision,
      });
      return;
    }
    setStackChoice(null);
    void command("move", {
      pieceId: legal.pieceId,
      route: legal.route,
      ...(stack !== undefined ? { stack } : {}),
    });
  };
  const beginLocal = (mode: YutLocalMode) => {
    music.start();
    if (
      !portrait &&
      (portal === "teacher" || (lobby?.enabled === true && settings.allowSolo))
    ) {
      localSettings.current = settings;
      localPlayerName.current = {
        scope: accountScope,
        name: portal === "student" ? lobby?.playerName : undefined,
      };
      setSingleOpen(false);
      setLocalMode(mode);
    }
  };
  const back = () => {
    if (room) setDialog("leave");
    else {
      exitGameFullscreen();
      onBack();
    }
  };

  return (
    <section
      ref={shellRef}
      className={`yut-game ${room ? "yut-game--in-room" : ""} ${room && room.status !== "waiting" && !portrait ? "yut-game--match" : ""} ${fullscreen ? "yut-game--fullscreen" : ""} ${rotatedFullscreen ? "yut-game--rotated-fullscreen" : ""}`}
      style={
        {
          "--yut-board-max-width": `${boardMaxWidth}px`,
          "--yut-fullscreen-height": `${fullscreenSize.height}px`,
          "--yut-canvas-width": `${canvasWidth}px`,
          "--yut-canvas-height": `${canvasHeight}px`,
        } as React.CSSProperties
      }
      data-floating-launcher-obstacle={fullscreen || undefined}
      aria-label="마우저구 윷놀이"
      data-motion-paused={hidden || portrait}
      onPointerDownCapture={sounds.unlock}
      onKeyDownCapture={sounds.unlock}
    >
      <div className="yut-game-content" {...(networkBusy ? { inert: "" } : {})}>
        <div
          className="yut-floating-controls"
          role="group"
          aria-label="게임 도구"
        >
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
          {room && (
            <button
              type="button"
              className="yut-icon-button"
              aria-label="방 나가기"
              title="방 나가기"
              onClick={back}
              disabled={Boolean(pending)}
            >
              <YutIcon name="back" />
            </button>
          )}
          {fullscreen && (
            <button
              type="button"
              className="yut-icon-button"
              aria-label={
                music.failed
                  ? "음악 재시도"
                  : music.enabled
                    ? "소리 끄기"
                    : "소리 켜기"
              }
              title={
                music.failed
                  ? "음악 재시도"
                  : music.enabled
                    ? "소리 끄기"
                    : "소리 켜기"
              }
              aria-pressed={music.enabled}
              onClick={music.toggle}
            >
              <YutIcon name={music.enabled ? "sound" : "muted"} />
            </button>
          )}
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
            <YutOrientationGuide />
            <h1>마우저구 윷놀이</h1>
            <p>가로로 돌리거나 전체 화면으로 시작하세요.</p>
            <button
              className="yut-button yut-button--primary"
              type="button"
              onClick={() => void requestGameFullscreen()}
            >
              전체 화면으로 열기
            </button>
            {room?.status === "playing" && !local && (
              <p className="yut-orientation-notice">
                온라인 판의 차례 시간은 계속 흐릅니다.
              </p>
            )}
          </div>
        ) : !room ? (
          <div className="yut-entry">
            <YutEntryScene />
            <div className="yut-entry-title">
              <h1>
                마우저구<span>윷놀이</span>
              </h1>
            </div>
            <div className="yut-entry-menu">
              <button
                type="button"
                className={`yut-button ${singleOpen ? "" : "yut-button--primary"} yut-wide yut-single-start yut-single-toggle`}
                aria-expanded={singleOpen}
                aria-controls="yut-single-options"
                onClick={() => setSingleOpen((value) => !value)}
                disabled={
                  Boolean(pending) ||
                  loading ||
                  (portal === "student" &&
                    (lobby?.enabled !== true || !settings.allowSolo))
                }
              >
                혼자서 시작 <YutIcon name="arrow" />
              </button>
              {singleOpen && (
                <div className="yut-single-options" id="yut-single-options">
                  <fieldset className="yut-single-count">
                    <legend>나를 포함한 참가 인원</legend>
                    {([2, 3, 4] as const).map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={singleCount === count ? "is-selected" : ""}
                        aria-label={`${count}명`}
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
                    className="yut-button yut-button--primary yut-single-confirm"
                    onClick={() => beginLocal("single")}
                    disabled={
                      Boolean(pending) ||
                      loading ||
                      (portal === "student" &&
                        (lobby?.enabled !== true || !settings.allowSolo))
                    }
                  >
                    싱글 시작
                  </button>
                </div>
              )}
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
                      busy ||
                      !lobby ||
                      !settings.allowMultiplayer ||
                      (portal === "student" && !lobby.enabled)
                    }
                    onClick={() =>
                      void command("match", {
                        maxPlayers: settings.defaultPlayerCount,
                      })
                    }
                  >
                    {pending === "match" ? "친구를 찾는 중…" : "여럿이서 시작"}
                    <YutIcon name="arrow" />
                  </button>
                  <button
                    type="button"
                    className="yut-button yut-wide yut-create-start"
                    disabled={
                      busy ||
                      !lobby ||
                      !settings.allowMultiplayer ||
                      (portal === "student" && !lobby.enabled)
                    }
                    onClick={() => setDialog("create")}
                  >
                    새 판 만들기
                    <YutIcon name="arrow" />
                  </button>
                  <form
                    className="yut-join"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        code.trim() &&
                        settings.allowMultiplayer &&
                        settings.allowPrivateRooms &&
                        remainingPrivate !== 0
                      )
                        void command("join", {
                          code: code.trim().toUpperCase(),
                        });
                    }}
                  >
                    <label className="yut-label" htmlFor="yut-room-code">
                      비밀방 코드
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
                          !settings.allowMultiplayer ||
                          !settings.allowPrivateRooms ||
                          remainingPrivate === 0 ||
                          (portal === "student" && !lobby.enabled)
                        }
                      >
                        {pending === "join" ? "입장 중" : "들어가기"}
                      </button>
                    </div>
                  </form>
                  {remainingPrivate !== null && (
                    <p className="yut-private-quota">
                      오늘 비밀방 참가 {remainingPrivate}/
                      {YUT_PRIVATE_DAILY_LIMIT}회 남음
                    </p>
                  )}
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
                ) : room.visibility === "public" ? (
                  <span>공개방 · 빠른 참가</span>
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
                        </span>
                        <div className="yut-avatar">
                          {emoteBubble(person.uid)}
                          <YutSprite
                            role={person.role}
                            motionKey={person.uid}
                          />
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
                          void command("seat", {
                            seat: index,
                            blocked: !blocked,
                          })
                        }
                      >
                        <span className="yut-empty-seat" aria-hidden="true">
                          {blocked ? "×" : "+"}
                        </span>
                        <strong>
                          {blocked ? "막힌 자리" : "기다리는 자리"}
                        </strong>
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
                  onClick={() =>
                    void command("ready", { ready: !player?.ready })
                  }
                >
                  {player?.ready ? "준비 취소" : "준비 완료"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="yut-match">
            <div
              className={`yut-match-stage ${settling || pending === "throw" ? "is-tossing" : ""}`}
            >
              <div className="yut-players" aria-label="참가자 현황">
                {(displayRoom || room).players.map((person) => {
                  const activeTurn =
                    displayRoom?.turnUid === person.uid &&
                    room.status !== "finished";
                  const last = revealedThrows[person.uid];
                  const nameParts = person.name.match(/^(.*?)\s*(\([^()]+\))$/);
                  return (
                    <div
                      className={`yut-player yut-player--seat-${YUT_ROLES.indexOf(person.role)} ${activeTurn ? "is-turn" : ""} ${!person.active ? "is-left" : ""}`}
                      key={person.uid}
                    >
                      <div className="yut-avatar">
                        {emoteBubble(person.uid)}
                        <YutPortrait
                          role={person.role}
                          pose={
                            room.status === "finished" &&
                            room.winnerUid === person.uid
                              ? "win"
                              : room.status === "finished"
                                ? "lose"
                                : activeTurn
                                  ? settling
                                    ? "throw"
                                    : "turn"
                                  : "idle"
                          }
                        />
                      </div>
                      <div className="yut-player-details">
                        <strong title={person.name}>
                          <span className="yut-player-name">
                            {nameParts ? nameParts[1] : person.name}
                            {person.uid === uid && person.name !== "나" && (
                              <span className="yut-me">나</span>
                            )}
                          </span>
                          {nameParts && (
                            <span className="yut-player-class">
                              {nameParts[2]}
                            </span>
                          )}
                        </strong>
                        <span>
                          {PROFESSIONS[person.role].clan} · 완주{" "}
                          {
                            person.pieces.filter(
                              (piece) => piece.node === "finish",
                            ).length
                          }
                          /{person.pieces.length}
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
                  onSelectPiece={selectPiece}
                  moves={moves}
                  onMove={movePiece}
                  selectedMove={selectedMove}
                  onMotionChange={setMoving}
                  onStep={sounds.step}
                  disabled={
                    room.status !== "playing" ||
                    busy ||
                    settling ||
                    moving ||
                    phaseWaiting ||
                    seconds === 0
                  }
                  revealMoves={
                    room.status === "playing" &&
                    resultVisible &&
                    !moving &&
                    !phaseWaiting
                  }
                >
                  {room.status === "playing" &&
                    !settling &&
                    !moving &&
                    !phaseWaiting &&
                    !busy && (
                      <YutTurnGauge
                        remainingMs={Math.max(
                          0,
                          room.turnDeadlineMs - serverClock,
                        )}
                        totalMs={
                          (room.phase === "throw"
                            ? room.throwSeconds || 5
                            : room.moveSeconds || 25) * 1000
                        }
                        phase={room.phase}
                      />
                    )}
                  {room.status !== "finished" || settling || finishing ? (
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
                        onRelease={() =>
                          sounds.throw(currentToss?.power ?? throwPower)
                        }
                        onImpact={sounds.impact}
                      />
                      {celebrating && currentToss?.room.pendingThrow && (
                        <div
                          className={`yut-landing-result ${currentToss.room.pendingThrow.value >= 4 ? "is-bonus" : ""}`}
                          data-result={currentToss.room.pendingThrow.value}
                          role="status"
                          aria-live="assertive"
                        >
                          <strong>
                            {currentToss.room.pendingThrow.label}!
                          </strong>
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
                    <YutVictory
                      room={room}
                      uid={uid}
                      local={local}
                      busy={busy}
                      onClaim={() => void command("claimReward")}
                    />
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
                {primaryAction === "again" && !settling && !finishing ? (
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
                              throwSeconds: settings.throwSeconds,
                              moveSeconds: settings.moveSeconds,
                              playerName: singlePlayerName,
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
                    rulesVersion={rulesVersion}
                    disabled={
                      busy ||
                      settling ||
                      moving ||
                      phaseWaiting ||
                      portrait ||
                      hidden ||
                      Boolean(dialog)
                    }
                    onThrow={(power) => {
                      setThrowPower(power);
                      void command("throw", { power });
                    }}
                  />
                ) : room.status === "playing" &&
                  myTurn &&
                  room.phase === "move" &&
                  resultVisible ? (
                  <div className="yut-move-controls">
                    <div
                      className="yut-piece-choices"
                      role="group"
                      aria-label="이동할 말 선택"
                    >
                      {player?.pieces.map((piece) => {
                        const action =
                          piece.node === "finish"
                            ? "완주"
                            : piece.node === "home"
                              ? "출발"
                              : "이동";
                        const stacked = Boolean(
                          piece.stackId &&
                          player.pieces.some(
                            (other) =>
                              other.id !== piece.id &&
                              other.stackId === piece.stackId,
                          ),
                        );
                        return (
                          <button
                            key={piece.id}
                            type="button"
                            className={`yut-button yut-piece-choice ${selectedPiece === piece.id ? "is-selected" : ""}`}
                            aria-label={`${piece.id}번 말 ${action}${stacked ? " · 업힌 말 함께" : ""}`}
                            aria-pressed={selectedPiece === piece.id}
                            disabled={
                              piece.node === "finish" ||
                              !moves.some(
                                (move) => move.pieceId === piece.id,
                              ) ||
                              busy ||
                              moving ||
                              phaseWaiting ||
                              settling ||
                              seconds === 0 ||
                              hidden ||
                              portrait
                            }
                            onClick={() => selectPiece(piece.id)}
                          >
                            <span>
                              {piece.id}번 말 {action}
                            </span>
                            {stacked && <small>업힌 말 함께</small>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="yut-move-confirm">
                      <span className="yut-move-hint" aria-live="polite">
                        {selectedMove
                          ? `${yutNodeLabel(selectedMove.targetNode)}까지`
                          : "빛나는 발판 선택"}
                      </span>
                      <button
                        type="button"
                        className="yut-button yut-button--primary"
                        disabled={
                          !selectedMove ||
                          busy ||
                          moving ||
                          phaseWaiting ||
                          seconds === 0
                        }
                        onClick={() => {
                          if (selectedMove) confirmMove(selectedMove);
                        }}
                      >
                        결정
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="yut-event" aria-live="polite">
              {resultVisible && !finishing && room.lastEvent.kind !== "throw"
                ? room.lastEvent.text
                : ""}
            </div>
          </div>
        )}
        {!portrait && (
          <button
            type="button"
            className="yut-floating-fullscreen"
            aria-label={fullscreen ? "전체 화면 나가기" : "게임 전체 화면"}
            title={fullscreen ? "전체 화면 나가기" : "게임 전체 화면"}
            onClick={() => {
              if (fullscreen) exitGameFullscreen();
              else void requestGameFullscreen();
            }}
          >
            <YutIcon name={fullscreen ? "fullscreen-exit" : "fullscreen"} />
            <span>{fullscreen ? "전체 화면 나가기" : "전체 화면"}</span>
          </button>
        )}
        {dialog === "create" && (
          <CreateRoomDialog
            initialCount={settings.defaultPlayerCount}
            allowPrivate={settings.allowPrivateRooms}
            remaining={remainingPrivate}
            onClose={() => setDialog(null)}
            onCreate={(maxPlayers, visibility) => {
              setDialog(null);
              void command("create", { maxPlayers, visibility });
            }}
          />
        )}
        {dialog && dialog !== "create" && (
          <GameDialog
            rulesVersion={rulesVersion}
            kind={dialog}
            blocked={networkBusy}
            throwSeconds={room?.throwSeconds ?? settings.throwSeconds}
            moveSeconds={room?.moveSeconds ?? settings.moveSeconds}
            pieceCount={
              rulesVersion === 1
                ? (room?.pieceCount ?? room?.players[0]?.pieces.length ?? 1)
                : 2
            }
            onClose={() => setDialog(null)}
            onConfirm={() => {
              setDialog(null);
              void command("leave");
            }}
          />
        )}
        {stackChoice && player && (
          <YutStackChoice
            role={player.role}
            blocked={networkBusy}
            onClose={() => setStackChoice(null)}
            onConfirm={(stack) => {
              if (
                roomRef.current?.id === stackChoice.roomId &&
                roomRef.current?.revision === stackChoice.revision
              )
                confirmMove(stackChoice.move, stack);
              else setStackChoice(null);
            }}
          />
        )}
      </div>
      {(loading || (pending && pending !== "throw") || throwDelayed) && (
        <WeplayGameLoading
          theme="yut"
          label={
            throwDelayed
              ? "윷 결과를 기다리고 있습니다."
              : pending === "claimReward"
                ? "우승 보상을 확인하고 있습니다."
                : loading
                  ? "윷판을 준비하고 있습니다."
                  : "윷판을 이어가고 있습니다."
          }
        />
      )}
    </section>
  );
}
