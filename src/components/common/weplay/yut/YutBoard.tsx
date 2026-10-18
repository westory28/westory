import React from "react";
import type { YutMove, YutNode, YutRoom } from "../../../../lib/yut";
import { PROFESSIONS, YutSprite } from "./YutArt";

const positions: Record<string, [number, number]> = {};
for (let step = 1; step <= 5; step++) {
  positions[`o${step}`] = [88, 88 - step * 15.2];
  positions[`o${step + 5}`] = [88 - step * 15.2, 12];
  positions[`o${step + 10}`] = [12, 12 + step * 15.2];
  positions[`o${step + 15}`] = [12 + step * 15.2, 88];
}
Object.assign(positions, {
  a1: [75.33, 24.67],
  a2: [62.67, 37.33],
  center: [50, 50],
  a4: [37.33, 62.67],
  a5: [24.67, 75.33],
  b1: [24.67, 24.67],
  b2: [37.33, 37.33],
  b4: [62.67, 62.67],
  b5: [75.33, 75.33],
  finish: [91, 96],
});

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

export default function YutBoard({
  room,
  uid,
  selectedPiece,
  onSelectPiece,
  moves,
  onMove,
  disabled,
}: {
  room: YutRoom;
  uid: string;
  selectedPiece: string;
  onSelectPiece: (id: string) => void;
  moves: YutMove[];
  onMove: (move: YutMove) => void;
  disabled: boolean;
}) {
  const destinations = moves.filter((move) => move.pieceId === selectedPiece);
  return (
    <div className="yut-board-wrap">
      <div className="yut-board" aria-label="윷판">
        <svg
          viewBox="0 0 100 100"
          className="yut-board-lines"
          aria-hidden="true"
        >
          <path
            d="M5 15V5h10M85 5h10v10M95 85v10H85M15 95H5V85"
            fill="none"
            stroke="#957c55"
            strokeWidth=".6"
          />
          <path
            d="M12 12H88V88H12ZM12 12L88 88M88 12L12 88"
            fill="none"
            stroke="#9e8964"
            strokeWidth=".7"
          />
          {Object.entries(positions)
            .filter(([key]) => key !== "finish")
            .map(([key, [x, y]]) => (
              <g key={key}>
                <circle
                  cx={x}
                  cy={y}
                  r={
                    key === "center" ||
                    ["o5", "o10", "o15", "o20"].includes(key)
                      ? 3.5
                      : 2.2
                  }
                  fill="#ead9ad"
                  stroke="#927954"
                  strokeWidth=".65"
                />
                {["o5", "o10", "o15", "o20", "center"].includes(key) && (
                  <circle
                    cx={x}
                    cy={y}
                    r="2.1"
                    fill="none"
                    stroke="#bda67c"
                    strokeWidth=".45"
                  />
                )}
              </g>
            ))}
          <path d="M45 19h10M45 81h10" stroke="#bda67c" strokeWidth=".5" />
        </svg>
        <span className="yut-board-word yut-board-word--top">달빛 윷판</span>
        <span className="yut-board-word yut-board-word--bottom">
          출발 · 도착 ↗
        </span>
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
              const [x, y] = positions[node] || [50, 50];
              const selectable =
                player.uid === uid &&
                moves.some((move) =>
                  pieces.some((piece) => piece.id === move.pieceId),
                );
              return (
                <button
                  type="button"
                  key={`${player.uid}-${node}`}
                  className={`yut-board-piece ${pieces.some((piece) => piece.id === selectedPiece) && player.uid === uid ? "is-selected" : ""}`}
                  style={
                    {
                      left: `${x}%`,
                      top: `${y}%`,
                      "--piece-color": PROFESSIONS[player.role].color,
                    } as React.CSSProperties
                  }
                  onClick={() => onSelectPiece(pieces[0].id)}
                  disabled={disabled || !selectable}
                  aria-label={`${player.name} ${PROFESSIONS[player.role].job}, 말 ${pieces.map((piece) => piece.id).join("·")}, ${yutNodeLabel(node)}${selectable ? ", 선택" : ""}`}
                >
                  <YutSprite role={player.role} />
                  <span>
                    {PROFESSIONS[player.role].name}
                    {pieces.length === 2 ? "×2" : pieces[0].id}
                  </span>
                </button>
              );
            });
          })}
        {destinations.map((move) => {
          const [x, y] = positions[move.targetNode] || [88, 88];
          return (
            <button
              key={move.route}
              type="button"
              className="yut-destination"
              style={{ left: `${x}%`, top: `${y}%` }}
              disabled={disabled}
              onClick={() => onMove(move)}
              aria-label={`말 ${move.pieceId}, ${move.route === "outer" ? "바깥길" : "지름길"}, ${yutNodeLabel(move.targetNode)}로 이동`}
            >
              <span>여기</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
