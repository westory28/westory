import React, {
  useEffect,
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
} from "../../../lib/weplay";
import {
  simulateWeplayBattle,
  WEPLAY_BATTLE_CONFIG,
  WEPLAY_BATTLE_MAX_HP,
} from "../../../lib/weplayBattle";
import type { HistoryRainGameProps } from "./HistoryRainGame";
import "./naval-battle.css";

const ART = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;
type BattleEvent = { wordId: string; elapsedMs: number };
type Effect = {
  id: number;
  kind: "cannon" | "enemy" | "special" | "sunk";
  tactic?: string;
};
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
  session,
  config,
  onComplete,
  preview = false,
  transport,
}: HistoryRainGameProps) {
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
  const [effects, setEffects] = useState<Effect[]>([]);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [compactViewport, setCompactViewport] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const initialViewportHeight = useRef(window.innerHeight);
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
    const shift =
      rect.bottom > bottom - 12
        ? rect.bottom - bottom + 12
        : rect.top < top + 12
          ? rect.top - top - 12
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
  const finishRef = useRef<() => void>(() => undefined);
  const effectSequence = useRef(0);
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const elapsed = Math.max(0, now - session.startsAtMs);
  const duration = session.endsAtMs - session.startsAtMs;
  const started = now >= session.startsAtMs;
  const battle = useMemo(
    () => simulateWeplayBattle(session, elapsed, events),
    [session, elapsed, events],
  );
  const ended = now >= session.endsAtMs || battle.outcome === "defeat";
  const remaining = Math.max(
    0,
    Math.ceil((session.endsAtMs - Math.max(now, session.startsAtMs)) / 1000),
  );
  const phase = Math.min(3, Math.floor(elapsed / (duration / 3)) + 1);
  const rules = WEPLAY_BATTLE_CONFIG[session.difficulty];
  const visible = session.words.filter(
    (word) =>
      !accepted.has(word.id) &&
      !pending.current.has(word.id) &&
      elapsed >= word.spawnAtMs &&
      elapsed < word.spawnAtMs + word.fallDurationMs &&
      !ended &&
      started,
  );
  const normal = visible
    .filter((word) => word.kind !== "special")
    .sort(
      (a, b) => a.spawnAtMs + a.fallDurationMs - b.spawnAtMs - b.fallDurationMs,
    );
  const prompts = normal.slice(0, 3);
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
    const timer = window.setInterval(
      () =>
        setNow(clock.current.server + performance.now() - clock.current.local),
      50,
    );
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => setReducedMotion(media.matches);
    media.addEventListener("change", motionChanged);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    const viewport = window.visualViewport;
    const viewportChanged = () => {
      const height = viewport?.height || window.innerHeight;
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
    viewport?.addEventListener("resize", viewportChanged);
    viewport?.addEventListener("scroll", viewportChanged);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      media.removeEventListener("change", motionChanged);
      window.removeEventListener("beforeunload", warn);
      viewport?.removeEventListener("resize", viewportChanged);
      viewport?.removeEventListener("scroll", viewportChanged);
      effectTimers.current.forEach(clearTimeout);
    };
  }, []);
  useLayoutEffect(() => {
    if (compactViewport) keepInputVisible();
  }, [compactViewport, keyboardInset]);
  useEffect(() => {
    if (started && !ended) {
      input.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => requestAnimationFrame(keepInputVisible));
    }
  }, [started, ended, compactViewport]);
  useEffect(() => {
    const previous = previousBattle.current;
    const next: Effect[] = [];
    if (battle.cannonShots > previous.cannonShots)
      next.push({ id: ++effectSequence.current, kind: "cannon" });
    if (battle.enemyShots > previous.enemyShots)
      next.push({ id: ++effectSequence.current, kind: "enemy" });
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
        tactic: session.words.find((word) => word.id === latest?.wordId)
          ?.tactic,
      });
    }
    if (battle.sunkShips > previous.sunkShips)
      next.push({ id: ++effectSequence.current, kind: "sunk" });
    previousBattle.current = {
      cannonShots: battle.cannonShots,
      enemyShots: battle.enemyShots,
      specialCount: battle.specialCount,
      sunkShips: battle.sunkShips,
    };
    if (!next.length) return;
    setEffects((current) => [...current.slice(-5), ...next]);
    const timer = setTimeout(() => {
      if (alive.current)
        setEffects((current) =>
          current.filter(
            (item) => !next.some((effect) => effect.id === item.id),
          ),
        );
      effectTimers.current = effectTimers.current.filter(
        (item) => item !== timer,
      );
    }, 1400);
    effectTimers.current.push(timer);
  }, [
    battle.cannonShots,
    battle.enemyShots,
    battle.specialCount,
    battle.sunkShips,
    events,
    session.words,
  ]);

  const finish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setError("");
    try {
      const result = await (transport
        ? transport.finish()
        : finishWeplayGame(config, session.id));
      if (alive.current) onComplete(result);
    } catch (caught) {
      if (alive.current)
        setError(
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
  finishRef.current = () => void finish();
  useEffect(() => {
    if (!ended || finishOnce.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      if (pending.current.size) timer = setTimeout(settle, 250);
      else {
        finishOnce.current = true;
        finishRef.current();
      }
    };
    timer = setTimeout(settle, 1000);
    return () => clearTimeout(timer);
  }, [ended]);

  const send = async (data: {
    sessionId: string;
    eventId: string;
    wordId: string;
    answer: string;
  }) => {
    if (pending.current.has(data.wordId)) return;
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
      eventsRef.current = next;
      setEvents(next);
      retryData.current.delete(data.wordId);
      if (!response.accepted)
        setFeedback("입력 시간이 지났습니다. 다음 단어를 입력해 주세요.");
      else
        setFeedback(
          session.words.find((word) => word.id === data.wordId)?.kind ===
            "special"
            ? "특수 전술 발동!"
            : "정답! 포탄을 장전했습니다.",
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
    input.current?.focus({ preventScroll: true });
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (composing.current || !started || ended) return;
    const value = normalizeWeplayAnswer(answer);
    const word = [...(special ? [special] : []), ...prompts].find(
      (item) =>
        normalizeWeplayAnswer(item.text) === value &&
        !pending.current.has(item.id) &&
        !acceptedRef.current.has(item.id),
    );
    if (!word) {
      setFeedback("표시된 단어를 확인해 주세요.");
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
      className={`naval-game${reducedMotion ? " naval-game--still" : ""}${compactViewport ? " naval-game--compact" : ""}`}
      style={
        {
          "--naval-ocean-art": `url(${ART}sea-battle.webp)`,
          "--naval-explosion-art": `url(${ART}explosion.webp)`,
          "--naval-keyboard-inset": `${keyboardInset}px`,
        } as React.CSSProperties
      }
      aria-label="내가 충무공이라고?! 해전 게임"
    >
      <div
        className={`naval-scene${effects.some((effect) => effect.kind === "sunk") ? " has-sinking" : ""}`}
      >
        <div className="naval-vignette" aria-hidden="true" />
        <div className="naval-topbar">
          <Sprite
            className="naval-title-art"
            rect={[0, 0, 750, 148]}
            label="내가 충무공이라고?!"
          />
          <div className="naval-hud">
            <div className="naval-hud-score">
              <span>SCORE</span>
              <strong>{battle.score.toLocaleString()}</strong>
            </div>
            <div className="naval-hud-combo">
              <span>COMBO</span>
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
            {mode} · {WEPLAY_DIFFICULTY_LABELS[session.difficulty]}
          </span>
          <span>
            {["초반", "중반", "후반"][phase - 1]} · 격침 {battle.sunkShips}척
          </span>
        </div>
        <div
          className="naval-health naval-health--allied"
          aria-label={`아군 체력 ${battle.playerHp}`}
        >
          <div>
            <strong>조선 수군</strong>
            <span>
              {battle.playerHp} / {WEPLAY_BATTLE_MAX_HP}
            </span>
          </div>
          <meter
            aria-label="아군 체력"
            value={battle.playerHp}
            min={0}
            max={WEPLAY_BATTLE_MAX_HP}
          >
            아군 체력
          </meter>
        </div>
        <div
          className="naval-health naval-health--enemy"
          aria-label={`적군 체력 ${battle.enemyHp}`}
        >
          <div>
            <strong>적선 {battle.sunkShips + 1}</strong>
            <span>
              {battle.enemyHp} / {WEPLAY_BATTLE_MAX_HP}
            </span>
          </div>
          <meter
            aria-label="적군 체력"
            value={battle.enemyHp}
            min={0}
            max={WEPLAY_BATTLE_MAX_HP}
          >
            적군 체력
          </meter>
          <small>
            적 포격까지{" "}
            {Math.max(
              0,
              Math.ceil((battle.nextEnemyAttackAtMs - elapsed) / 1000),
            )}
            초
          </small>
        </div>
        <img
          className={`naval-ship naval-ship--allied${battle.playerHp <= 25 ? " is-damaged" : ""}`}
          src={`${ART}allied-ship.webp`}
          alt="조선 수군 전함"
          draggable={false}
        />
        <img
          key={battle.sunkShips}
          className="naval-ship naval-ship--enemy"
          src={`${ART}enemy-ship.webp`}
          alt="적군 전함"
          draggable={false}
        />
        <Sprite className="naval-commander" rect={[0, 175, 430, 452]} />
        <div className="naval-effects" aria-hidden="true">
          {effects.map((effect) => (
            <div
              key={effect.id}
              className={`naval-effect naval-effect--${effect.kind}${effect.tactic ? ` naval-effect--${effect.tactic}` : ""}`}
            >
              {(effect.kind === "cannon" ||
                effect.kind === "enemy" ||
                effect.kind === "special") && (
                <>
                  <Sprite
                    className="naval-cannonball"
                    rect={[1038, 641, 86, 88]}
                  />
                  <span className="naval-impact" />
                </>
              )}
              {effect.kind === "special" && (
                <>
                  {effect.tactic === "crane-wing" && (
                    <>
                      <img
                        className="naval-flank naval-flank--upper"
                        src={`${ART}allied-ship.webp`}
                        alt=""
                      />
                      <img
                        className="naval-flank naval-flank--lower"
                        src={`${ART}allied-ship.webp`}
                        alt=""
                      />
                    </>
                  )}
                  <Sprite
                    className="naval-cannonball naval-cannonball--second"
                    rect={[1038, 641, 86, 88]}
                  />
                  <Sprite
                    className="naval-cannonball naval-cannonball--third"
                    rect={[1038, 641, 86, 88]}
                  />
                  {effect.tactic === "last-stand" && (
                    <>
                      <span className="naval-impact naval-impact--second" />
                      <span className="naval-impact naval-impact--third" />
                      <span className="naval-shockwave" />
                    </>
                  )}
                  <strong className="naval-tactic-name">
                    {effect.tactic === "last-stand"
                      ? "생즉사 사즉생"
                      : "학익진"}
                  </strong>
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
          ))}
        </div>
        {special && (
          <div className="naval-special" role="status">
            <span>
              특수 전술 ·{" "}
              {special.tactic === "last-stand" ? "생즉사 사즉생" : "학익진"}
            </span>
            <strong>{special.text}</strong>
            <div>
              <span>3초 안에 입력</span>
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
        <div className="naval-prompts" aria-label="입력할 단어">
          {prompts.map((word) => (
            <div className="naval-word" key={word.id}>
              <strong>{word.text}</strong>
              <span>
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
          {!prompts.length && started && !ended && (
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
        {(!started || ended) && (
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
            className="naval-ammo"
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
              포격 준비{" "}
              <span>
                {battle.ammo}/{rules.ammoRequired}
              </span>
            </strong>
          </div>
          <div className="naval-input-frame">
            <label htmlFor="naval-answer-input" className="naval-sr-only">
              단어 입력
            </label>
            <input
              id="naval-answer-input"
              ref={input}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onFocus={() => requestAnimationFrame(keepInputVisible)}
              onBlur={() => {
                window.setTimeout(() => {
                  if (
                    alive.current &&
                    document.activeElement !== input.current
                  ) {
                    setCompactViewport(false);
                    setKeyboardInset(0);
                  }
                }, 200);
              }}
              placeholder="단어를 입력하고 Enter"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={!started || ended}
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
              disabled={!started || ended || !answer.trim()}
            >
              장전
            </button>
          </div>
        </form>
      </div>
      <div className="naval-footer">
        <label>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)}
          />
          움직임 줄이기
        </label>
        <span>
          {preview
            ? "위스·랭킹·학생 기록에 반영되지 않습니다."
            : session.mode === "practice"
              ? "위스 변동 없음"
              : `도전 비용 ${session.policy.challengeCost}위스`}
        </span>
      </div>
      <div className="naval-feedback" role="status">
        {feedback ||
          (started && !ended
            ? `정답 ${rules.ammoRequired}개마다 자동 포격`
            : "")}
      </div>
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
