import React, { useId } from "react";
import type { YutMove, YutNode, YutRoom } from "../../../../lib/yut";
import { PROFESSIONS, YutSprite } from "./YutArt";
import "./yut-board.css";

const WIDTH = 720;
const HEIGHT = 560;
const positions: Record<string, [number, number]> = {};
// Project the unchanged twenty-point circuit and two diagonals isometrically.
for (let step = 1; step <= 5; step++) {
  positions[`o${step}`] = [360 + step * 58, 455 - step * 40];
  positions[`o${step + 5}`] = [650 - step * 58, 255 - step * 40];
  positions[`o${step + 10}`] = [360 - step * 58, 55 + step * 40];
  positions[`o${step + 15}`] = [70 + step * 58, 255 + step * 40];
}
Object.assign(positions, {
  a1: [553.33, 255],
  a2: [456.67, 255],
  center: [360, 255],
  a4: [263.33, 255],
  a5: [166.67, 255],
  b1: [360, 121.67],
  b2: [360, 188.33],
  b4: [360, 321.67],
  b5: [360, 388.33],
  finish: [450, 490],
});
const zones = [
  { light: "#9d9e7b", face: "#777f59", edge: "#48523d", ink: "#303d2d" },
  { light: "#a6a18c", face: "#838578", edge: "#555b50", ink: "#343c36" },
  { light: "#b59474", face: "#9d7657", edge: "#70503c", ink: "#513c2b" },
  { light: "#baaa77", face: "#a08a59", edge: "#74623e", ink: "#51492e" },
];
const pointStyle = ([x, y]: [number, number]) => ({
  left: `${(x / WIDTH) * 100}%`,
  top: `${(y / HEIGHT) * 100}%`,
});
const diamond = (x: number, y: number, rx: number, ry: number) =>
  `${x},${y - ry} ${x + rx},${y} ${x},${y + ry} ${x - rx},${y}`;
export const yutNodeLabel = (node: YutNode) =>
  node === "home"
    ? "출발 전"
    : node === "finish"
      ? "완주"
      : node === "center"
        ? "가운데"
        : node.startsWith("o")
          ? `바깥 ${node.slice(1)}칸`
          : `지름길 ${node.slice(1)}칸`;

function BoardSurface({ prefix }: { prefix: string }) {
  const materials = `${import.meta.env.BASE_URL}assets/weplay/yut/materials.webp`;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="yut-isometric-surface"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={`${prefix}-wood`}
          width="192"
          height="192"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(34)"
          viewBox="0 0 627 627"
        >
          <image href={materials} width="1254" height="1254" />
          <rect width="627" height="627" fill="#242618" opacity=".25" />
        </pattern>
        <pattern
          id={`${prefix}-earth`}
          width="228"
          height="196"
          patternUnits="userSpaceOnUse"
          viewBox="0 0 627 627"
          preserveAspectRatio="none"
        >
          <image href={materials} width="1254" height="1254" y="-627" />
          <rect width="627" height="627" fill="#36432b" opacity=".16" />
        </pattern>
        <pattern
          id={`${prefix}-dirt`}
          width="150"
          height="126"
          patternUnits="userSpaceOnUse"
          viewBox="0 0 627 627"
          preserveAspectRatio="none"
        >
          <image
            href={materials}
            width="1254"
            height="1254"
            x="-627"
            y="-627"
          />
          <rect width="627" height="627" fill="#6d6245" opacity=".22" />
        </pattern>
        <pattern
          id={`${prefix}-stone`}
          width="37"
          height="29"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M1 5h7m15-1h7M9 23h11m8-8h6M2 14h4"
            stroke="#eee0b0"
            strokeWidth="1"
            opacity=".32"
          />
          <path
            d="m17 0-3 6 4 4-2 6m21 7-8-3-4 3M0 26l7-2"
            stroke="#313828"
            strokeWidth=".7"
            opacity=".4"
            fill="none"
          />
          <path
            d="M4 8h2m16 12h2m4-12h3M9 17h2m20 10h3"
            stroke="#3b3928"
            strokeWidth="1"
            opacity=".25"
          />
        </pattern>
        <pattern
          id={`${prefix}-bronze`}
          width="23"
          height="19"
          patternUnits="userSpaceOnUse"
        >
          <rect width="23" height="19" fill="#82683f" />
          <path d="M0 3h7m7 8h9M3 17h6" stroke="#b39859" strokeWidth="1" />
          <path
            d="M6 7h3m8-5h4M0 14h4m12 4h4"
            stroke="#4e553d"
            strokeWidth="2"
          />
        </pattern>
        <clipPath id={`${prefix}-ground-clip`}>
          <polygon points="132,255 360,98 588,255 360,412" />
        </clipPath>
      </defs>
      <ellipse
        cx="360"
        cy="409"
        rx="292"
        ry="102"
        fill="#0d130c"
        opacity=".38"
      />
      <path
        d="M12 255 360 14 708 255 708 278 360 520 12 278Z"
        fill={`url(#${prefix}-wood)`}
        stroke="#332a1e"
        strokeWidth="3"
      />
      <path d="M360 495 708 255V278L360 520Z" fill="#24251a" opacity=".36" />
      <path
        d="M15 266 360 505 705 266M15 274 360 513 705 274"
        fill="none"
        stroke="#ab8b50"
        strokeWidth="1.4"
        opacity=".7"
      />
      <polygon
        points="12,255 360,14 708,255 360,495"
        fill={`url(#${prefix}-wood)`}
        stroke="#b59b61"
        strokeWidth="2"
      />
      <polygon
        points="27,255 360,25 693,255 360,485"
        fill="none"
        stroke="#302c1e"
        strokeWidth="4"
      />
      <polygon
        points="30,255 360,28 690,255 360,482"
        fill="none"
        stroke="#c2a975"
        strokeWidth="1"
      />
      <polygon
        points="132,255 360,98 588,255 360,412"
        fill={`url(#${prefix}-earth)`}
        stroke="#413e29"
        strokeWidth="3"
      />
      <g clipPath={`url(#${prefix}-ground-clip)`}>
        <path
          d="M143 256H577M360 109V402"
          stroke="#465132"
          strokeWidth="28"
          opacity=".65"
        />
        <path
          d="M143 255H577M360 109V402"
          stroke={`url(#${prefix}-dirt)`}
          strokeWidth="24"
        />
        {Array.from({ length: 32 }, (_, i) => {
          const x = 158 + ((i * 73) % 405),
            y = 117 + ((i * 53) % 279);
          return (
            <g key={i} transform={`translate(${x} ${y})`}>
              <path
                d="m-7 3 3-7 1 5 3-10 1 9 5-6-2 8"
                stroke="#3e5130"
                strokeWidth="3"
                fill="none"
              />
              <path
                d="m-6 2 3-5m3 3 1-6m2 7 3-5"
                stroke="#a3a866"
                strokeWidth="1"
                fill="none"
              />
            </g>
          );
        })}
        <g transform="translate(264 181)">
          <ellipse cy="24" rx="37" ry="13" fill="#242c1e" opacity=".4" />
          <path
            d="m-25 14 25-16 26 16-26 16Z"
            fill="#777760"
            stroke="#b2a685"
          />
          <path
            d="M-21 15V-5M20 15V-5M0 25V4"
            stroke="#473421"
            strokeWidth="5"
          />
          <path
            d="M-19 13V-4M22 13V-4M2 23V4"
            stroke="#a3824c"
            strokeWidth="1.5"
          />
          <path
            d="M-35-3Q-20-9-15-18L0-29 16-18Q22-8 35-3L0 19Z"
            fill="#364436"
            stroke="#222d24"
            strokeWidth="2"
          />
          <path
            d="m-31-4 31 18L31-4M-22-8 22 5M-14-15 22-1M-5-22 21-7"
            fill="none"
            stroke="#718168"
            strokeWidth="2"
          />
          <path
            d="M-35-3 0 19 35-3M0-29V14"
            stroke="#a79965"
            fill="none"
            strokeWidth="1.4"
          />
        </g>
        <g transform="translate(461 328)">
          <ellipse cy="7" rx="27" ry="9" fill="#283122" opacity=".4" />
          <path
            d="m-23 3 6-12 13-4 15 10-4 13-20 2Zm22-1 10-15 12 1 8 13-9 10-17-2Z"
            fill="#777a65"
            stroke="#4b5441"
            strokeWidth="2"
          />
          <path
            d="m-17-8 11-3 8 5m11-6 8 1 5 6"
            stroke="#b0ad87"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="m-28 11 3-12 3 9 5-6m30 9 4-12 2 8 5-5"
            stroke="#65753d"
            strokeWidth="3"
            fill="none"
          />
        </g>
      </g>
      <polygon
        points="132,255 360,98 588,255 360,412"
        fill="none"
        stroke="#b29b62"
        strokeWidth="1.2"
      />
      {Object.entries(positions)
        .filter(([node]) => !node.startsWith("o") && node !== "finish")
        .map(([node, [x, y]]) => (
          <g key={node}>
            <ellipse
              cx={x}
              cy={y + 4}
              rx={node === "center" ? 27 : 17}
              ry={node === "center" ? 19 : 12}
              fill="#3b402b"
            />
            <ellipse
              cx={x}
              cy={y}
              rx={node === "center" ? 27 : 17}
              ry={node === "center" ? 19 : 12}
              fill="#b0a27b"
              stroke="#ded0a4"
              strokeWidth="1.2"
            />
            <ellipse
              cx={x}
              cy={y}
              rx={node === "center" ? 26 : 16}
              ry={node === "center" ? 18 : 11}
              fill={`url(#${prefix}-stone)`}
            />
            <ellipse
              cx={x}
              cy={y}
              rx={node === "center" ? 20 : 11}
              ry={node === "center" ? 13 : 7}
              fill="none"
              stroke="#6f714e"
              strokeWidth="1"
            />
            {node === "center" && (
              <path
                d={`M${x - 9} ${y}q9-13 18 0-9 13-18 0M${x} ${y - 9}q13 9 0 18-13-9 0-18`}
                stroke="#605f3f"
                fill="none"
                strokeWidth="1.5"
              />
            )}
          </g>
        ))}
      {Array.from({ length: 20 }, (_, index) => {
        const number = index + 1,
          [x, y] = positions[`o${number}`],
          zone = zones[Math.floor(index / 5)];
        const corner = number % 5 === 0,
          rx = corner ? 54 : 43,
          ry = corner ? 37 : 30,
          depth = corner ? 15 : 11;
        return (
          <g key={number}>
            <polygon
              points={`${x - rx},${y} ${x},${y + ry} ${x + rx},${y} ${x + rx},${y + depth} ${x},${y + ry + depth} ${x - rx},${y + depth}`}
              fill={zone.edge}
              stroke="#343c2a"
              strokeWidth="1"
            />
            <polygon
              points={`${x},${y + ry} ${x + rx},${y} ${x + rx},${y + depth} ${x},${y + ry + depth}`}
              fill="#20291c"
              opacity=".23"
            />
            <path
              d={`M${x - rx + 4} ${y + 5} ${x} ${y + ry + 5} ${x + rx - 4} ${y + 5}`}
              fill="none"
              stroke={zone.light}
              strokeWidth=".8"
              opacity=".55"
            />
            <polygon
              points={diamond(x, y - 3, rx, ry)}
              fill={zone.face}
              stroke={zone.light}
              strokeWidth="2"
            />
            <polygon
              points={diamond(x, y - 3, rx - 2, ry - 2)}
              fill={`url(#${prefix}-stone)`}
            />
            <polygon
              points={diamond(x, y - 3, rx - 7, ry - 6)}
              fill="none"
              stroke={zone.edge}
              strokeWidth="1.3"
            />
            <path
              d={`M${x - rx + 8} ${y - 6} ${x} ${y - ry + 3} ${x + rx - 7} ${y - 6}`}
              fill="none"
              stroke="#d0c397"
              strokeWidth=".8"
              opacity=".7"
            />
            {corner ? (
              <>
                <path
                  d={`M${x - 18} ${y - 3}q18-25 36 0-18 25-36 0`}
                  fill={`url(#${prefix}-bronze)`}
                  stroke="#c7b47f"
                  strokeWidth="1"
                />
                {number === 20 ? (
                  <text
                    x={x}
                    y={y + 3}
                    textAnchor="middle"
                    fill="#ede0b1"
                    className="yut-board-corner-glyph"
                  >
                    始
                  </text>
                ) : (
                  <path
                    d={`m${x - 9} ${y - 3} 9-7 9 7-9 7Zm9-13v5m-18 8h5m13 0h5m-5 9v-5`}
                    stroke="#d3c28f"
                    strokeWidth="1.4"
                    fill="none"
                  />
                )}
              </>
            ) : (
              <>
                <path
                  d={`M${x - 7} ${y - 3}l7-5 7 5-7 5Z`}
                  fill="none"
                  stroke={zone.ink}
                  strokeWidth="1.5"
                />
                <text
                  x={x}
                  y={y + 20}
                  textAnchor="middle"
                  fill={zone.ink}
                  className="yut-board-step-number"
                >
                  {number}
                </text>
              </>
            )}
          </g>
        );
      })}
      <g className="yut-board-finish-mark" fill="#c5ac76">
        <path
          d="M386 493h45m-8-5 8 5-8 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <text x="451" y="497" textAnchor="middle">
          완주
        </text>
      </g>
    </svg>
  );
}

function Pawn({ role }: { role: keyof typeof PROFESSIONS }) {
  return (
    <span className="yut-isometric-pawn" aria-hidden="true">
      <i className="yut-pawn-foot-shadow" />
      <YutSprite role={role} />
    </span>
  );
}

export default function YutBoard({
  room,
  uid,
  selectedPiece,
  onSelectPiece,
  moves,
  onMove,
  disabled,
  children,
  revealMoves = true,
}: {
  room: YutRoom;
  uid: string;
  selectedPiece: string;
  onSelectPiece: (id: string) => void;
  moves: YutMove[];
  onMove: (move: YutMove) => void;
  disabled: boolean;
  children?: React.ReactNode;
  revealMoves?: boolean;
}) {
  const prefix = `yut-board-${useId().replace(/:/g, "")}`;
  const destinations = revealMoves
    ? moves.filter((move) => move.pieceId === selectedPiece)
    : [];
  return (
    <div className="yut-isometric-board-wrap">
      <div
        className="yut-board yut-isometric-board"
        role="group"
        aria-label="윷판"
      >
        <BoardSurface prefix={prefix} />
        {children && <div className="yut-board-center-overlay">{children}</div>}
        {room.players
          .filter((player) => player.active)
          .flatMap((player) => {
            const nodes = [
              ...new Set(
                player.pieces
                  .filter(
                    (piece) => piece.node !== "home" && piece.node !== "finish",
                  )
                  .map((piece) => piece.node),
              ),
            ];
            return nodes.map((node) => {
              const pieces = player.pieces.filter(
                (piece) => piece.node === node,
              );
              const selectable =
                player.uid === uid &&
                moves.some((move) =>
                  pieces.some((piece) => piece.id === move.pieceId),
                );
              const selected =
                player.uid === uid &&
                pieces.some((piece) => piece.id === selectedPiece);
              return (
                <button
                  key={`${player.uid}-${node}`}
                  type="button"
                  className={`yut-board-piece yut-isometric-piece${selected ? " is-selected" : ""}`}
                  style={
                    {
                      ...pointStyle(positions[node] || positions.center),
                      "--piece-color": PROFESSIONS[player.role].color,
                    } as React.CSSProperties
                  }
                  onClick={() => onSelectPiece(pieces[0].id)}
                  disabled={disabled || !selectable || !revealMoves}
                  aria-pressed={selectable ? selected : undefined}
                  aria-label={`${player.name} ${PROFESSIONS[player.role].job}, 말 ${pieces.map((piece) => piece.id).join("·")}, ${yutNodeLabel(node)}${selectable ? ", 선택" : ""}`}
                >
                  <Pawn role={player.role} />
                  <span className="yut-isometric-piece-count">
                    {pieces.length > 1 ? "×2" : pieces[0].id}
                  </span>
                </button>
              );
            });
          })}
        {destinations.map((move) => (
          <button
            key={`${move.route}-${move.targetNode}`}
            type="button"
            className="yut-destination yut-isometric-destination"
            style={pointStyle(positions[move.targetNode] || positions.o20)}
            disabled={disabled}
            onClick={() => onMove(move)}
            aria-label={`말 ${move.pieceId}, ${move.route === "outer" ? "바깥길" : "지름길"}, ${yutNodeLabel(move.targetNode)}${yutNodeLabel(move.targetNode).endsWith("칸") ? "으로" : "로"} 이동`}
          >
            <span
              className="yut-isometric-destination-symbol"
              aria-hidden="true"
            >
              {move.targetNode === "finish" ? "✓" : "↓"}
            </span>
            <span className="yut-isometric-destination-label">
              {move.targetNode === "finish" ? "완주" : "이동"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
