import React, { useRef, useState } from "react";
import ModalSurface from "../../../components/common/ModalSurface";
import {
  PRESERVE_SCHEDULE_TARGETS,
  resolveScheduleTargets,
  type ScheduleClassOption,
} from "../../../lib/scheduleClassTargets";
import {
  createScheduleEvent,
  deleteScheduleEvent,
  toW8LocalDateTimeInput,
  toW8ServerDateTime,
  updateScheduleEvent,
  W8DomainError,
  type W8DomainState,
  type W8ScheduleEvent,
} from "../../../lib/w8Domains";

interface Props {
  state: W8DomainState;
  event: W8ScheduleEvent | null;
  initialDate: string;
  classes: ScheduleClassOption[];
  onClose: () => void;
  onSaved: () => void;
}

const TYPES = [
  ["event", "학교 행사"],
  ["exam", "정기 시험"],
  ["performance", "수행평가"],
  ["diagnosis", "진단평가"],
  ["formative", "형성평가"],
] as const;

export const getCalendarEventCategory = (event: W8ScheduleEvent) => {
  const matched = event.sourceReference.match(
    /^legacy-calendar:(exam|performance|event|diagnosis|formative):/u,
  );
  if (matched) return matched[1];
  if (event.eventType === "HOLIDAY") return "holiday";
  if (event.eventType === "ASSESSMENT") return "performance";
  if (event.eventType === "LEARNING_DEADLINE") return "formative";
  return "event";
};

const localDate = (value: string) =>
  toW8LocalDateTimeInput(value).split("T")[0];

const TeacherCalendarEventModal: React.FC<Props> = ({
  state,
  event,
  initialDate,
  classes,
  onClose,
  onSaved,
}) => {
  const originalStart = event ? localDate(event.startAt) : initialDate;
  const originalEnd = event ? localDate(event.endAt) : initialDate;
  const originalCategory = event ? getCalendarEventCategory(event) : "event";
  const [title, setTitle] = useState(event?.title || "");
  const [description, setDescription] = useState(event?.description || "");
  const [start, setStart] = useState(originalStart);
  const [end, setEnd] = useState(originalEnd);
  const [category, setCategory] = useState(originalCategory);
  const [target, setTarget] = useState(
    event ? PRESERVE_SCHEDULE_TARGETS : "common",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflicted, setConflicted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"delete" | "widen" | null>(
    null,
  );
  const inFlight = useRef(false);
  const sourceKey = useRef(globalThis.crypto.randomUUID());
  const titleRef = useRef<HTMLInputElement>(null);
  const canWrite = !state.readOnly && (!event || event.sourceDomain === "USER");
  const hasRestrictedTargets = Boolean(
    event?.classIds.length || event?.targetUserIds.length,
  );
  const originalTargetLabel = event
    ? [
        ...event.classIds.map(
          (id) =>
            classes.find((item) => item.value === id)?.label || "기존 학급",
        ),
        ...(event.targetUserIds.length
          ? [`개별 대상 ${event.targetUserIds.length}명`]
          : []),
      ].join(" · ") || "전체 공통"
    : "";

  const save = async (confirmed = false) => {
    if (inFlight.current || !canWrite || conflicted) return;
    if (!title.trim() || !start || !end || end < start) {
      setError(
        "제목과 날짜를 확인해 주세요. 종료일은 시작일보다 빠를 수 없습니다.",
      );
      return;
    }
    if (event && event.semesterId !== state.semesterId) {
      setError("학기가 바뀌었습니다. 창을 닫고 일정을 다시 열어 주세요.");
      return;
    }
    if (!confirmed && target === "common" && hasRestrictedTargets) {
      setConfirmAction("widen");
      return;
    }
    setError("");
    inFlight.current = true;
    setSaving(true);
    try {
      const targets = resolveScheduleTargets({
        original: event
          ? {
              targetClassIds: event.classIds,
              targetUserIds: event.targetUserIds,
            }
          : null,
        selectionChanged: target !== PRESERVE_SCHEDULE_TARGETS,
        targetType: target === "common" ? "common" : "class",
        targetClass: target,
        classes,
      });
      const preserveTime = Boolean(
        event && start === originalStart && end === originalEnd,
      );
      const sourceReference = event?.sourceReference
        ? event.sourceReference.replace(
            /^legacy-calendar:(exam|performance|event|diagnosis|formative):/u,
            `legacy-calendar:${category}:`,
          )
        : `legacy-calendar:${category}:${sourceKey.current}`;
      const payload = {
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        title: title.trim(),
        description,
        startAt: preserveTime
          ? event!.startAt
          : toW8ServerDateTime(`${start}T00:00`),
        endAt: preserveTime ? event!.endAt : toW8ServerDateTime(`${end}T00:00`),
        allDay: preserveTime ? event!.allDay : true,
        period: event?.period || "",
        eventType:
          event && category === originalCategory
            ? event.eventType
            : category === "event"
              ? "SCHOOL"
              : "ASSESSMENT",
        sourceDomain: event?.sourceDomain || "USER",
        sourceReference,
        ...targets,
      };
      if (event) {
        await updateScheduleEvent({
          ...payload,
          eventId: event.eventId,
          expectedEventRevision: event.revision,
        });
      } else {
        await createScheduleEvent(payload);
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof W8DomainError && caught.kind === "CONFLICT")
        setConflicted(true);
      setError(
        caught instanceof Error
          ? caught.message
          : "일정을 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
      inFlight.current = false;
      setConfirmAction(null);
    }
  };

  const remove = async () => {
    if (inFlight.current || !event || !canWrite || conflicted) return;
    if (event.semesterId !== state.semesterId) {
      setError("학기가 바뀌었습니다. 창을 닫고 일정을 다시 열어 주세요.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await deleteScheduleEvent({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        eventId: event.eventId,
        expectedEventRevision: event.revision,
        reason: "교사가 학사 일정 팝업에서 일정 삭제를 확인함",
      });
      onSaved();
    } catch (caught) {
      if (caught instanceof W8DomainError && caught.kind === "CONFLICT")
        setConflicted(true);
      setError(
        caught instanceof Error
          ? caught.message
          : "일정을 삭제하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
      inFlight.current = false;
      setConfirmAction(null);
    }
  };

  return (
    <ModalSurface
      open
      title={event ? "일정 수정" : "일정 추가"}
      onClose={onClose}
      dismissible={!saving}
      initialFocusRef={titleRef}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {event && !confirmAction && (
            <button
              type="button"
              disabled={saving || !canWrite || conflicted}
              className="mr-auto min-h-11 rounded-lg border border-red-200 px-4 py-2 font-bold text-red-700 disabled:opacity-50"
              onClick={() => setConfirmAction("delete")}
            >
              일정 삭제
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            className="min-h-11 rounded-lg border border-gray-200 px-4 py-2 font-bold text-gray-700"
            onClick={onClose}
          >
            취소
          </button>
          {!confirmAction && (
            <button
              type="submit"
              form="teacher-calendar-event-form"
              disabled={saving || !canWrite || conflicted}
              className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
        </div>
      }
    >
      <form
        id="teacher-calendar-event-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={saving || !canWrite || conflicted || Boolean(confirmAction)}
          className="space-y-4"
        >
          <label className="block text-sm font-bold text-gray-700">
            일정 제목
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-gray-700">
              시작일
              <input
                type="date"
                required
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value > end) setEnd(e.target.value);
                }}
                className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm font-bold text-gray-700">
              종료일
              <input
                type="date"
                required
                min={start}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
          </div>
          {event && !event.allDay && (
            <p className="text-sm text-gray-600">
              날짜를 그대로 두면 기존 시각이 유지됩니다. 날짜를 바꾸면 종일
              일정으로 저장됩니다.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-gray-700">
              일정 종류
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-gray-700">
              대상
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {event && (
                  <option value={PRESERVE_SCHEDULE_TARGETS}>
                    기존 대상 유지
                  </option>
                )}
                <option value="common">전체 공통</option>
                {classes
                  .filter((item) => item.selectable)
                  .map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {event && (
            <p className="text-sm text-gray-600">
              현재 대상: {originalTargetLabel}
            </p>
          )}
          <label className="block text-sm font-bold text-gray-700">
            내용
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-normal"
            />
          </label>
        </fieldset>
        {!canWrite && (
          <p role="status" className="text-sm text-gray-600">
            이 일정은 읽기 전용입니다.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
            {conflicted && (
              <p className="mt-2">
                다른 변경이 확인되었습니다. 창을 닫고 새로 불러온 일정에서 다시
                수정해 주세요.
              </p>
            )}
          </div>
        )}
        {confirmAction && (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-gray-800"
          >
            <p>
              {confirmAction === "delete"
                ? "이 일정을 삭제하시겠습니까?"
                : "학급·개별 대상 제한을 해제하고 전체 공통 일정으로 변경하시겠습니까?"}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmAction(null)}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 font-bold"
              >
                돌아가기
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void (confirmAction === "delete" ? remove() : save(true))
                }
                className={`min-h-11 rounded-lg px-4 py-2 font-bold text-white ${confirmAction === "delete" ? "bg-red-600" : "bg-blue-600"}`}
              >
                {saving
                  ? "처리 중…"
                  : confirmAction === "delete"
                    ? "삭제"
                    : "전체 공통으로 저장"}
              </button>
            </div>
          </div>
        )}
      </form>
    </ModalSurface>
  );
};

export default TeacherCalendarEventModal;
