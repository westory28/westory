import React, { useEffect, useState } from "react";
import { InlineLoading } from "../../../../components/common/LoadingState";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  readStudentCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../../lib/studentLessonReadCache";

interface LessonSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUnit: (unitId: string, title: string) => void;
  selectedUnitId: string | null;
}

type TreeItem = StudentCurriculumTreeItem;

const shouldShowUnitTitleHint = (title?: string) =>
  String(title || "").trim().length > 18;

const LessonSidebar: React.FC<LessonSidebarProps> = ({
  isOpen,
  onClose,
  onSelectUnit,
  selectedUnitId,
}) => {
  const { config } = useAuth();
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    new Set([0]),
  ); // Default open first group
  const [revealedUnitId, setRevealedUnitId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTree = async () => {
      try {
        setTree(await readStudentCurriculumTree(config));
      } catch (error) {
        console.error("Error fetching curriculum:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTree();
  }, [config]);

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
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
        ></div>
      )}

      <aside
        className={`
                    fixed inset-y-0 left-auto right-0 z-40
                    w-[86%] max-w-[360px]
                    bg-white border-l border-gray-200 shadow-xl
                    transform transition-transform duration-300 ease-in-out
                    flex flex-col
                    mt-16
                    ${isOpen ? "translate-x-0" : "translate-x-full"}
                    lg:sticky lg:top-[88px] lg:mt-0 lg:max-h-[calc(100vh-112px)] lg:w-[360px] lg:max-w-none lg:translate-x-0 lg:self-start lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm xl:w-[384px]
                `}
        style={{ right: 0, left: "auto" }}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-4 lg:rounded-t-2xl">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800">
              <i className="fas fa-sitemap text-blue-500"></i>
              <span>수업 목차</span>
            </h2>
            <p className="mt-0.5 text-xs font-medium text-gray-500">
              단원별 수업 자료를 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="수업 목차 닫기"
            className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="custom-scroll flex-1 overflow-y-auto p-3">
          {loading && (
            <InlineLoading message="목차를 불러오는 중입니다." showWarning />
          )}
          {!loading && tree.length === 0 && (
            <div className="p-4 text-center text-gray-400 text-sm">
              등록된 목차가 없습니다.
            </div>
          )}

          {tree.map((big, bigIdx) => (
            <div key={bigIdx} className="mb-2 select-none">
              <button
                type="button"
                aria-expanded={expandedGroups.has(bigIdx)}
                onClick={() => toggleGroup(bigIdx)}
                className={`
                                    flex w-full items-start rounded-lg p-2 text-left transition
                                    text-sm font-bold text-gray-700 hover:bg-gray-50
                                    ${expandedGroups.has(bigIdx) ? "bg-blue-50 text-blue-700" : ""}
                                `}
              >
                <i
                  className={`fas fa-caret-right mt-1 w-5 shrink-0 text-center text-xs text-gray-400 transition-transform ${expandedGroups.has(bigIdx) ? "rotate-90 text-blue-500" : ""}`}
                ></i>
                <i
                  className={`fas ${expandedGroups.has(bigIdx) ? "fa-folder-open" : "fa-folder"} mr-2 mt-0.5 shrink-0 text-yellow-500`}
                ></i>
                <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">
                  {big.title}
                </span>
              </button>

              {expandedGroups.has(bigIdx) && (
                <div className="ml-4 mt-1 border-l-2 border-gray-100 pl-4">
                  {(big.children || []).map((mid, midIdx) => (
                    <div key={midIdx} className="mb-2">
                      <div className="flex items-start px-2 py-1 text-sm font-bold text-gray-700">
                        <i className="fas fa-folder mr-2 mt-0.5 shrink-0 text-yellow-500"></i>
                        <span className="min-w-0 whitespace-normal break-words leading-5">
                          {mid.title}
                        </span>
                      </div>
                      {(mid.children || []).map((small, smallIdx) => {
                        const unitKey =
                          small.id || `${bigIdx}-${midIdx}-${smallIdx}`;
                        const showTitleHint = shouldShowUnitTitleHint(
                          small.title,
                        );

                        return (
                          <button
                            type="button"
                            key={unitKey}
                            title={small.title}
                            aria-label={small.title}
                            onClick={() => {
                              setRevealedUnitId(unitKey);
                              onSelectUnit(small.id, small.title);
                              if (window.innerWidth < 1024) onClose();
                            }}
                            onBlur={() => {
                              if (revealedUnitId === unitKey) {
                                setRevealedUnitId(null);
                              }
                            }}
                            className={`
                                                        group relative mb-0.5 flex w-full items-start rounded-md px-2 py-2 text-left transition
                                                        text-[0.9rem] no-underline
                                                        ${
                                                          selectedUnitId ===
                                                          small.id
                                                            ? "bg-blue-50 font-bold text-blue-600"
                                                            : "text-gray-600 hover:bg-blue-50 hover:text-blue-600"
                                                        }
                                                    `}
                          >
                            <i
                              className={`far fa-file-alt mr-2 mt-0.5 shrink-0 text-sm ${selectedUnitId === small.id ? "text-blue-500" : "text-gray-400"}`}
                            ></i>
                            <span className="min-w-0 flex-1 truncate leading-5">
                              {small.title}
                            </span>
                            {showTitleHint && (
                              <span
                                className={`pointer-events-none absolute left-8 right-2 top-[calc(100%-2px)] z-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold leading-5 text-slate-700 shadow-lg ${
                                  revealedUnitId === unitKey
                                    ? "block"
                                    : "hidden group-hover:block group-focus-visible:block"
                                }`}
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
        </div>
      </aside>
    </>
  );
};

export default LessonSidebar;
