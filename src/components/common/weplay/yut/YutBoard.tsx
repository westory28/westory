import React, {
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { YutMove, YutNode, YutRoom, YutRole } from "../../../../lib/yut";
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
      </defs>
      {/* Only the raised rim casts a shadow. The middle is deliberately open. */}
      <g className="yut-board-rim">
        <path
          d="M12 255 360 14 708 255 708 278 360 520 12 278Z M132 255 360 98 588 255 360 412Z"
          fillRule="evenodd"
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
        <path
          d="M12 255 360 14 708 255 360 495Z M132 255 360 98 588 255 360 412Z"
          fillRule="evenodd"
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
      </g>
      <g className="yut-board-crossing" fill="none">
        <path d="M143 255H577M360 109V402" stroke="#392d1ddd" strokeWidth="7" />
        <path d="M143 255H577M360 109V402" stroke="#d6bd7c" strokeWidth="3" />
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
    </svg>
  );
}

type PieceMotion = {
  id: string;
  origin: YutNode;
  path: YutNode[];
  kind: "land" | "capture" | "win" | "caught";
  travelMs: number;
};
const nodePosition = (node: YutNode): [number, number] =>
  positions[node === "home" ? "o20" : node] || positions.center;
const directionArrow = (origin: YutNode, target: YutNode) => {
  const start = nodePosition(origin),
    end = nodePosition(target);
  const dx = end[0] - start[0],
    dy = end[1] - start[1];
  if (Math.abs(dx) < 8) return dy < 0 ? "↑" : "↓";
  if (Math.abs(dy) < 8) return dx < 0 ? "←" : "→";
  return dy < 0 ? (dx < 0 ? "↖" : "↗") : dx < 0 ? "↙" : "↘";
};

function MovingPawn({
  role,
  node,
  name,
  selected,
  selectable,
  motion,
  onSelect,
  onMotionComplete,
}: {
  role: YutRole;
  node: YutNode;
  name: string;
  selected: boolean;
  selectable: boolean;
  motion?: PieceMotion;
  onSelect: () => void;
  onMotionComplete: (id: string) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const complete = useRef(onMotionComplete);
  complete.current = onMotionComplete;
  useLayoutEffect(() => {
    const element = button.current;
    if (!motion || !element) return;
    let finishedTimer: number | undefined;
    if (motion.kind === "caught") {
      finishedTimer = window.setTimeout(
        () => complete.current(motion.id),
        motion.travelMs + 300,
      );
      return () => window.clearTimeout(finishedTimer);
    }
    // Tile traversal is game feedback. Reduced motion removes tilt and squash,
    // while retaining each landing so the player can follow the chosen route.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const nodes = [motion.origin, ...motion.path];
    const steps = nodes.length - 1;
    if (!steps) return;
    let active = true;
    let animation: Animation | undefined;
    let landingFrame = 0;
    const hop = async () => {
      try {
        for (let index = 0; index < steps && active; index++) {
          const current = nodePosition(nodes[index]),
            next = nodePosition(nodes[index + 1]);
          const tilt = reduced ? 0 : next[0] >= current[0] ? 5 : -5;
          const previousAnimation = animation;
          animation = element.animate(
            [
              {
                ...pointStyle(current),
                offset: 0,
                transform: "translate(-50%, -88%)",
              },
              {
                ...pointStyle([
                  (current[0] + next[0]) / 2,
                  (current[1] + next[1]) / 2,
                ]),
                offset: 0.4,
                transform: `translate(-50%, -88%) translateY(-${reduced ? 7 : 16}px) rotate(${tilt}deg)`,
              },
              {
                ...pointStyle(next),
                offset: 0.78,
                transform: reduced
                  ? "translate(-50%, -88%)"
                  : "translate(-50%, -88%) scale(1.04,.96)",
              },
              {
                ...pointStyle(next),
                offset: 1,
                transform: "translate(-50%, -88%)",
              },
            ],
            {
              duration: motion.travelMs / steps,
              easing: "linear",
              fill: "both",
            },
          );
          previousAnimation?.cancel();
          await animation.finished;
          // A painted landing separates every hop, including under busy React
          // renders. One long timeline can jump over a tile on a dropped frame.
          await new Promise<void>((resolve) => {
            landingFrame = requestAnimationFrame(() => resolve());
          });
        }
        if (active)
          finishedTimer = window.setTimeout(
            () => complete.current(motion.id),
            300,
          );
      } catch {
        /* Replaced moves and unmount cancel their own animation. */
      }
    };
    void hop();
    return () => {
      active = false;
      cancelAnimationFrame(landingFrame);
      window.clearTimeout(finishedTimer);
      animation?.cancel();
    };
    // The stable event ID survives clock ticks and new room object identities.
  }, [motion?.id]);
  if ((node === "home" || node === "finish") && !motion) return null;
  return (
    <button
      ref={button}
      type="button"
      className={`yut-board-piece yut-isometric-piece${selected ? " is-selected" : ""}${motion ? ` is-moving is-${motion.kind}` : ""}`}
      style={
        {
          ...pointStyle(
            nodePosition(motion?.kind === "caught" ? motion.origin : node),
          ),
          "--piece-color": PROFESSIONS[role].color,
          "--reaction-delay": `${motion?.travelMs || 0}ms`,
        } as React.CSSProperties
      }
      disabled={!selectable || Boolean(motion)}
      aria-pressed={selectable ? selected : undefined}
      aria-label={`${name} ${PROFESSIONS[role].clan}, ${yutNodeLabel(node)}${selectable ? ", 선택" : ""}`}
      onClick={onSelect}
      data-motion={motion?.kind || "idle"}
      data-motion-id={motion?.id}
      data-pawn-node={node}
    >
      <span className="yut-isometric-pawn" aria-hidden="true">
        <i className="yut-pawn-foot-shadow" />
        <span className="yut-pawn-body">
          <YutSprite role={role} />
        </span>
        {motion && (
          <span className="yut-pawn-expression">
            {motion.kind === "win"
              ? "✦"
              : motion.kind === "capture"
                ? "!"
                : motion.kind === "caught"
                  ? "!"
                  : "♪"}
          </span>
        )}
      </span>
    </button>
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
  selectedMove = null,
  onMotionChange,
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
  selectedMove?: YutMove | null;
  onMotionChange?: (moving: boolean) => void;
}) {
  const prefix = `yut-board-${useId().replace(/:/g, "")}`;
  const previous = useRef(room);
  const callback = useRef(onMotionChange);
  callback.current = onMotionChange;
  const [motions, setMotions] = useState<Record<string, PieceMotion>>({});
  const motionTimer = useRef<number | undefined>(undefined);
  const activeMotions = useRef(new Set<string>());
  const completeMotion = useCallback((id: string) => {
    if (!activeMotions.current.delete(id) || activeMotions.current.size) return;
    window.clearTimeout(motionTimer.current);
    setMotions({});
    callback.current?.(false);
  }, []);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = room;
    if (
      before.id !== room.id ||
      room.status === "waiting" ||
      room.status === "closed"
    ) {
      window.clearTimeout(motionTimer.current);
      activeMotions.current.clear();
      setMotions({});
      callback.current?.(false);
      return;
    }
    const next: Record<string, PieceMotion> = {};
    if (
      before.id === room.id &&
      before.revision !== room.revision &&
      !document.hidden
    ) {
      const eventMove = room.lastEvent?.move;
      for (const player of room.players.filter((entry) => entry.active)) {
        for (const piece of player.pieces) {
          const old = before.players
            .find((entry) => entry.uid === player.uid)
            ?.pieces.find((entry) => entry.id === piece.id);
          if (!old || old.node === piece.node) continue;
          const caught = piece.node === "home";
          const path =
            !caught && eventMove?.uid === player.uid && eventMove.path?.length
              ? eventMove.path
              : [piece.node];
          next[`${player.uid}-${piece.id}`] = {
            id: `${room.id}:${room.revision}:${player.uid}:${piece.id}`,
            origin: old.node,
            path,
            kind: caught
              ? "caught"
              : piece.node === "finish"
                ? "win"
                : room.lastEvent.kind === "capture"
                  ? "capture"
                  : "land",
            travelMs: Math.min(
              1100,
              Math.max(
                220,
                (caught ? eventMove?.path?.length || 1 : path.length) * 220,
              ),
            ),
          };
        }
      }
    }
    const active = Object.values(next);
    // Non-movement snapshots (for example an opponent leaving) must not cancel
    // a move already on screen. Only a new move or leaving the board replaces it.
    if (!active.length) return;
    window.clearTimeout(motionTimer.current);
    activeMotions.current = new Set(active.map((motion) => motion.id));
    setMotions(next);
    callback.current?.(true);
    motionTimer.current = window.setTimeout(
      () => {
        activeMotions.current.clear();
        setMotions({});
        callback.current?.(false);
      },
      // Finish from the actual animation, not wall-clock time before its first
      // rendered frame. This bounded fallback only handles suspended animations.
      6000,
    );
  }, [room.id, room.revision]);
  useEffect(
    () => () => {
      window.clearTimeout(motionTimer.current);
      callback.current?.(false);
    },
    [],
  );
  const destinations = revealMoves
    ? moves.filter((move) => move.pieceId === selectedPiece)
    : [];
  const piece = room.players
    .find((player) => player.uid === uid)
    ?.pieces.find((item) => item.id === selectedPiece);
  const previewPath =
    selectedMove && revealMoves && piece
      ? [
          piece.node,
          ...(selectedMove.path?.length
            ? selectedMove.path
            : [selectedMove.targetNode]),
        ]
      : [];
  return (
    <div className="yut-isometric-board-wrap">
      <div
        className="yut-board yut-isometric-board"
        role="group"
        aria-label="윷판"
      >
        <BoardSurface prefix={prefix} />
        {previewPath.length > 1 && (
          <svg
            className="yut-route-preview"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              className="yut-route-glow"
              points={previewPath
                .map((node) => nodePosition(node).join(","))
                .join(" ")}
            />
            <polyline
              className="yut-route-line"
              points={previewPath
                .map((node) => nodePosition(node).join(","))
                .join(" ")}
            />
            {previewPath.slice(1).map((node, i) => (
              <ellipse
                key={i}
                cx={nodePosition(node)[0]}
                cy={nodePosition(node)[1]}
                rx="24"
                ry="16"
              />
            ))}
          </svg>
        )}
        {children && <div className="yut-board-center-overlay">{children}</div>}
        {room.players
          .filter((player) => player.active)
          .flatMap((player) =>
            player.pieces.map((item) => (
              <MovingPawn
                key={`${player.uid}-${item.id}`}
                role={player.role}
                node={item.node}
                name={player.name}
                selected={player.uid === uid && item.id === selectedPiece}
                selectable={
                  !disabled &&
                  revealMoves &&
                  player.uid === uid &&
                  moves.some((move) => move.pieceId === item.id)
                }
                motion={motions[`${player.uid}-${item.id}`]}
                onSelect={() => onSelectPiece(item.id)}
                onMotionComplete={completeMotion}
              />
            )),
          )}
        {destinations.map((move) => (
          <button
            key={`${move.route}-${move.targetNode}`}
            type="button"
            className={`yut-destination yut-isometric-destination${selectedMove?.route === move.route ? " is-previewed" : ""}`}
            style={pointStyle(nodePosition(move.targetNode))}
            disabled={disabled}
            onClick={() => onMove(move)}
            aria-pressed={selectedMove?.route === move.route}
            aria-label={`${move.route === "outer" ? "바깥길" : "지름길"}, ${yutNodeLabel(move.targetNode)} 경로 선택`}
          >
            <span
              className="yut-isometric-destination-symbol"
              aria-hidden="true"
            >
              {directionArrow(
                piece?.node || "home",
                move.path?.[0] || move.targetNode,
              )}
            </span>
            <span className="yut-isometric-destination-label">
              {move.route === "outer" ? "바깥길" : "지름길"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
