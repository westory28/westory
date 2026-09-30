import React, { useEffect, useState } from "react";
import type { MapResource } from "../../../lib/mapResources";
import TeacherSubNavigation from "./TeacherSubNavigation";

interface TeacherMapNavigationProps {
  heading: string;
  items: MapResource[];
  selectedId: string;
  onSelect: (id: string) => void;
  getChildItems: (item: MapResource) => MapResource[];
  selectedChildId: string;
  onSelectChild: (id: string) => void;
  action?: React.ReactNode;
  headingAction?: React.ReactNode;
  renderItemAction?: (item: MapResource) => React.ReactNode;
  reorderMode?: boolean;
}

const TeacherMapNavigation: React.FC<TeacherMapNavigationProps> = ({
  heading,
  items,
  selectedId,
  onSelect,
  getChildItems,
  selectedChildId,
  onSelectChild,
  action,
  headingAction,
  renderItemAction,
  reorderMode = false,
}) => {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => {
    setExpandedId(null);
  }, [selectedId]);
  const selectedItem = items
    .flatMap(getChildItems)
    .find((item) => item.id === selectedChildId);

  return (
    <TeacherSubNavigation
      title={heading}
      activeLabel={
        selectedItem?.title ||
        items.find((item) => item.id === selectedId)?.title ||
        "지도 선택"
      }
      open={open}
      onOpenChange={setOpen}
      actions={
        <>
          {headingAction}
          {action}
        </>
      }
    >
      {items.map((item) => (
        <div key={item.id}>
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => {
                setExpandedId(
                  (expandedId ?? selectedId) === item.id ? "" : item.id,
                );
                if (selectedId !== item.id) onSelect(item.id);
              }}
              className={`teacher-settings-section min-w-0 flex-1${selectedId === item.id ? " is-active" : ""}`}
              aria-expanded={(expandedId ?? selectedId) === item.id}
              title={item.title}
            >
              <i
                className={`fas ${reorderMode ? "fa-grip-lines" : "fa-map"} shrink-0`}
                aria-hidden="true"
              />
              <span className="teacher-navigation-label">{item.title}</span>
              <i
                className={`fas fa-chevron-${(expandedId ?? selectedId) === item.id ? "down" : "right"} ml-auto text-xs`}
                aria-hidden="true"
              />
            </button>
            {renderItemAction && (
              <div className="shrink-0 pr-2">{renderItemAction(item)}</div>
            )}
          </div>
          {(expandedId ?? selectedId) === item.id && (
            <div
              className="ml-4 border-l border-gray-200 pl-2"
              role="group"
              aria-label={`${item.title} 세부 지도`}
            >
              {getChildItems(item).map((child) => (
                <button
                  key={child.id}
                  type="button"
                  title={child.title}
                  className={`teacher-settings-section${selectedChildId === child.id ? " is-active" : ""}`}
                  aria-current={
                    selectedChildId === child.id ? "page" : undefined
                  }
                  onClick={() => {
                    onSelectChild(child.id);
                    setOpen(false);
                  }}
                >
                  <span className="teacher-navigation-label">
                    {child.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </TeacherSubNavigation>
  );
};

export default TeacherMapNavigation;
