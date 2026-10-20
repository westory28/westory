import React from "react";
import { type TeacherPresentationClassSummary } from "../../../lib/teacherPresentation";

export type TeacherPresentationLauncherProps = {
  recentItems: TeacherPresentationClassSummary[];
  selectedSummary: TeacherPresentationClassSummary | null;
  selectedClassId: string;
  selectedClassLabel: string;
  classOptions: TeacherPresentationClassSummary[];
  optionLoadState: "idle" | "loading" | "ready" | "error";
  classLoadState: "idle" | "loading" | "ready" | "error";
  cachedSummary: TeacherPresentationClassSummary | null;
  onSelectClass: (classId: string) => void;
};

const TeacherPresentationLauncher: React.FC<
  TeacherPresentationLauncherProps
> = ({
  selectedSummary,
  selectedClassId,
  selectedClassLabel,
  classOptions,
  optionLoadState,
  cachedSummary,
  onSelectClass,
}) => {
  const selectedClassNumber =
    selectedSummary?.className || selectedClassId.split("-")[1] || "";
  const helperMessage =
    optionLoadState === "error" && cachedSummary
      ? "반 목록을 모두 불러오지 못해 마지막으로 사용한 반만 표시하고 있습니다."
      : optionLoadState === "error"
        ? "반 목록을 불러오지 못했습니다."
        : "";

  return (
    <div className="mx-auto mb-2 w-full max-w-[min(100vw-1.5rem,1600px)] rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold tracking-[0.14em] text-slate-400">
            현재 선택 반
          </div>
          <div className="mt-1 truncate text-base font-bold text-slate-900">
            {selectedClassNumber
              ? `3학년 ${selectedClassNumber}반`
              : selectedClassLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 text-sm font-semibold text-slate-700">
        <span>반 선택</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-10 min-w-[84px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700">
            3학년
          </div>
          <select
            value={selectedClassId}
            onChange={(event) => onSelectClass(event.target.value)}
            className="h-10 w-full max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
          >
            {!classOptions.length && (
              <option value="preview-default">반 선택</option>
            )}
            {classOptions.map((option) => {
              const optionLabel = option.className
                ? `${option.className}반`
                : option.classLabel;
              return (
                <option key={option.classId} value={option.classId}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {helperMessage ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
          {helperMessage}
        </div>
      ) : null}
    </div>
  );
};

export default TeacherPresentationLauncher;
