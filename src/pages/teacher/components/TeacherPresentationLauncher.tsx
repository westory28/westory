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
      ? "학급 목록을 못 불러왔지만 마지막 사용 반 기준으로 이어서 열 수 있습니다."
      : optionLoadState === "error"
        ? "학급 목록을 못 불러와도 현재 선택 반으로는 바로 열 수 있습니다."
        : classLoadState === "loading"
          ? "마지막 상태를 확인하는 중입니다."
          : selectedSummary
            ? getTeacherPresentationSelectorSummaryText(selectedSummary)
            : "최근 사용 반을 바로 열 수 있습니다.";

  return (
    <div className="mx-auto mb-2 grid w-full max-w-[min(100vw-1.5rem,1600px)] gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-sm lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.9fr)]">
      <div className="min-w-0 space-y-2">
        {!!recentItems.length && (
          <div className="grid gap-2 md:grid-cols-3">
            {recentItems.map((item, index) => {
              const badge = getTeacherPresentationRuntimeBadge(item);
              const isSelected = item.classId === selectedClassId;
              return (
                <div
                  key={item.classId}
                  className={`rounded-2xl border px-3 py-2.5 transition ${
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
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${badgeToneClass(
                        badge.tone,
                      )}`}
                    >
                      <i
                        className={`${badgeIconClass(badge.tone)} text-[10px]`}
                      ></i>
                      {badge.text}
                    </div>
                  </div>
                  <div className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                    {getTeacherPresentationClassSummaryText(item)}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="truncate text-[11px] text-slate-400">
                      {item.currentPage ? `${item.currentPage}페이지` : "페이지 기록 없음"}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectClass(item.classId)}
                      className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold transition ${
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

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-500">
          {helperMessage}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
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
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${badgeToneClass(
              selectedBadge.tone,
            )}`}
          >
            <i
              className={`${badgeIconClass(selectedBadge.tone)} text-[10px]`}
            ></i>
            {selectedBadge.text}
          </div>
        </div>

        <div className="mt-1 text-[11px] text-slate-500">
          {getTeacherPresentationSelectorSummaryText(selectedSummary)}
        </div>

        <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-700">
          <span>반 바꾸기</span>
          <select
            value={selectedClassId}
            onChange={(event) => onSelectClass(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
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
