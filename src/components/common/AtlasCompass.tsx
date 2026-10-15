import { forwardRef } from "react";
import "./atlasCompass.css";

/** Bearing is updated with the canvas frame, without re-rendering its map. */
const AtlasCompass = forwardRef<HTMLDivElement>(function AtlasCompass(_, ref) {
  return (
    <div
      ref={ref}
      className="atlas-compass"
      role="img"
      aria-label="지도 중앙 기준 방위"
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <g className="atlas-compass__rose">
          <path className="atlas-compass__axis" d="M12 24h24M24 12v24" />
          <path className="atlas-compass__north" d="m24 12-4 15 4-3 4 3Z" />
          <text x="24" y="6">
            북
          </text>
          <text x="42" y="24">
            동
          </text>
          <text x="24" y="42">
            남
          </text>
          <text x="6" y="24">
            서
          </text>
        </g>
      </svg>
    </div>
  );
});

export default AtlasCompass;
