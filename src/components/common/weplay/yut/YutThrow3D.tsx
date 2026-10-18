import { useEffect, useRef, useState, type CSSProperties } from "react";
import { YutThrowScene, type YutThrowState } from "./YutThrowScene";
import "./yut-throw-3d.css";

export type YutThrow3DProps = YutThrowState & { onComplete?: () => void };

/** Visual only. `true` is the marked flat face up, exactly as in yutCore. */
export default function YutThrow3D({
  throwKey,
  sticks,
  rolling,
  power = 0.65,
  onComplete,
}: YutThrow3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<YutThrowScene | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const state = useRef({ throwKey, sticks, rolling, power });
  state.current = { throwKey, sticks, rolling, power };
  const seen = useRef(new Set<string>());
  const [fallback, setFallback] = useState(false);
  const [fallbackKey, setFallbackKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const [settled, setSettled] = useState(false);
  const visible = rolling || Boolean(throwKey && sticks?.length === 4);

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
    let remaining = 2250,
      started = 0,
      timer = 0,
      alive = true;
    const complete = () => {
      if (!alive) return;
      seen.current.add(key);
      setSettled(true);
      callback.current?.();
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (started)
        remaining = Math.max(0, remaining - (performance.now() - started));
      started = 0;
      setHidden(document.hidden);
      if (!document.hidden) {
        started = performance.now();
        timer = window.setTimeout(complete, remaining);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      alive = false;
      window.clearTimeout(timer);
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
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`yut-throw-3d__wood ${sticks?.[index] ? "is-flat" : ""}`}
              data-face={sticks?.[index] ? "flat" : "round"}
              style={
                {
                  "--throw-play-state": hidden ? "paused" : "running",
                  "--throw-apex": `${-35 - (Number.isFinite(power) ? Math.max(0, Math.min(1, power)) : 0.65) * 40}%`,
                  "--stick-delay": `${[0, 45, 20, 90][index]}ms`,
                  "--stick-drift": `${[-20, 8, -10, 24][index]}px`,
                  "--stick-rest": `${[-14, 9, -6, 18][index]}deg`,
                  "--stick-start": `${[-28, 20, -16, 34][index]}deg`,
                } as CSSProperties
              }
            >
              {sticks?.[index] && (
                <i>
                  ×<br />×<br />×
                </i>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
