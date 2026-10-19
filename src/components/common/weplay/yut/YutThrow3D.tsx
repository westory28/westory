import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  YutThrowScene,
  YUT_VISUAL_THROW_MS,
  yutThrowPlan,
  type YutThrowState,
} from "./YutThrowScene";
import "./yut-throw-3d.css";

export type YutThrow3DProps = YutThrowState & {
  onComplete?: () => void;
  onRelease?: () => void;
  onImpact?: (index: number) => void;
};

/** Visual only. `true` is the pale flat belly up, exactly as in yutCore. */
export default function YutThrow3D({
  throwKey,
  sticks,
  rolling,
  power = 0.65,
  onComplete,
  onRelease,
  onImpact,
}: YutThrow3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<YutThrowScene | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const audio = useRef({ onRelease, onImpact });
  audio.current = { onRelease, onImpact };
  const sounded = useRef(new Map<string, Set<number>>());
  const state = useRef({ throwKey, sticks, rolling, power });
  state.current = { throwKey, sticks, rolling, power };
  const seen = useRef(new Set<string>());
  const [fallback, setFallback] = useState(false);
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const [settled, setSettled] = useState(false);
  const visible = rolling || Boolean(throwKey && sticks?.length === 4);
  const sound = (index: number) => {
    const key = state.current.throwKey;
    if (!key || document.hidden || seen.current.has(key)) return;
    const events = sounded.current.get(key) || new Set<number>();
    if (events.has(index)) return;
    events.add(index);
    sounded.current.set(key, events);
    if (sounded.current.size > 24)
      sounded.current.delete(sounded.current.keys().next().value!);
    if (index < 0) audio.current.onRelease?.();
    else audio.current.onImpact?.(index);
  };

  useEffect(() => {
    if (!visible || !host.current) return;
    let alive = true;
    setFallback(false);
    const complete = () => {
      if (!alive) return;
      setSettled(true);
      callback.current?.();
    };
    try {
      const driver = new YutThrowScene(
        host.current,
        seen.current,
        complete,
        () => {
          if (alive) setFallback(true);
        },
        () => {
          if (alive) sound(-1);
        },
        (index) => {
          if (alive) sound(index);
        },
      );
      scene.current = driver;
      driver.update(state.current);
    } catch {
      // Rendering support must never block the server-authoritative game.
      setFallback(true);
    }
    return () => {
      alive = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [visible]);

  useEffect(() => {
    if (rolling || (throwKey && !seen.current.has(throwKey))) setSettled(false);
    else if (throwKey && seen.current.has(throwKey)) setSettled(true);
    scene.current?.update({ throwKey, sticks, rolling, power });
  }, [throwKey, sticks, rolling, fallback, power]);

  useEffect(() => {
    if (
      !fallback ||
      !throwKey ||
      sticks?.length !== 4 ||
      seen.current.has(throwKey)
    )
      return;
    // Even without WebGL, the four sticks make a bounded throw before revealing the result.
    const key = throwKey;
    setFallbackKey(key);
    setSettled(false);
    let remaining = YUT_VISUAL_THROW_MS,
      started = 0,
      timer = 0,
      alive = true;
    let impactTimers: number[] = [];
    const complete = () => {
      if (!alive) return;
      seen.current.add(key);
      setSettled(true);
      callback.current?.();
    };
    const visibility = () => {
      window.clearTimeout(timer);
      impactTimers.forEach(window.clearTimeout);
      impactTimers = [];
      if (started)
        remaining = Math.max(0, remaining - (performance.now() - started));
      started = 0;
      setHidden(document.hidden);
      if (!document.hidden) {
        sound(-1);
        for (let index = 0; index < 4; index++) {
          const plan = yutThrowPlan(index, power, key);
          impactTimers.push(
            window.setTimeout(
              () => {
                if (alive) sound(index);
              },
              Math.max(
                0,
                (plan.delay + plan.flight) * 1000 -
                  (YUT_VISUAL_THROW_MS - remaining),
              ),
            ),
          );
        }
        started = performance.now();
        timer = window.setTimeout(complete, remaining);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      impactTimers.forEach(window.clearTimeout);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [fallback, throwKey, sticks?.length]);

  if (!visible) return null;
  return (
    <div
      className={`yut-throw-3d ${settled ? "is-settled" : "is-rolling"}`}
      aria-hidden="true"
      data-renderer={fallback ? "fallback" : "webgl"}
      data-power={
        Number.isFinite(power) ? Math.max(0, Math.min(1, power)) : 0.65
      }
    >
      <div ref={host} className="yut-throw-3d__canvas" />
      {fallback && (
        <div
          key={fallbackKey}
          className={`yut-throw-3d__fallback ${fallbackKey ? "has-result" : ""}`}
        >
          {[0, 1, 2, 3].map((index) => {
            const plan = yutThrowPlan(index, power, throwKey || "");
            return (
              <span
                key={index}
                className={`yut-throw-3d__wood ${sticks?.[index] ? "is-flat" : ""}`}
                data-face={sticks?.[index] ? "flat" : "round"}
                style={
                  {
                    "--throw-play-state": hidden ? "paused" : "running",
                    "--throw-apex": `${plan.lift * 28}%`,
                    "--stick-flight-name":
                      plan.strength < 0.35
                        ? "yut-fallback-low-flight"
                        : "yut-fallback-flight",
                    "--stick-delay": `${plan.delay * 1000}ms`,
                    "--stick-flight": `${plan.flight * 1000}ms`,
                    "--stick-settle": `${plan.settle * 1000}ms`,
                    "--stick-contact": `${(plan.delay + plan.flight) * 1000}ms`,
                    "--stick-land-x": `${50 + plan.x * 24}%`,
                    "--stick-land-y": `${53 + plan.z * 26}%`,
                    "--stick-mid-x": `${50 + plan.x * (12 + plan.strength * 6)}%`,
                    "--stick-start-x": `${50 + (index - 1.5) * 3}%`,
                    "--stick-rest": `${(plan.yaw * 180) / Math.PI}deg`,
                    "--stick-start": `${(plan.start * 180) / Math.PI}deg`,
                  } as CSSProperties
                }
              >
                {!sticks?.[index] && (
                  <i>
                    ×<br />×<br />×
                  </i>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
