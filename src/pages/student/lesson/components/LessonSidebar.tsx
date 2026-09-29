import React, { useEffect, useRef, useState } from "react";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";
import TeacherNavigationIcon from "../../../../components/layout/TeacherNavigationIcon";
import { InlineLoading } from "../../../../components/common/LoadingState";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  readStudentLatestLessonSelection,
  readStudentVisibleCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../../lib/studentLessonReadCache";

interface LessonSidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedUnitTitle?: string | null;
  onSelectUnit: (unitId: string, title: string) => void;
  selectedUnitId: string | null;
}

type TreeItem = StudentCurriculumTreeItem;

const shouldShowUnitTitleHint = (title?: string) =>
  String(title || "").trim().length > 18;

const findTopLevelIndexByUnitId = (
  tree: TreeItem[],
  unitId?: string | null,
) => {
  const targetUnitId = String(unitId || "").trim();
  if (!targetUnitId) return -1;

  const containsUnit = (item: TreeItem): boolean =>
    item.id === targetUnitId || (item.children || []).some(containsUnit);

  return tree.findIndex(containsUnit);
};

const LessonSidebar: React.FC<LessonSidebarProps> = ({
  isOpen,
  onOpenChange,
  selectedUnitTitle,
  onSelectUnit,
  selectedUnitId,
}) => {
  const { config } = useAuth();
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [revealedUnitId, setRevealedUnitId] = useState<string | null>(null);
  const selectedUnitIdRef = useRef(selectedUnitId);
  useEffect(() => {
    selectedUnitIdRef.current = selectedUnitId;
  }, [selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId) return;
    const topLevelIndex = findTopLevelIndexByUnitId(tree, selectedUnitId);
    if (topLevelIndex < 0) return;
    setExpandedGroups((prev) => new Set(prev).add(topLevelIndex));
  }, [selectedUnitId, tree]);

  useEffect(() => {
    let cancelled = false;
    const fetchTree = async () => {
      setLoading(true);
      try {
        const nextTree = await readStudentVisibleCurriculumTree(config);
        if (cancelled) return;
        setTree(nextTree);
        if (selectedUnitIdRef.current) return;

        const latestSelection = await readStudentLatestLessonSelection(
          config,
          nextTree,
        );
        if (cancelled || selectedUnitIdRef.current || !latestSelection) return;

        const topLevelIndex = findTopLevelIndexByUnitId(
          nextTree,
          latestSelection.node.id,
        );
        if (topLevelIndex >= 0) {
          setExpandedGroups(new Set([topLevelIndex]));
        }
        onSelectUnit(latestSelection.node.id, latestSelection.node.title);
      } catch (error) {
        console.error("Error fetching curriculum:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTree();
    return () => {
      cancelled = true;
    };
  }, [config, onSelectUnit]);

  const toggleGroup = (index: number) => {
    const newSet = new Set(expandedGroups);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setRevealedUnitId(null);
    setExpandedGroups(newSet);
  };

  return (
    <PortalSubNavigation
      title="수업 목차"
      activeLabel={selectedUnitTitle || "학습할 단원 선택"}
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      {loading && (
        <InlineLoading message="목차를 불러오는 중입니다." showWarning />
      )}
      {!loading && tree.length === 0 && (
        <div className="px-6 py-4 text-sm text-gray-500">
          공개된 수업 자료가 없습니다.
        </div>
      )}
      {tree.map((big, bigIdx) => (
        <div key={big.id || bigIdx}>
          <button
            type="button"
            title={big.title}
            aria-expanded={expandedGroups.has(bigIdx)}
            onClick={() => toggleGroup(bigIdx)}
            className="teacher-settings-section"
          >
            <TeacherNavigationIcon
              name="chevron"
              className={expandedGroups.has(bigIdx) ? "rotate-180" : ""}
            />
            <span className="min-w-0 break-words">{big.title}</span>
          </button>
          {expandedGroups.has(bigIdx) && (
            <div className="teacher-sub-tree-children">
              {(big.children || []).map((mid, midIdx) => (
                <div key={mid.id || midIdx}>
                  <div
                    title={mid.title}
                    className="teacher-navigation-label px-6 py-3 text-sm font-bold text-gray-700"
                  >
                    {mid.title}
                  </div>
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
                        <TeacherNavigationIcon name="lesson" />
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
              ))}
            </div>
          )}
        </div>
      ))}
    </PortalSubNavigation>
  );
};

export default LessonSidebar;
