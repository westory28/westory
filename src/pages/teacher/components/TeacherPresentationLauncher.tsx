import React from "react";
import {
  getTeacherPresentationClassSummaryText,
  getTeacherPresentationRuntimeBadge,
  getTeacherPresentationSelectorSummaryText,
  type TeacherPresentationClassSummary,
} from "../../../lib/teacherPresentation";

// ManageLesson is the current official teacher-present entry point.
// Any future launcher should keep the same class context contract.
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
  recentItems,
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
      ? "학급 목록 없이 마지막 사용 반으로 열 수 있습니다."
      : optionLoadState === "error"
        ? "현재 선택 반으로 바로 열 수 있습니다."
        : classLoadState === "loading"
          ? "상태 확인 중"
          : "";

  return (
    <div className="mx-auto mb-2 grid w-full max-w-[min(100vw-1.5rem,1600px)] gap-2 rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-2.5 shadow-sm lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.9fr)]">
      <div className="min-w-0 space-y-1.5">
        {!!recentItems.length && (
          <div className="grid gap-1.5 md:grid-cols-3">
            {recentItems.map((item, index) => {
              const badge = getTeacherPresentationRuntimeBadge(item);
              const isSelected = item.classId === selectedClassId;
              return (
                <div
                  key={item.classId}
                  className={`rounded-xl border px-2.5 py-2 transition ${
                    isSelected
                      ? "border-blue-300 bg-blue-50/90 ring-1 ring-blue-100"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold tracking-[0.14em] text-slate-400">
                        {index === 0 ? "최근 사용 반" : "빠른 열기"}
                      </div>
                      <div className="truncate text-sm font-bold text-slate-900">
                        {item.classLabel}
                      </div>
                    </div>
                    <div
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeToneClass(
                        badge.tone,
                      )}`}
                    >
                      <i
                        className={`${badgeIconClass(badge.tone)} text-[10px]`}
                      ></i>
                      {badge.text}
                    </div>
                  </div>
                  <div className="mt-1 line-clamp-1 text-[10px] text-slate-500">
                    {getTeacherPresentationClassSummaryText(item)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectClass(item.classId)}
                      className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition ${
                        isSelected
                          ? "bg-slate-900 text-white hover:bg-slate-800"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      <i className="fas fa-play text-[10px]"></i>
                      {isSelected ? "현재 선택" : "이 반으로 열기"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {helperMessage ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-[10px] text-slate-500">
            {helperMessage}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-[0.14em] text-slate-400">
              현재 선택 반
            </div>
            <div className="truncate text-sm font-bold text-slate-900">
              {selectedClassLabel}
            </div>
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeToneClass(
              selectedBadge.tone,
            )}`}
          >
            <i
              className={`${badgeIconClass(selectedBadge.tone)} text-[10px]`}
            ></i>
            {selectedBadge.text}
          </div>
        </div>

        <div className="mt-1 line-clamp-1 text-[10px] text-slate-500">
          {getTeacherPresentationSelectorSummaryText(selectedSummary)}
        </div>

        <label className="mt-2 flex flex-col gap-1 text-[11px] font-semibold text-slate-700">
          <span>반 바꾸기</span>
          <select
            value={selectedClassId}
            onChange={(event) => onSelectClass(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
          >
            {!classOptions.length && (
              <option value="preview-default">미리보기용 공용 상태</option>
            )}
            {classOptions.map((option) => {
              const optionBadge = getTeacherPresentationRuntimeBadge(option);
              const isRecent = recentItems.some(
                (item) => item.classId === option.classId,
              );
              return (
                <option key={option.classId} value={option.classId}>
                  {option.classLabel}
                  {isRecent ? " · 최근 사용" : ""}
                  {optionBadge.text ? ` · ${optionBadge.text}` : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>
    </div>
  );
};

export default TeacherPresentationLauncher;
