import { useEffect, useRef, useState } from "react";
import { YutThrowScene, type YutThrowState } from "./YutThrowScene";
import "./yut-throw-3d.css";

export type YutThrow3DProps = YutThrowState & { onComplete?: () => void };

/** Visual only. `true` is the marked flat face up, exactly as in yutCore. */
export default function YutThrow3D({
  throwKey,
  sticks,
  rolling,
  onComplete,
}: YutThrow3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<YutThrowScene | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const state = useRef({ throwKey, sticks, rolling });
  state.current = { throwKey, sticks, rolling };
  const seen = useRef(new Set<string>());
  const [fallback, setFallback] = useState(false);
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
    scene.current?.update({ throwKey, sticks, rolling });
    if (!fallback || !throwKey || !sticks || seen.current.has(throwKey)) return;
    seen.current.add(throwKey);
    setSettled(true);
    // The DOM fallback is static and never adds time to a turn.
    callback.current?.();
  }, [throwKey, sticks, rolling, fallback]);

  if (!visible) return null;
  return (
    <div
      className={`yut-throw-3d ${settled ? "is-settled" : "is-rolling"}`}
      aria-hidden="true"
      data-renderer={fallback ? "fallback" : "webgl"}
    >
      <div ref={host} className="yut-throw-3d__canvas" />
      {fallback && (
        <div className="yut-throw-3d__fallback">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`yut-throw-3d__wood ${sticks?.[index] ? "is-flat" : ""}`}
              data-face={sticks?.[index] ? "flat" : "round"}
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
