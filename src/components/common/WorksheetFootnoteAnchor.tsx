import React, { useRef, useState } from "react";
import type { LessonWorksheetFootnoteAnchor } from "../../lib/lessonWorksheet";

type Position = Pick<LessonWorksheetFootnoteAnchor, "leftRatio" | "topRatio">;

interface Props {
  anchor: LessonWorksheetFootnoteAnchor;
  title: string;
  selected: boolean;
  editable: boolean;
  allowContextDelete: boolean;
  onSelect?: (id: string) => void;
  onActivate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, position: Position) => void;
}

const WorksheetFootnoteAnchor: React.FC<Props> = ({
  anchor,
  title,
  selected,
  editable,
  allowContextDelete,
  onSelect,
  onActivate,
  onDelete,
  onMove,
}) => {
  const [preview, setPreview] = useState<Position | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    bounds: DOMRect;
    origin: Position;
    position: Position;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const movable = editable && Boolean(onMove);
  const clampPosition = (leftRatio: number, topRatio: number): Position => ({
    leftRatio: Math.max(0, Math.min(1 - anchor.widthRatio, leftRatio)),
    topRatio: Math.max(0, Math.min(1 - anchor.heightRatio, topRatio)),
  });
  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.moved && Math.hypot(dx, dy) < 4) return;
    session.moved = true;
    session.position = clampPosition(
      session.origin.leftRatio + dx / session.bounds.width,
      session.origin.topRatio + dy / session.bounds.height,
    );
    suppressClick.current = true;
    setPreview(session.position);
  };
  const cancelDrag = () => {
    if (drag.current) suppressClick.current = true;
    drag.current = null;
    setPreview(null);
  };
  const position = preview || anchor;
  const style: React.CSSProperties = {
    left: `${(position.leftRatio + anchor.widthRatio / 2) * 100}%`,
    top: `${(position.topRatio + anchor.heightRatio / 2) * 100}%`,
    transform: "translate(-50%, -50%)",
  };

  return (
    <>
      {selected && (
        <div
          className="pointer-events-none absolute z-[25] h-12 w-12 rounded-full border-2 border-blue-400 bg-blue-100/40 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]"
          style={style}
        />
      )}
      <button
        type="button"
        data-footnote-anchor="true"
        data-footnote-anchor-id={anchor.id}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (
            !movable ||
            event.button !== 0 ||
            !event.isPrimary ||
            drag.current
          )
            return;
          const bounds =
            event.currentTarget.parentElement?.getBoundingClientRect();
          if (!bounds?.width || !bounds.height) return;
          suppressClick.current = false;
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            bounds,
            origin: { leftRatio: anchor.leftRatio, topRatio: anchor.topRatio },
            position: {
              leftRatio: anchor.leftRatio,
              topRatio: anchor.topRatio,
            },
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          onSelect?.(anchor.id);
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          updateDrag(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          updateDrag(event);
          const session = drag.current;
          if (!session || session.pointerId !== event.pointerId) return;
          drag.current = null;
          if (session.moved) onMove?.(anchor.id, session.position);
          setPreview(null);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          if (drag.current?.pointerId === event.pointerId) cancelDrag();
        }}
        onLostPointerCapture={cancelDrag}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.detail !== 0 && suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (editable) onSelect?.(anchor.id);
          onActivate?.(anchor.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            event.stopPropagation();
            cancelDrag();
            return;
          }
          if (
            !movable ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 0.01 : 0.001;
          onSelect?.(anchor.id);
          onMove?.(
            anchor.id,
            clampPosition(
              anchor.leftRatio +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0),
              anchor.topRatio +
                (event.key === "ArrowDown"
                  ? step
                  : event.key === "ArrowUp"
                    ? -step
                    : 0),
            ),
          );
        }}
        onContextMenu={(event) => {
          if (!editable || !allowContextDelete) return;
          event.preventDefault();
          event.stopPropagation();
          onDelete?.(anchor.id);
        }}
        className={`absolute z-[31] inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm shadow-lg transition-colors ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-white/80 bg-white text-blue-700 hover:bg-blue-50"} ${movable ? "cursor-move" : ""}`}
        style={{ ...style, touchAction: movable ? "none" : undefined }}
        aria-label={`${title} 열기${movable ? ", 방향키로 위치 이동" : ""}`}
        title={title}
      >
        <i className="fas fa-comment-dots" aria-hidden="true"></i>
      </button>
    </>
  );
};

export default WorksheetFootnoteAnchor;
