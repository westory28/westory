import React from "react";
import {
  getTeacherPresentationRuntimeBadge,
  getTeacherPresentationSelectorSummaryText,
  type TeacherPresentationClassSummary,
} from "../../../lib/teacherPresentation";

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

const badgeToneClass = (tone: "rose" | "amber" | "blue" | "slate") => {
  if (tone === "rose") return "bg-rose-100 text-rose-700";
  if (tone === "amber") return "bg-amber-100 text-amber-700";
  if (tone === "blue") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
};

const badgeIconClass = (tone: "rose" | "amber" | "blue" | "slate") => {
  if (tone === "rose") return "fas fa-triangle-exclamation";
  if (tone === "amber") return "fas fa-pen";
  if (tone === "blue") return "fas fa-check";
  return "fas fa-clock";
};

const TeacherPresentationLauncher: React.FC<
  TeacherPresentationLauncherProps
> = ({
  selectedSummary,
  selectedClassId,
  selectedClassLabel,
  classOptions,
  optionLoadState,
  classLoadState,
  cachedSummary,
  onSelectClass,
}) => {
  const selectedBadge = getTeacherPresentationRuntimeBadge(selectedSummary);
  const helperMessage =
    optionLoadState === "error" && cachedSummary
      ? "반 목록을 모두 불러오지 못해 마지막으로 사용한 반만 표시하고 있습니다."
      : optionLoadState === "error"
        ? "반 목록을 불러오지 못했습니다."
        : classLoadState === "loading"
          ? "저장 상태를 확인하는 중입니다."
          : "";

  return (
    <div className="mx-auto mb-2 w-full max-w-[min(100vw-1.5rem,1600px)] rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold tracking-[0.14em] text-slate-400">
            현재 선택 반
          </div>
          <div className="mt-1 truncate text-base font-bold text-slate-900">
            {selectedClassLabel}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${badgeToneClass(
                selectedBadge.tone,
              )}`}
            >
              <i
                className={`${badgeIconClass(selectedBadge.tone)} text-[10px]`}
              ></i>
              {selectedBadge.text}
            </div>
            <div className="text-xs text-slate-500">
              {getTeacherPresentationSelectorSummaryText(selectedSummary)}
            </div>
          </div>
        </div>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-slate-700">
        <span>반 선택</span>
        <select
          value={selectedClassId}
          onChange={(event) => onSelectClass(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
        >
          {!classOptions.length && (
            <option value="preview-default">미리보기용 공용 상태</option>
          )}
          {classOptions.map((option) => {
            const optionBadge = getTeacherPresentationRuntimeBadge(option);
            return (
              <option key={option.classId} value={option.classId}>
                {option.classLabel}
                {optionBadge.text ? ` · ${optionBadge.text}` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {helperMessage ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
          {helperMessage}
        </div>
      ) : null}
    </div>
  );
};

export default TeacherPresentationLauncher;
