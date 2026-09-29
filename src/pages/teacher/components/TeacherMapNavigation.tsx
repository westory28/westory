import React, { useState } from "react";
import type { MapResource } from "../../../lib/mapResources";
import TeacherSubNavigation from "./TeacherSubNavigation";

interface TeacherMapNavigationProps {
  heading: string;
  items: MapResource[];
  selectedId: string;
  onSelect: (id: string) => void;
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
  action,
  headingAction,
  renderItemAction,
  reorderMode = false,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <TeacherSubNavigation
      title={heading}
      activeLabel={
        items.find((item) => item.id === selectedId)?.title || "지도 선택"
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
        <div key={item.id} className="flex min-w-0 items-center">
          <button
            type="button"
            onClick={() => {
              onSelect(item.id);
              setOpen(false);
            }}
            className={`teacher-settings-section min-w-0 flex-1${selectedId === item.id ? " is-active" : ""}`}
            aria-current={selectedId === item.id ? "page" : undefined}
            title={item.title}
          >
            <i
              className={`fas ${reorderMode ? "fa-grip-lines" : "fa-map"} shrink-0`}
              aria-hidden="true"
            />
            <span className="teacher-navigation-label">{item.title}</span>
          </button>
          {renderItemAction && (
            <div className="shrink-0 pr-2">{renderItemAction(item)}</div>
          )}
        </div>
      ))}
    </TeacherSubNavigation>
  );
};

export default TeacherMapNavigation;
