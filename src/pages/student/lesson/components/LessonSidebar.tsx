import React, { useState } from "react";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";
import type { StudentCurriculumTreeItem } from "../../../../lib/studentLessonReadCache";

interface LessonSidebarProps {
  tree: StudentCurriculumTreeItem[];
  status: React.ReactNode;
  firstGroupRef: React.Ref<HTMLButtonElement>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUnitTitle?: string | null;
  onSelectUnit: (unitId: string, title: string) => void;
  selectedUnitId: string | null;
}

const shouldShowUnitTitleHint = (title?: string) =>
  String(title || "").trim().length > 18;

const LessonSidebar: React.FC<LessonSidebarProps> = ({
  tree,
  status,
  firstGroupRef,
  isOpen,
  onOpenChange,
  selectedUnitTitle,
  onSelectUnit,
  selectedUnitId,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const toggleGroup = (key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [revealedUnitId, setRevealedUnitId] = useState<string | null>(null);

  return (
    <PortalSubNavigation
      title="수업 목차"
      activeLabel={selectedUnitTitle || "학습할 단원 선택"}
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      {status}
      {tree.map((big, bigIdx) => (
        <section key={big.id || bigIdx} className="student-curriculum-group">
          <h3 className="student-curriculum-major">
            <button
              type="button"
              ref={bigIdx === 0 ? firstGroupRef : undefined}
              className="student-curriculum-toggle"
              aria-expanded={!collapsedGroups.has(`big-${bigIdx}`)}
              onClick={() => toggleGroup(`big-${bigIdx}`)}
            >
              {big.title}
            </button>
          </h3>
          <div
            className="student-curriculum-middle-list"
            hidden={collapsedGroups.has(`big-${bigIdx}`)}
          >
            {(big.children || []).map((mid, midIdx) => (
              <div key={mid.id || midIdx}>
                <h4 className="student-curriculum-middle">
                  <button
                    type="button"
                    className="student-curriculum-toggle"
                    aria-expanded={
                      !collapsedGroups.has(`mid-${bigIdx}-${midIdx}`)
                    }
                    onClick={() => toggleGroup(`mid-${bigIdx}-${midIdx}`)}
                  >
                    <span>{mid.title}</span>
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      className={
                        collapsedGroups.has(`mid-${bigIdx}-${midIdx}`)
                          ? "-rotate-90 shrink-0"
                          : "shrink-0"
                      }
                    >
                      <path
                        d="m4 6 4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </h4>
                <div
                  className="student-curriculum-unit-list"
                  hidden={collapsedGroups.has(`mid-${bigIdx}-${midIdx}`)}
                >
                  {(mid.children || []).map((small, smallIdx) => {
                    const unitKey =
                      small.id || `${bigIdx}-${midIdx}-${smallIdx}`;
                    const showTitleHint = shouldShowUnitTitleHint(small.title);
                    return (
                      <button
                        key={unitKey}
                        type="button"
                        title={small.title}
                        aria-label={small.title}
                        aria-current={
                          selectedUnitId === small.id ? "page" : undefined
                        }
                        onClick={() => {
                          setRevealedUnitId(unitKey);
                          onSelectUnit(small.id, small.title);
                          onOpenChange(false);
                        }}
                        onBlur={() => {
                          if (revealedUnitId === unitKey)
                            setRevealedUnitId(null);
                        }}
                        className={`teacher-settings-section group relative ${selectedUnitId === small.id ? "is-active" : ""}`}
                      >
                        <span className="min-w-0 flex-1 break-words">
                          {small.title}
                        </span>
                        {showTitleHint && (
                          <span
                            className={`pointer-events-none absolute left-8 right-2 top-full z-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold leading-5 text-slate-700 shadow-lg ${revealedUnitId === unitKey ? "block" : "hidden group-hover:block group-focus-visible:block"}`}
                          >
                            {small.title}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </PortalSubNavigation>
  );
};

export default LessonSidebar;
