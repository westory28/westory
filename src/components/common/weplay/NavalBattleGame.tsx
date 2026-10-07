import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  finishWeplayGame,
  normalizeWeplayAnswer,
  submitWeplayAnswer,
  weplayErrorMessage,
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayFinishOptions,
} from "../../../lib/weplay";
import {
  simulateWeplayBattle,
  WEPLAY_BATTLE_CONFIG,
  WEPLAY_BATTLE_MAX_HP,
} from "../../../lib/weplayBattle";
import type { HistoryRainGameProps } from "./HistoryRainGame";
import WeplayExitDialog from "./WeplayExitDialog";
import { DEFAULT_WEPLAY_GAME_TITLE } from "../../../lib/weplayTitle";
import NavalSpecialAttack, { NAVAL_SPECIAL_TIMING } from "./NavalSpecialAttack";
import "./naval-battle.css";

const ART = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;
type BattleEvent = { wordId: string; elapsedMs: number };
type Effect = {
  id: number;
  kind: "cannon" | "enemy" | "special" | "sunk";
  tactic?: string;
  damage?: number;
};
type Impact = { id: number; side: "enemy" | "allied"; damage: number };
function Sprite({
  className,
  rect,
  label,
}: {
  className: string;
  rect: [number, number, number, number];
  label?: string;
}) {
  const [x, y, width, height] = rect;
  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        aspectRatio: `${width}/${height}`,
        backgroundImage: `url(${ART}reference-sprites.webp)`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${(1672 / width) * 100}% ${(941 / height) * 100}%`,
        backgroundPosition: `${(x / (1672 - width)) * 100}% ${(y / (941 - height)) * 100}%`,
      }}
    />
  );
}

export default function NavalBattleGame({
  gameTitle = DEFAULT_WEPLAY_GAME_TITLE,
  session,
  config,
  onComplete,
  preview = false,
  transport,
  onShowGuide,
  guideDemo = false,
  guideInteractive,
}: HistoryRainGameProps) {
  const uniqueInputId = useId();
  const inputId = guideDemo
    ? `${uniqueInputId}-naval-answer`
    : "naval-answer-input";
  const [now, setNow] = useState(session.serverNowMs);
  const clock = useRef({
    server: session.serverNowMs,
    local: performance.now(),
  });
  const [events, setEvents] = useState<BattleEvent[]>(
    session.acceptedEvents || [],
  );
  const eventsRef = useRef(events);
  const accepted = useMemo(
    () =>
      new Set([
        ...session.acceptedWordIds,
        ...events.map((event) => event.wordId),
      ]),
    [session.acceptedWordIds, events],
  );
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitRequested, setExitRequested] = useState(false);
  const [exitError, setExitError] = useState("");
  const exitOpenRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [pageHidden, setPageHidden] = useState(document.hidden);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compactViewport, setCompactViewport] = useState(guideDemo);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    window.visualViewport?.height || window.innerHeight,
  );
  const initialViewportHeight = useRef(window.innerHeight);
  const refreshViewport = useRef<() => void>(() => undefined);
  const pending = useRef(new Set<string>());
  const retryData = useRef(
    new Map<
      string,
      { sessionId: string; eventId: string; wordId: string; answer: string }
    >(),
  );
  const [retryWord, setRetryWord] = useState<string | null>(null);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const keepInputVisible = () => {
    const element = input.current;
    if (!element || document.activeElement !== element) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || window.innerHeight);
    const rect = element.getBoundingClientRect();
    const scene = element
      .closest(".naval-game--compact .naval-scene")
      ?.getBoundingClientRect();
    const bounds =
      scene && scene.height <= (viewport?.height || window.innerHeight) - 8
        ? scene
        : rect;
    const margin = bounds === scene ? 4 : 12;
    const shift =
      bounds.bottom > bottom - margin
        ? bounds.bottom - bottom + margin
        : bounds.top < top + margin
          ? bounds.top - top - margin
          : 0;
    if (
      shift &&
      Math.max(initialViewportHeight.current, window.innerHeight) -
        (viewport?.height || window.innerHeight) >=
        120
    ) {
      window.scrollBy({ top: shift, behavior: "instant" });
    } else if (shift)
      element.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
  };
  const alive = useRef(true);
  const finishingRef = useRef(false);
  const finishOnce = useRef(false);
  const finishRef = useRef<(options?: WeplayFinishOptions) => void>(
    () => undefined,
  );
  const effectSequence = useRef(0);
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const effectFinishAt = useRef(0);
  const enemyImpactAt = useRef(0);
  const enemySinkingUntil = useRef(0);
  const elapsed = Math.max(0, now - session.startsAtMs);
  const duration = session.endsAtMs - session.startsAtMs;
  const started = now >= session.startsAtMs;
  const battle = useMemo(
    () => simulateWeplayBattle(session, elapsed, events),
    [session, elapsed, events],
  );
  const latestBattle = useRef(battle);
  latestBattle.current = battle;
  const [displayBattle, setDisplayBattle] = useState(() => ({
    playerHp: battle.playerHp,
    enemyHp: battle.enemyHp,
    sunkShips: battle.sunkShips,
  }));
  const arrivedEnemy = useRef({
    enemyHp: battle.enemyHp,
    sunkShips: battle.sunkShips,
  });
  const ended = now >= session.endsAtMs || battle.outcome === "defeat";
  const remaining = Math.max(
    0,
    Math.ceil((session.endsAtMs - Math.max(now, session.startsAtMs)) / 1000),
  );
  const phase = Math.min(3, Math.floor(elapsed / (duration / 3)) + 1);
  const rules = WEPLAY_BATTLE_CONFIG[session.difficulty];
  const enemyImpact = impacts
    .filter((impact) => impact.side === "enemy")
    .at(-1);
  const alliedImpact = impacts
    .filter((impact) => impact.side === "allied")
    .at(-1);
  const visible = session.words.filter(
    (word) =>
      !accepted.has(word.id) &&
      !pending.current.has(word.id) &&
      elapsed >= word.spawnAtMs &&
      elapsed < word.spawnAtMs + word.fallDurationMs &&
      !ended &&
      started &&
      (!guideDemo || !guideInteractive || word.id === guideInteractive.wordId),
  );
  const normal = visible
    .filter((word) => word.kind !== "special")
    .sort(
      (a, b) => a.spawnAtMs + a.fallDurationMs - b.spawnAtMs - b.fallDurationMs,
    );
  const prompts = normal.slice(0, 3);
  const wordLanes = useRef(new Map<string, number>());
  const promptIds = new Set(prompts.map((word) => word.id));
  for (const id of wordLanes.current.keys())
    if (!promptIds.has(id)) wordLanes.current.delete(id);
  for (const word of prompts) {
    if (wordLanes.current.has(word.id)) continue;
    const occupied = new Set(wordLanes.current.values());
    wordLanes.current.set(
      word.id,
      [1, 2, 3].find((lane) => !occupied.has(lane)) || 1,
    );
  }
  const special = visible.find((word) => word.kind === "special");
  const lastMiss = session.words
    .filter(
      (word) =>
        word.kind !== "special" &&
        word.spawnAtMs + word.fallDurationMs <= elapsed &&
        !accepted.has(word.id),
    )
    .reduce(
      (last, word) => Math.max(last, word.spawnAtMs + word.fallDurationMs),
      -1,
    );
  const combo = events.filter(
    (event) =>
      event.elapsedMs > lastMiss &&
      session.words.some(
        (word) => word.id === event.wordId && word.kind !== "special",
      ),
  ).length;
  const previousBattle = useRef({
    cannonShots: battle.cannonShots,
    enemyShots: battle.enemyShots,
    specialCount: battle.specialCount,
    sunkShips: battle.sunkShips,
  });

  useEffect(() => {
    alive.current = true;
    if (guideDemo)
      return () => {
        alive.current = false;
        effectTimers.current.forEach(clearTimeout);
      };
    for (const file of ["yi-sunsin-cutin.webp", "impact-lines.webp"]) {
      const art = new Image();
      art.src = `${ART}${file}`;
    }
    const timer = window.setInterval(
      () =>
        setNow(clock.current.server + performance.now() - clock.current.local),
      50,
    );
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    const visibilityChanged = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const viewport = window.visualViewport;
    const viewportChanged = () => {
      const height = viewport?.height || window.innerHeight;
      setViewportHeight(height);
      setKeyboardInset(
        Math.max(
          0,
          Math.max(initialViewportHeight.current, window.innerHeight) - height,
        ),
      );
      setCompactViewport(
        document.activeElement === input.current &&
          height < 540 &&
          Math.max(initialViewportHeight.current, window.innerHeight) -
            height >=
            120,
      );
      requestAnimationFrame(() => requestAnimationFrame(keepInputVisible));
    };
    refreshViewport.current = viewportChanged;
    viewport?.addEventListener("resize", viewportChanged);
    viewport?.addEventListener("scroll", viewportChanged);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", visibilityChanged);
      viewport?.removeEventListener("resize", viewportChanged);
      viewport?.removeEventListener("scroll", viewportChanged);
      refreshViewport.current = () => undefined;
      effectTimers.current.forEach(clearTimeout);
    };
  }, []);
  useLayoutEffect(() => {
    if (compactViewport) keepInputVisible();
  }, [compactViewport, keyboardInset]);
  useEffect(() => {
    if (started && !ended && !exitOpenRef.current && !guideDemo) {
      input.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => requestAnimationFrame(keepInputVisible));
    }
  }, [started, ended]);
  useEffect(() => {
    if (guideDemo && !guideInteractive) return;
    const previous = previousBattle.current;
    if (battle.enemyShots < previous.enemyShots)
      setDisplayBattle((current) => ({
        ...current,
        playerHp: battle.playerHp,
      }));
    const next: Effect[] = [];
    if (battle.cannonShots > previous.cannonShots)
      next.push({
        id: ++effectSequence.current,
        kind: "cannon",
        damage: (battle.cannonShots - previous.cannonShots) * 12,
      });
    if (battle.enemyShots > previous.enemyShots)
      next.push({
        id: ++effectSequence.current,
        kind: "enemy",
        damage: (battle.enemyShots - previous.enemyShots) * rules.enemyDamage,
      });
    if (battle.specialCount > previous.specialCount) {
      const latest = [...events]
        .reverse()
        .find(
          (event) =>
            session.words.find((word) => word.id === event.wordId)?.kind ===
            "special",
        );
      next.push({
        id: ++effectSequence.current,
        kind: "special",
        damage: (battle.specialCount - previous.specialCount) * 45,
        tactic: session.words.find((word) => word.id === latest?.wordId)
          ?.tactic,
      });
    }
    const sunk = battle.sunkShips > previous.sunkShips;
    previousBattle.current = {
      cannonShots: battle.cannonShots,
      enemyShots: battle.enemyShots,
      specialCount: battle.specialCount,
      sunkShips: battle.sunkShips,
    };
    if (!next.length && !sunk) return;
    const hasSpecial = next.some((effect) => effect.kind === "special");
    const enemyHit = next.some((effect) => effect.kind !== "enemy");
    const impactDelay = enemyHit
      ? Math.max(
          hasSpecial ? NAVAL_SPECIAL_TIMING.finalImpactMs : 420,
          enemyImpactAt.current - performance.now() + 16,
        )
      : 420;
    // Keep confirmed hits in order when a regular shot follows the longer barrage.
    if (enemyHit) enemyImpactAt.current = performance.now() + impactDelay;
    effectFinishAt.current = Math.max(
      effectFinishAt.current,
      performance.now() +
        Math.max(
          hasSpecial ? NAVAL_SPECIAL_TIMING.durationMs : 1600,
          next.some((effect) => effect.kind === "cannon")
            ? Math.max(0, impactDelay - 420) + 1600
            : 0,
          impactDelay + (sunk ? 1100 : 900),
        ),
    );
    const later = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        if (alive.current) callback();
        effectTimers.current = effectTimers.current.filter(
          (item) => item !== timer,
        );
      }, delay);
      effectTimers.current.push(timer);
    };
    const show = (items: Effect[], lifetime = 1600) => {
      if (!items.length) return;
      setEffects((current) => [...current, ...items]);
      later(
        () =>
          setEffects((current) =>
            current.filter(
              (item) => !items.some((effect) => effect.id === item.id),
            ),
          ),
        lifetime,
      );
    };
    const cannonEffects = next.filter((effect) => effect.kind === "cannon");
    const enemyEffects = next.filter((effect) => effect.kind === "enemy");
    if (cannonEffects.length && !hasSpecial) setFeedback("화포 발사!");
    const cannonDelay = Math.max(0, impactDelay - 420);
    if (cannonDelay) later(() => show(cannonEffects), cannonDelay);
    else show(cannonEffects);
    show(enemyEffects);
    show(
      next.filter((effect) => effect.kind === "special"),
      NAVAL_SPECIAL_TIMING.durationMs,
    );
    const flashDamage = (items: Effect[], side: Impact["side"]) => {
      if (!items.length) return;
      const hits = items.map((effect) => ({
        id: effect.id,
        side,
        damage: effect.damage || 0,
      }));
      setImpacts((current) => [...current, ...hits]);
      later(
        () =>
          setImpacts((current) =>
            current.filter(
              (impact) => !hits.some((hit) => hit.id === impact.id),
            ),
          ),
        900,
      );
    };
    if (enemyEffects.length)
      later(() => {
        if (battle.enemyShots <= latestBattle.current.enemyShots)
          setDisplayBattle((current) => ({
            ...current,
            playerHp: battle.playerHp,
          }));
        flashDamage(enemyEffects, "allied");
      }, 420);
    if (!enemyHit && !sunk) return;
    later(() => {
      if (enemyHit || sunk)
        arrivedEnemy.current = {
          enemyHp: battle.enemyHp,
          sunkShips: battle.sunkShips,
        };
      if (sunk) enemySinkingUntil.current = performance.now() + 1100;
      setDisplayBattle((current) => ({
        ...current,
        ...(sunk
          ? { enemyHp: 0 }
          : enemyHit && performance.now() >= enemySinkingUntil.current
            ? arrivedEnemy.current
            : {}),
      }));
      flashDamage(
        next.filter((effect) => effect.kind !== "enemy"),
        "enemy",
      );
      if (sunk) {
        show([{ id: ++effectSequence.current, kind: "sunk" }], 1100);
        later(() => {
          if (performance.now() >= enemySinkingUntil.current)
            setDisplayBattle((current) => ({
              ...current,
              ...arrivedEnemy.current,
            }));
        }, 1100);
      }
    }, impactDelay);
  }, [
    battle.cannonShots,
    battle.enemyShots,
    battle.specialCount,
    battle.sunkShips,
    events,
    session.words,
  ]);

  const finish = async (options?: WeplayFinishOptions) => {
    if (finishingRef.current || guideDemo) return;
    if (exitOpenRef.current) {
      exitRequestedRef.current = true;
      setExitRequested(true);
    }
    finishingRef.current = true;
    setFinishing(true);
    setError("");
    setExitError("");
    try {
      const result = await (transport
        ? transport.finish(options)
        : finishWeplayGame(config, session.id, options));
      if (alive.current) onComplete(result);
    } catch (caught) {
      if (alive.current)
        (exitRequestedRef.current ? setExitError : setError)(
          weplayErrorMessage(
            caught,
            "전투 결과를 확인하지 못했습니다. 다시 시도해 주세요.",
          ),
        );
    } finally {
      finishingRef.current = false;
      if (alive.current) setFinishing(false);
    }
  };
  finishRef.current = (options) => void finish(options);
  useEffect(() => {
    if ((!ended && !exitRequested) || finishOnce.current || guideDemo) return;
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      if (
        pending.current.size ||
        (!exitRequestedRef.current &&
          performance.now() < effectFinishAt.current)
      )
        timer = setTimeout(settle, 100);
      else {
        finishOnce.current = true;
        finishRef.current(
          exitRequestedRef.current ? { exitEarly: true } : undefined,
        );
      }
    };
    timer = setTimeout(settle, exitRequested ? 0 : 1800);
    return () => clearTimeout(timer);
  }, [ended, exitRequested]);

  const cancelExit = () => {
    if (exitRequestedRef.current) return;
    exitOpenRef.current = false;
    setExitOpen(false);
    requestAnimationFrame(() => {
      if (!ended) input.current?.focus({ preventScroll: true });
      requestAnimationFrame(keepInputVisible);
    });
  };
  const confirmExit = () => {
    if (exitRequestedRef.current) {
      if (exitError) void finish({ exitEarly: true });
      return;
    }
    exitRequestedRef.current = true;
    setExitRequested(true);
    if (finishOnce.current && !finishingRef.current)
      void finish({ exitEarly: true });
  };

  const send = async (data: {
    sessionId: string;
    eventId: string;
    wordId: string;
    answer: string;
  }) => {
    if (pending.current.has(data.wordId) || guideDemo) return;
    pending.current.add(data.wordId);
    setAnswer("");
    setFeedback("");
    setError("");
    setRetryWord(null);
    try {
      const response = await (transport
        ? transport.answer(data)
        : submitWeplayAnswer(config, data));
      if (!alive.current) return;
      const merged = new Map(
        eventsRef.current.map((event) => [event.wordId, event]),
      );
      for (const event of response.acceptedEvents || [])
        if (!merged.has(event.wordId)) merged.set(event.wordId, event);
      const next = [...merged.values()].sort(
        (a, b) => a.elapsedMs - b.elapsedMs,
      );
      // An accepted event uses the server's clock, which can be ahead of the
      // initial session snapshot. Apply that acknowledgement immediately rather
      // than hiding the word now and waiting for the local clock to catch up.
      const local = performance.now();
      const acknowledgedNow = Math.max(
        clock.current.server + local - clock.current.local,
        Number.isFinite(response.serverNowMs)
          ? response.serverNowMs
          : clock.current.server,
      );
      clock.current = { server: acknowledgedNow, local };
      setNow((current) => Math.max(current, acknowledgedNow));
      eventsRef.current = next;
      setEvents(next);
      retryData.current.delete(data.wordId);
      if (!response.accepted) setFeedback("입력 시간이 지났습니다.");
      else
        setFeedback(
          session.words.find((word) => word.id === data.wordId)?.kind ===
            "special"
            ? "특수 전술 발동!"
            : "정답! 장전했습니다.",
        );
    } catch (caught) {
      if (alive.current) {
        retryData.current.set(data.wordId, data);
        setRetryWord(data.wordId);
        setError(
          weplayErrorMessage(
            caught,
            "입력을 확인하지 못했습니다. 같은 입력을 다시 전송할 수 있습니다.",
          ),
        );
      }
    } finally {
      pending.current.delete(data.wordId);
    }
    if (!exitOpenRef.current && !exitRequestedRef.current)
      input.current?.focus({ preventScroll: true });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      composing.current ||
      !started ||
      ended ||
      exitOpenRef.current ||
      exitRequestedRef.current ||
      (guideDemo && !guideInteractive?.wordId)
    )
      return;
    if (
      guideDemo &&
      guideInteractive?.wordId &&
      acceptedRef.current.has(guideInteractive.wordId)
    )
      return;
    const value = normalizeWeplayAnswer(answer);
    const word = [...(special ? [special] : []), ...prompts].find(
      (item) =>
        normalizeWeplayAnswer(item.text) === value &&
        !pending.current.has(item.id) &&
        !acceptedRef.current.has(item.id),
    );
    if (!word) {
      setFeedback("단어를 다시 확인해 주세요.");
      if (guideDemo) guideInteractive?.onAttempt(false);
      return;
    }
    if (guideDemo) {
      const next = [
        ...eventsRef.current,
        { wordId: word.id, elapsedMs: elapsed },
      ];
      eventsRef.current = next;
      acceptedRef.current.add(word.id);
      setEvents(next);
      setAnswer("");
      setFeedback(
        word.kind === "special" ? "학익진 발동!" : "정답! 장전했습니다.",
      );
      guideInteractive?.onAttempt(true);
      return;
    }
    void send(
      retryData.current.get(word.id) || {
        sessionId: session.id,
        eventId: crypto.randomUUID(),
        wordId: word.id,
        answer,
      },
    );
  };
  const mode = preview
    ? "교사 체험"
    : session.mode === "practice"
      ? "연습"
      : "위스 도전";
  return (
    <section
      className={`naval-game${reducedMotion ? " naval-game--still" : ""}${compactViewport ? " naval-game--compact" : ""}${pageHidden ? " naval-game--hidden" : ""}${guideDemo ? " naval-game--guide" : ""}${guideDemo && guideInteractive ? " naval-game--guide-interactive" : ""}`}
      style={
        {
          "--naval-ocean-art": `url(${ART}sea-battle.webp)`,
          "--naval-explosion-art": `url(${ART}explosion.webp)`,
          "--naval-keyboard-inset": `${keyboardInset}px`,
          "--naval-viewport-height": guideDemo
            ? "380px"
            : `${Math.max(340, Math.min(400, viewportHeight - 8))}px`,
        } as React.CSSProperties
      }
      aria-label={`${gameTitle} 해전 게임`}
    >
      <div
        className={`naval-scene${effects.some((effect) => effect.kind === "sunk") ? " has-sinking" : ""}`}
      >
        <div className="naval-ocean" aria-hidden="true" />
        <div className="naval-vignette" aria-hidden="true" />
        <div
          className="naval-fuse"
          data-weplay-guide="timeline"
          role="progressbar"
          aria-label="전투 진행 시간"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.min(
            Math.round(duration / 1000),
            Math.floor(elapsed / 1000),
          )}
          aria-valuetext={`${Math.min(Math.round(duration / 1000), Math.floor(elapsed / 1000))}초 / ${Math.round(duration / 1000)}초 · ${["초반", "중반", "후반"][phase - 1]}`}
        >
          <ol className="naval-fuse-phases" aria-label="전투 구간">
            {[1, 2, 3].map((value) => (
              <li
                key={value}
                aria-current={phase === value ? "step" : undefined}
              >
                <strong>{["초반", "중반", "후반"][value - 1]}</strong>
                <span>
                  {Math.round(((value - 1) * duration) / 3000)}–
                  {Math.round((value * duration) / 3000)}초
                </span>
              </li>
            ))}
          </ol>
          <div className="naval-fuse-rope" aria-hidden="true">
            <span
              className="naval-fuse-burnt"
              style={{ width: `${Math.min(1, elapsed / duration) * 100}%` }}
            />
            <i
              className={`naval-fuse-ember${ended ? " is-ended" : ""}`}
              style={{ left: `${Math.min(99, (elapsed / duration) * 100)}%` }}
            />
          </div>
        </div>
        <div className="naval-topbar">
          {gameTitle === DEFAULT_WEPLAY_GAME_TITLE ? (
            <Sprite
              className="naval-title-art"
              rect={[0, 0, 750, 148]}
              label={gameTitle}
            />
          ) : (
            <strong
              className="naval-title-art naval-title-custom"
              title={gameTitle}
            >
              {gameTitle}
            </strong>
          )}
          <div className="naval-hud">
            <div className="naval-hud-score">
              <span>점수</span>
              <strong>{battle.score.toLocaleString()}</strong>
            </div>
            <div className="naval-hud-combo">
              <span>연속</span>
              <strong>{combo}</strong>
            </div>
            <div
              className={`naval-hud-time${remaining <= 10 ? " is-urgent" : ""}`}
              aria-label={`남은 시간 ${remaining}초`}
            >
              <span>시간</span>
              <strong>
                {remaining}
                <small>초</small>
              </strong>
            </div>
          </div>
        </div>
        <div className="naval-battle-status">
          <span>
            {mode}
            <strong
              className={`naval-difficulty-badge naval-difficulty-badge--${session.difficulty}`}
            >
              {WEPLAY_DIFFICULTY_LABELS[session.difficulty]}
            </strong>
          </span>
          <span>
            {["초반", "중반", "후반"][phase - 1]} · 격침 {battle.sunkShips}척
          </span>
        </div>
        <div
          key={`allied-health-${alliedImpact?.id || 0}`}
          className={`naval-health naval-health--allied${alliedImpact ? " is-hit" : ""}`}
          data-weplay-guide="health-allied"
          aria-label={`아군 체력 ${displayBattle.playerHp}`}
        >
          <div className="naval-health-heading">
            <span className="naval-health-crest" aria-hidden="true">
              帥
            </span>
            <strong>아군 기함</strong>
            <span>
              {displayBattle.playerHp} / {WEPLAY_BATTLE_MAX_HP}
            </span>
          </div>
          <div className="naval-health-track">
            <meter
              aria-label="아군 체력"
              value={displayBattle.playerHp}
              min={0}
              max={WEPLAY_BATTLE_MAX_HP}
            >
              아군 체력
            </meter>
          </div>
        </div>
        <div
          key={`enemy-health-${enemyImpact?.id || 0}`}
          className={`naval-health naval-health--enemy${enemyImpact ? " is-hit" : ""}`}
          data-weplay-guide="health"
          aria-label={`적군 체력 ${displayBattle.enemyHp}`}
        >
          <div className="naval-health-heading">
            <span className="naval-health-crest" aria-hidden="true">
              敵
            </span>
            <strong>적 기함 {displayBattle.sunkShips + 1}</strong>
            <span>
              {displayBattle.enemyHp} / {WEPLAY_BATTLE_MAX_HP}
            </span>
          </div>
          <div className="naval-health-track">
            <meter
              aria-label="적군 체력"
              value={displayBattle.enemyHp}
              min={0}
              max={WEPLAY_BATTLE_MAX_HP}
            >
              적군 체력
            </meter>
          </div>
          <small>
            적 포격까지{" "}
            {Math.max(
              0,
              Math.ceil((battle.nextEnemyAttackAtMs - elapsed) / 1000),
            )}
            초
          </small>
        </div>
        <div className="naval-fleet naval-fleet--enemy" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <img
              key={index}
              className={`naval-reinforcement naval-reinforcement--${index + 1}`}
              src={`${ART}enemy-ship.webp`}
              alt=""
              draggable={false}
            />
          ))}
        </div>
        <div className="naval-fleet naval-fleet--allied" aria-hidden="true">
          {Array.from({ length: 2 }, (_, index) => (
            <img
              key={index}
              className={`naval-reinforcement naval-reinforcement--${index + 1}`}
              src={`${ART}allied-ship.webp`}
              alt=""
              draggable={false}
            />
          ))}
        </div>
        <img
          key={`allied-ship-${alliedImpact?.id || 0}`}
          className={`naval-ship naval-ship--allied${displayBattle.playerHp <= 25 ? " is-damaged" : ""}${alliedImpact ? " is-hit" : ""}`}
          src={`${ART}allied-ship.webp`}
          alt="아군 기함"
          draggable={false}
        />
        <img
          key={`enemy-ship-${displayBattle.sunkShips}-${enemyImpact?.id || 0}`}
          className={`naval-ship naval-ship--enemy${enemyImpact ? " is-hit" : ""}`}
          src={`${ART}enemy-ship.webp`}
          alt="적 기함"
          draggable={false}
        />
        <Sprite className="naval-commander" rect={[0, 175, 430, 452]} />
        <div className="naval-effects" aria-hidden="true">
          {impacts.map((impact) => (
            <strong
              className={`naval-damage naval-damage--${impact.side}`}
              key={`damage-${impact.id}`}
            >
              −{impact.damage}
              <small>
                {impact.side === "enemy" ? "적 기함 명중" : "아군 피격"}
              </small>
            </strong>
          ))}
          {effects.map((effect) =>
            effect.kind === "special" ? (
              <NavalSpecialAttack
                key={effect.id}
                tactic={effect.tactic}
                reducedMotion={guideDemo ? undefined : reducedMotion}
                paused={pageHidden}
              />
            ) : (
              <div
                key={effect.id}
                className={`naval-effect naval-effect--${effect.kind}${effect.tactic ? ` naval-effect--${effect.tactic}` : ""}`}
              >
                {(effect.kind === "cannon" || effect.kind === "enemy") && (
                  <>
                    {effect.kind === "cannon" && (
                      <span className="naval-muzzle-flash" />
                    )}
                    <Sprite
                      className="naval-cannonball"
                      rect={[1038, 641, 86, 88]}
                    />
                    <span className="naval-impact" />
                  </>
                )}
                {(effect.kind === "enemy" || effect.kind === "sunk") && (
                  <Sprite
                    className={`naval-splash naval-splash--${effect.kind}`}
                    rect={[1025, 732, 195, 195]}
                  />
                )}
                {effect.kind === "sunk" && (
                  <>
                    <img
                      className="naval-sinking-ship"
                      src={`${ART}enemy-ship.webp`}
                      alt=""
                    />
                    <strong className="naval-sunk-label">적선 격침!</strong>
                  </>
                )}
              </div>
            ),
          )}
        </div>
        {special && (
          <div
            className="naval-special"
            role="status"
            data-weplay-guide="special"
          >
            <span>
              특수 전술 ·{" "}
              {special.tactic === "last-stand" ? "생즉사 사즉생" : "학익진"}
            </span>
            <strong>{special.text}</strong>
            <div>
              <span>
                {guideDemo
                  ? "안내에서는 시간 제한이 없어요"
                  : `${special.fallDurationMs / 1000}초 안에 입력`}
              </span>
              <b>
                {Math.max(
                  0,
                  (special.spawnAtMs + special.fallDurationMs - elapsed) / 1000,
                ).toFixed(1)}
                초
              </b>
            </div>
          </div>
        )}
        <div
          className="naval-prompts"
          aria-label="입력할 단어"
          data-weplay-guide="words"
        >
          {prompts.map((word) => (
            <div
              className="naval-word"
              key={word.id}
              data-word-id={word.id}
              style={{ gridColumn: wordLanes.current.get(word.id), gridRow: 1 }}
            >
              <Sprite
                className="naval-word-splash"
                rect={[1025, 732, 195, 195]}
              />
              <strong>{word.text}</strong>
              <span className="naval-word-timer">
                {Math.max(
                  1,
                  Math.ceil(
                    (word.spawnAtMs + word.fallDurationMs - elapsed) / 1000,
                  ),
                )}
                초
              </span>
              <i
                style={{
                  transform: `scaleX(${Math.max(0, 1 - (elapsed - word.spawnAtMs) / word.fallDurationMs)})`,
                }}
              />
            </div>
          ))}
          {!prompts.length && started && !ended && !guideDemo && (
            <div className="naval-word-wait">
              {pending.current.size ? "장전 확인 중…" : "다음 단어 준비 중…"}
            </div>
          )}
          {normal.length > 3 && (
            <small className="naval-queue">
              다음 단어 {normal.length - 3}개 대기
            </small>
          )}
        </div>
        {(!started || (ended && finishOnce.current)) && (
          <div className="naval-screen-message" role="status">
            <strong>
              {!started
                ? Math.ceil((session.startsAtMs - now) / 1000)
                : battle.outcome === "defeat"
                  ? "전투 종료"
                  : "작전 완료"}
            </strong>
            <span>
              {!started
                ? "전투 준비"
                : finishing
                  ? "전투 결과 확인 중…"
                  : "전투 결과를 확인합니다."}
            </span>
          </div>
        )}
        <form className="naval-command" onSubmit={submit}>
          <div
            key={`ammo-${battle.normalCorrectCount}`}
            className={`naval-ammo${battle.normalCorrectCount > 0 ? " is-charged" : ""}`}
            data-weplay-guide="charge"
            aria-label={`포탄 장전 ${battle.ammo} / ${rules.ammoRequired}`}
          >
            <Sprite className="naval-cannon-icon" rect={[1091, 95, 107, 77]} />
            <div className="naval-ammo-slots">
              {Array.from({ length: rules.ammoRequired }, (_, index) => (
                <span
                  key={index}
                  className={index < battle.ammo ? "is-ready" : undefined}
                />
              ))}
            </div>
            <strong>
              {rules.ammoRequired}개마다 포격{" "}
              <span>
                {battle.ammo}/{rules.ammoRequired}
              </span>
            </strong>
          </div>
          <div className="naval-input-frame" data-weplay-guide="input">
            {guideDemo && guideInteractive?.wordId && (
              <span className="weplay-guide-pointer" aria-hidden="true">
                여기에 입력 <span>↓</span>
              </span>
            )}
            <label htmlFor={inputId} className="naval-sr-only">
              단어 입력
            </label>
            <input
              id={inputId}
              ref={input}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onFocus={() => {
                refreshViewport.current();
                requestAnimationFrame(keepInputVisible);
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  if (
                    alive.current &&
                    document.activeElement !== input.current
                  ) {
                    if (!guideDemo) setCompactViewport(false);
                    setKeyboardInset(0);
                  }
                }, 200);
              }}
              placeholder="단어를 입력하고 Enter"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={
                !started ||
                ended ||
                exitRequested ||
                (guideDemo && !guideInteractive?.wordId)
              }
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (composing.current ||
                    event.nativeEvent.isComposing ||
                    event.keyCode === 229)
                )
                  event.preventDefault();
              }}
            />
            <button
              type="submit"
              disabled={
                !started ||
                ended ||
                exitRequested ||
                !answer.trim() ||
                (guideDemo && !guideInteractive?.wordId)
              }
            >
              장전
            </button>
          </div>
        </form>
        <div className="naval-footer">
          <button
            className="weplay-exit-button"
            data-weplay-guide="exit"
            type="button"
            disabled={finishing || exitRequested || guideDemo}
            onClick={() => {
              exitOpenRef.current = true;
              setExitOpen(true);
            }}
          >
            나가기
          </button>
          {onShowGuide && (
            <button
              className="weplay-exit-button naval-help-button"
              type="button"
              data-weplay-guide="help"
              aria-label="게임 도움말"
              disabled={finishing || exitRequested || guideDemo}
              onClick={onShowGuide}
            >
              도움말
            </button>
          )}
          <label>
            <input
              type="checkbox"
              checked={reducedMotion}
              aria-label="움직임 줄이기"
              disabled={guideDemo}
              onChange={(event) => setReducedMotion(event.target.checked)}
            />
            효과 줄이기
          </label>
          <div className="naval-footer-info">
            <span>
              {preview
                ? "체험 · 기록·위스 미반영"
                : session.mode === "practice"
                  ? "위스 변동 없음"
                  : `도전 비용 ${session.policy.challengeCost}위스`}
            </span>
            <div className="naval-feedback" role="status">
              {feedback}
            </div>
          </div>
        </div>
      </div>
      <WeplayExitDialog
        open={exitOpen}
        confirmed={exitRequested}
        error={exitError}
        preview={preview}
        mode={session.mode}
        onCancel={cancelExit}
        onConfirm={confirmExit}
      />
      {error && (
        <div className="weplay-error" role="alert">
          <p>{error}</p>
          {ended ? (
            <button
              type="button"
              onClick={() => void finish()}
              disabled={finishing}
            >
              {finishing ? "확인 중…" : "정산 다시 시도"}
            </button>
          ) : (
            retryWord && (
              <button
                type="button"
                onClick={() => {
                  const data = retryData.current.get(retryWord);
                  if (data) void send(data);
                }}
              >
                입력 다시 전송
              </button>
            )
          )}
        </div>
      )}
    </section>
  );
}
