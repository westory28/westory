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

  return (
    <div className="mx-auto mb-3 grid w-full max-w-[min(100vw-1.5rem,1600px)] gap-3 rounded-3xl border border-white/20 bg-white/90 px-4 py-4 shadow-xl backdrop-blur lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.92fr)]">
      <div className="grid gap-3">
        {!!recentItems.length && (
          <div className="grid gap-3 md:grid-cols-3">
            {recentItems.map((item, index) => {
              const badge = getTeacherPresentationRuntimeBadge(item);
              const isSelected = item.classId === selectedClassId;
              return (
                <div
                  key={item.classId}
                  className={`rounded-3xl border px-4 py-4 transition ${
                    isSelected
                      ? "border-blue-300 bg-blue-50/90 shadow-sm ring-2 ring-blue-100"
                      : "border-slate-200 bg-white/95"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        {index === 0 ? "최근 사용 반" : "빠른 열기"}
                      </div>
                      <div className="mt-1 truncate text-base font-bold text-slate-900">
                        {item.classLabel}
                      </div>
                    </div>
                    <div
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badgeToneClass(
                        badge.tone,
                      )}`}
                    >
                      <i
                        className={`${badgeIconClass(badge.tone)} text-[11px]`}
                      ></i>
                      {badge.text}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {getTeacherPresentationClassSummaryText(item)}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-slate-500">
                      {item.currentPage ? `${item.currentPage}페이지` : ""}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectClass(item.classId)}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        isSelected
                          ? "bg-slate-900 text-white hover:bg-slate-800"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      <i className="fas fa-play text-xs"></i>
                      {isSelected ? "현재 선택됨" : "이 반으로 열기"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-white/80 px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            Launch Note
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-700">
            선택한 반의 마지막 판서를 이어서 엽니다.
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {selectedSummary
              ? getTeacherPresentationSelectorSummaryText(selectedSummary)
              : classLoadState === "loading"
                ? "이 반의 마지막 상태를 불러오는 중입니다."
                : classLoadState === "error" && cachedSummary
                  ? "학급 목록을 못 읽어도 마지막 사용 반 기준으로 이어서 열 수 있습니다."
                  : classLoadState === "error"
                    ? "학급 목록을 읽지 못했지만 현재 선택 반으로 열 수 있습니다."
                    : "아직 저장된 판서가 없습니다."}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white/95 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">현재 선택 반</div>
            <div className="mt-1 text-xs text-slate-500">
              저장 상태를 확인한 뒤 바로 수업을 열 수 있습니다.
            </div>
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badgeToneClass(
              selectedBadge.tone,
            )}`}
          >
            <i
              className={`${badgeIconClass(selectedBadge.tone)} text-[11px]`}
            ></i>
            {selectedBadge.text}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-base font-semibold text-slate-900">
            {selectedClassLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {getTeacherPresentationSelectorSummaryText(selectedSummary)}
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-sm font-semibold text-slate-700">
          <span>반 바꾸기</span>
          <select
            value={selectedClassId}
            onChange={(event) => onSelectClass(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          >
            {!classOptions.length && (
              <option value="preview-default">미리보기용 공용 상태</option>
            )}
            {classOptions.map((option) => {
              const optionBadge = getTeacherPresentationRuntimeBadge(option);
              return (
                <option key={option.classId} value={option.classId}>
                  {option.classLabel}
                  {recentItems.some((item) => item.classId === option.classId)
                    ? " · 최근 사용"
                    : ""}
                  {optionBadge.text ? ` · ${optionBadge.text}` : ""}
                </option>
              );
            })}
          </select>
          <span className="text-xs font-medium text-slate-500">
            {optionLoadState === "error" && cachedSummary
              ? "학급 목록을 못 읽어도 마지막 사용 반으로 열 수 있습니다."
              : optionLoadState === "error"
                ? "목록을 못 읽어도 현재 선택 반으로는 열 수 있습니다."
                : "최근 사용 반은 위에서 바로 열고, 다른 반은 여기서 고를 수 있습니다."}
          </span>
        </label>
      </div>
    </div>
  );
};

export default TeacherPresentationLauncher;
