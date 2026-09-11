import type { SemesterClassRecord } from "./archiveEnrollment";
import type { CalendarEvent } from "../types";

export interface ScheduleClassOption {
  value: string;
  label: string;
  selectable: boolean;
}

export interface ScheduleTargets {
  targetClassIds: string[];
  targetUserIds: string[];
}

export const PRESERVE_SCHEDULE_TARGETS = "__preserve_schedule_targets__";

export const buildScheduleClassOptions = (
  semesterId: string,
  classes: SemesterClassRecord[],
): ScheduleClassOption[] => {
  if (classes.some((item) => item.semesterId !== semesterId))
    throw new Error(
      "학급 조회 학기가 바뀌었습니다. 일정을 다시 불러와 주세요.",
    );
  const activeKeys = new Map<string, number>();
  classes.forEach((item) => {
    if (item.status !== "ACTIVE") return;
    const key = JSON.stringify([item.grade, item.classNumber]);
    activeKeys.set(key, (activeKeys.get(key) || 0) + 1);
  });
  const seen = new Set<string>();
  return classes
    .map((item) => {
      if (!item.classId || seen.has(item.classId))
        throw new Error("학급 정보가 중복되었습니다. 명부를 확인해 주세요.");
      seen.add(item.classId);
      const grade = String(item.grade || "").trim(),
        classNumber = String(item.classNumber || "").trim();
      const key = JSON.stringify([item.grade, item.classNumber]);
      return {
        value: item.classId,
        label:
          grade && classNumber
            ? `${grade.replace(/학년$/u, "")}학년 ${classNumber.replace(/반$/u, "")}반`
            : item.displayName || "학급 정보 확인 필요",
        selectable:
          item.status === "ACTIVE" &&
          Boolean(grade && classNumber) &&
          activeKeys.get(key) === 1,
      };
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label, "ko", { numeric: true }),
    );
};

type TargetDisplay = Pick<
  CalendarEvent,
  | "eventType"
  | "targetType"
  | "targetClass"
  | "targetClassLabel"
  | "targetUserIds"
>;
type SchoolOption = { value: string; label: string };
export const formatScheduleTargetLabel = (
  event: TargetDisplay,
  options: {
    commonLabel?: string;
    gradeOptions?: SchoolOption[];
    classOptions?: SchoolOption[];
  } = {},
) => {
  if (event.targetClassLabel) return event.targetClassLabel;
  if (event.targetUserIds?.length) return "개별 지정";
  if (
    event.eventType === "holiday" ||
    event.targetType === "common" ||
    event.targetType === "all"
  )
    return options.commonLabel || "전체 공통";
  // A canonical ID is opaque. Only the established numeric legacy key is parsed.
  const match = /^(\d+)-(\d+)$/u.exec(String(event.targetClass || ""));
  if (!match) return "학급 정보 확인 필요";
  const grade =
    options.gradeOptions?.find((item) => item.value === match[1])?.label ||
    `${match[1]}학년`;
  const classNumber =
    options.classOptions?.find((item) => item.value === match[2])?.label ||
    `${match[2]}반`;
  return `${grade} ${classNumber}`;
};

export const projectScheduleTargets = (
  targetClassIds: string[],
  targetUserIds: string[],
  classes: ScheduleClassOption[],
): Pick<
  CalendarEvent,
  "targetClass" | "targetClassIds" | "targetUserIds" | "targetClassLabel"
> & { targetType: "common" | "class" } => {
  const labels = targetClassIds.map(
    (id) =>
      classes.find((item) => item.value === id)?.label || "학급 정보 확인 필요",
  );
  return {
    targetType:
      targetClassIds.length || targetUserIds.length ? "class" : "common",
    targetClass: targetClassIds[0],
    targetClassIds: [...targetClassIds],
    targetUserIds: [...targetUserIds],
    targetClassLabel: labels.length
      ? `${labels.join(", ")}${targetUserIds.length ? " · 개별 대상 포함" : ""}`
      : targetUserIds.length
        ? "개별 지정"
        : "전체 공통",
  };
};

export const resolveScheduleTargets = (input: {
  original: ScheduleTargets | null;
  selectionChanged: boolean;
  targetType: "common" | "class";
  targetClass?: string;
  classes: ScheduleClassOption[];
}): ScheduleTargets => {
  if (input.original && !input.selectionChanged)
    return {
      targetClassIds: [...input.original.targetClassIds],
      targetUserIds: [...input.original.targetUserIds],
    };
  if (input.targetType === "common")
    return { targetClassIds: [], targetUserIds: [] };
  const selected = input.classes.find(
    (item) => item.value === input.targetClass,
  );
  if (!selected?.selectable)
    throw new Error(
      "현재 학기에 등록된 학급을 선택해 주세요. 기존 대상은 변경하지 않았습니다.",
    );
  return {
    targetClassIds: [selected.value],
    targetUserIds: [...(input.original?.targetUserIds || [])],
  };
};
