import React, { useEffect, useId, useRef, useState } from "react";
import type { PointRankDisplay } from "../../lib/pointRanks";
import PointRankBadge from "./PointRankBadge";
import "./headerStudentWis.css";

interface HeaderStudentWisProps {
  rank: PointRankDisplay | null;
  balance: number | null;
  status: "loading" | "ready" | "error";
  routeKey: string;
  onRefresh: () => void;
}

const HeaderStudentWis: React.FC<HeaderStudentWisProps> = ({
  rank,
  balance,
  status,
  routeKey,
  onRefresh,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = rank?.enabled
    ? `현재 등급 ${rank.label}, 내 위스 보기`
    : "내 위스 보기";

  useEffect(() => setOpen(false), [routeKey]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open]);

  return (
    <div
      className="header-student-wis"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="header-student-wis-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) onRefresh();
          setOpen(!open);
        }}
      >
        {rank?.enabled ? (
          <PointRankBadge rank={rank} size="sm" />
        ) : (
          <span className="header-student-wis-mark" aria-hidden="true">
            Ws
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="header-student-wis-panel"
          role="region"
          aria-label="내 위스"
        >
          <div className="header-student-wis-label">
            <span className="header-student-wis-mark" aria-hidden="true">
              Ws
            </span>
            <span>내 위스</span>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {status === "ready" && balance !== null ? (
              <p className="header-student-wis-balance">
                {balance.toLocaleString("ko-KR")}
                <span> 위스</span>
              </p>
            ) : status === "error" ? (
              <>
                <p className="header-student-wis-status">
                  위스를 불러오지 못했습니다.
                </p>
                <button
                  type="button"
                  className="header-student-wis-retry"
                  onClick={() => {
                    buttonRef.current?.focus();
                    onRefresh();
                  }}
                >
                  다시 불러오기
                </button>
              </>
            ) : (
              <p className="header-student-wis-status">불러오는 중…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeaderStudentWis;
