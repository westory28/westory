import { useState, type CSSProperties, type ReactNode } from "react";
import "./WisStockFlapFaces.css";

/** Mount over the new face, keyed by the transition. Only the base face is accessible. */
export default function WisStockFlapFaces({
  before,
  after,
  delayMs = 0,
  onFinish,
}: {
  before: ReactNode;
  after: ReactNode;
  delayMs?: number;
  onFinish?: () => void;
}) {
  const [finished, setFinished] = useState(false);
  if (finished) return null;
  return (
    <div
      className="wis-flap"
      aria-hidden="true"
      style={{ "--wis-flap-delay": delayMs + "ms" } as CSSProperties}
    >
      <div className="wis-flap__lower">
        <div className="wis-flap__sheet">{before}</div>
      </div>
      <div className="wis-flap__fold">
        <div className="wis-flap__sheet">{before}</div>
      </div>
      <div
        className="wis-flap__unfold"
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          setFinished(true);
          onFinish?.();
        }}
      >
        <div className="wis-flap__sheet">{after}</div>
      </div>
    </div>
  );
}
