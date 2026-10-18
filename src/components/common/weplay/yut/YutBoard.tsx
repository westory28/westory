import React, { useId } from "react";
import type { YutMove, YutNode, YutRoom } from "../../../../lib/yut";
import { PROFESSIONS } from "./YutArt";
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
  {
    light: "#dcece2",
    face: "#89ac99",
    edge: "#427564",
    ink: "#234e43",
    glyph: "士",
  },
  {
    light: "#e0e7ee",
    face: "#8d9cae",
    edge: "#4b6076",
    ink: "#2f435a",
    glyph: "農",
  },
  {
    light: "#f3e1d7",
    face: "#ca9a83",
    edge: "#a46853",
    ink: "#793e30",
    glyph: "工",
  },
  {
    light: "#f6edce",
    face: "#d8bf80",
    edge: "#aa8548",
    ink: "#755822",
    glyph: "商",
  },
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
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="yut-isometric-surface"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${prefix}-ivory`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#fff9e7" />
          <stop offset=".55" stopColor="#e8d9b9" />
          <stop offset="1" stopColor="#cfbb91" />
        </linearGradient>
        <linearGradient id={`${prefix}-bronze`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#b69a63" />
          <stop offset=".45" stopColor="#8f7349" />
          <stop offset="1" stopColor="#65513b" />
        </linearGradient>
        <radialGradient id={`${prefix}-floor`}>
          <stop stopColor="#faf4e1" />
          <stop offset="1" stopColor="#e0d1b3" />
        </radialGradient>
        {zones.map((zone, index) => (
          <linearGradient
            key={index}
            id={`${prefix}-tile-${index}`}
            x1="0"
            y1="0"
            x2=".65"
            y2="1"
          >
            <stop stopColor={zone.light} />
            <stop offset="1" stopColor={zone.face} />
          </linearGradient>
        ))}
        <filter
          id={`${prefix}-shadow`}
          x="-20%"
          y="-20%"
          width="140%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <ellipse
        cx="360"
        cy="399"
        rx="280"
        ry="106"
        fill="#090f16"
        opacity=".24"
        filter={`url(#${prefix}-shadow)`}
      />
      <path
        d="M12 255 360 14 708 255 708 278 360 520 12 278Z"
        fill={`url(#${prefix}-bronze)`}
        stroke="#6e583c"
        strokeWidth="2"
      />
      <path d="M360 495 708 255V278L360 520Z" fill="#705f45" opacity=".38" />
      <path
        d="M15 266 360 505 705 266M15 274 360 513 705 274"
        fill="none"
        stroke="#ead4a2"
        strokeWidth="1.4"
        opacity=".55"
      />
      <polygon
        points="12,255 360,14 708,255 360,495"
        fill={`url(#${prefix}-ivory)`}
        stroke="#f5e9c8"
        strokeWidth="3"
      />
      <polygon
        points="29,255 360,26 691,255 360,484"
        fill="none"
        stroke="#a98b52"
        strokeWidth="1.5"
      />
      <polygon
        points="132,255 360,98 588,255 360,412"
        fill={`url(#${prefix}-floor)`}
        stroke="#ad986e"
        strokeWidth="1.3"
      />
      <polygon
        points="143,255 360,105 577,255 360,405"
        fill="none"
        stroke="#fff9e6"
        strokeWidth="2"
      />
      <g fill="none" stroke="#bba67d" strokeWidth="1.5" opacity=".45">
        <path d="M220 207c-20-18-50 6-27 18 17 9 32-11 20-18m-27 30c12-5 30 1 36 9M489 207c20-18 50 6 27 18-17 9-32-11-20-18m27 30c-12-5-30 1-36 9" />
        <path d="M254 310c-15 16 8 34 19 16 9-14-7-25-18-16m27 7c6-11 21-13 31-10M466 310c15 16-8 34-19 16-9-14 7-25 18-16m-27 7c-6-11-21-13-31-10" />
        <path
          d="M294 168q66-39 132 0M287 347q73 41 146 0"
          strokeDasharray="2 7"
        />
      </g>
      <g stroke="#aa9164" fill="none">
        <path d="M70 255H650M360 55V455" strokeWidth="2" opacity=".38" />
        <path
          d="M70 258H650M363 55V455"
          stroke="#fff9e9"
          strokeWidth="1"
          opacity=".6"
        />
      </g>
      {Object.entries(positions)
        .filter(([node]) => !node.startsWith("o") && node !== "finish")
        .map(([node, [x, y]]) => (
          <g key={node}>
            <ellipse
              cx={x}
              cy={y + 4}
              rx={node === "center" ? 27 : 17}
              ry={node === "center" ? 19 : 12}
              fill="#b6a17b"
            />
            <ellipse
              cx={x}
              cy={y}
              rx={node === "center" ? 27 : 17}
              ry={node === "center" ? 19 : 12}
              fill="#f5e9cd"
              stroke="#b39a65"
              strokeWidth="1.5"
            />
            <ellipse
              cx={x}
              cy={y}
              rx={node === "center" ? 20 : 11}
              ry={node === "center" ? 13 : 7}
              fill="none"
              stroke="#c9b482"
              strokeWidth="1"
            />
            {node === "center" && (
              <path
                d={`M${x - 9} ${y}q9-13 18 0-9 13-18 0M${x} ${y - 9}q13 9 0 18-13-9 0-18`}
                stroke="#b59b63"
                fill="none"
                strokeWidth="1.2"
              />
            )}
          </g>
        ))}
      {Array.from({ length: 20 }, (_, index) => {
        const number = index + 1,
          [x, y] = positions[`o${number}`],
          zoneIndex = Math.floor(index / 5),
          zone = zones[zoneIndex];
        const corner = number % 5 === 0,
          rx = corner ? 54 : 43,
          ry = corner ? 37 : 30,
          depth = corner ? 15 : 11;
        return (
          <g key={number}>
            <polygon
              points={`${x - rx},${y} ${x},${y + ry} ${x + rx},${y} ${x + rx},${y + depth} ${x},${y + ry + depth} ${x - rx},${y + depth}`}
              fill={zone.edge}
              stroke="#8e7957"
              strokeWidth=".7"
            />
            <polygon
              points={`${x},${y + ry} ${x + rx},${y} ${x + rx},${y + depth} ${x},${y + ry + depth}`}
              fill="#2d3540"
              opacity=".15"
            />
            <polygon
              points={diamond(x, y - 3, rx, ry)}
              fill={`url(#${prefix}-tile-${zoneIndex})`}
              stroke="#fff7e1"
              strokeWidth="1.6"
            />
            <polygon
              points={diamond(x, y - 3, rx - 6, ry - 5)}
              fill="none"
              stroke={zone.edge}
              strokeWidth=".8"
              opacity=".6"
            />
            {corner ? (
              <>
                <path
                  d={`M${x - 18} ${y - 3}q18-25 36 0-18 25-36 0`}
                  fill={zone.light}
                  stroke={zone.edge}
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={y + 3}
                  textAnchor="middle"
                  fill={zone.ink}
                  className="yut-board-corner-glyph"
                >
                  {number === 20 ? "始" : zone.glyph}
                </text>
              </>
            ) : (
              <>
                <path
                  d={`M${x - 7} ${y - 3}l7-5 7 5-7 5Z`}
                  fill="none"
                  stroke={zone.ink}
                  strokeWidth="1.5"
                  opacity=".65"
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

function Pawn({
  role,
  prefix,
}: {
  role: keyof typeof PROFESSIONS;
  prefix: string;
}) {
  const color = PROFESSIONS[role].color;
  return (
    <svg viewBox="0 0 52 66" className="yut-isometric-pawn" aria-hidden="true">
      <defs>
        <linearGradient id={`${prefix}-pawn`} x1="0" y1="0" x2="1" y2=".4">
          <stop stopColor="#fff0ca" />
          <stop offset=".22" stopColor={color} />
          <stop offset=".62" stopColor={color} />
          <stop offset="1" stopColor="#273c3e" />
        </linearGradient>
      </defs>
      <ellipse cx="26" cy="59" rx="21" ry="6" fill="#172523" opacity=".25" />
      <path
        d="M10 49c0-4 7-5 9-13V25h14v11c2 8 9 9 9 13v5c-8 7-24 7-32 0Z"
        fill={`url(#${prefix}-pawn)`}
        stroke="#6c6753"
        strokeWidth="1"
      />
      <ellipse
        cx="26"
        cy="50"
        rx="16"
        ry="6"
        fill={color}
        stroke="#e2d0a0"
        strokeWidth="1.6"
      />
      <path
        d="M13 54q13 6 26 0"
        stroke="#e9d9af"
        fill="none"
        strokeWidth="1.4"
      />
      <circle
        cx="26"
        cy="23"
        r="17"
        fill={`url(#${prefix}-pawn)`}
        stroke="#ddc798"
        strokeWidth="2"
      />
      <circle
        cx="26"
        cy="23"
        r="12.5"
        fill="#f4e9cf"
        stroke="#927e50"
        strokeWidth="1"
      />
      <text x="26" y="29" textAnchor="middle" fill="#34413b">
        {PROFESSIONS[role].name}
      </text>
      <path
        d="M15 15q4-6 10-6"
        stroke="#fff9e8"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".8"
      />
    </svg>
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
                  <Pawn
                    role={player.role}
                    prefix={`${prefix}-${player.role}-${node}`}
                  />
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
