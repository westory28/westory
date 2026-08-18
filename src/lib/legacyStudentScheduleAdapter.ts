import type { SystemConfig } from "../types";
import {
  getW8DomainState,
  toW8LocalDateTimeInput,
  type W8ScheduleEvent,
} from "./w8Domains";

export type LegacyStudentScheduleEventType =
  | "exam"
  | "performance"
  | "event"
  | "diagnosis"
  | "formative"
  | "holiday";

export interface LegacyStudentScheduleEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  startPeriod?: string;
  endPeriod?: string;
  period?: string;
  eventType: LegacyStudentScheduleEventType;
  targetType: "common" | "class";
  targetClass?: string;
  description?: string;
}

export interface LegacyStudentScheduleProjection {
  semesterId: string;
  year: string;
  semester: string;
  events: LegacyStudentScheduleEvent[];
}

const LEGACY_EVENT_TYPES = new Set<LegacyStudentScheduleEventType>([
  "exam",
  "performance",
  "event",
  "diagnosis",
  "formative",
  "holiday",
]);

const normalizeKeyPart = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");

const normalizedEventIdentity = (event: W8ScheduleEvent) => {
  const sourceReference = normalizeKeyPart(event.sourceReference);
  if (sourceReference) return `source:${sourceReference}`;
  return `event:${normalizeKeyPart(event.eventId)}`;
};

const preferEvent = (
  current: W8ScheduleEvent | undefined,
  candidate: W8ScheduleEvent,
) => {
  if (!current) return candidate;
  if (candidate.revision !== current.revision) {
    return candidate.revision > current.revision ? candidate : current;
  }
  return normalizeKeyPart(candidate.eventId).localeCompare(
    normalizeKeyPart(current.eventId),
  ) < 0
    ? candidate
    : current;
};

const legacyEventTypeFromW8 = (
  event: W8ScheduleEvent,
): LegacyStudentScheduleEventType => {
  const sourceMatch = event.sourceReference.match(
    /^legacy-calendar:(exam|performance|event|diagnosis|formative):/iu,
  );
  const sourceType = sourceMatch?.[1]?.toLowerCase();
  if (
    sourceType &&
    LEGACY_EVENT_TYPES.has(sourceType as LegacyStudentScheduleEventType)
  ) {
    return sourceType as LegacyStudentScheduleEventType;
  }
  if (event.eventType === "HOLIDAY") return "holiday";
  if (event.eventType === "ASSESSMENT") return "performance";
  if (event.eventType === "LEARNING_DEADLINE") return "formative";
  return "event";
};

const toDateKey = (value: string) =>
  toW8LocalDateTimeInput(value).split("T")[0] ||
  String(value || "").split("T")[0];

export const projectW8StudentScheduleEvents = (
  scheduleEvents: W8ScheduleEvent[],
) => {
  const eventByIdentity = new Map<string, W8ScheduleEvent>();
  scheduleEvents
    .filter((event) => event.status === "ACTIVE")
    .forEach((event) => {
      const identity = normalizedEventIdentity(event);
      eventByIdentity.set(
        identity,
        preferEvent(eventByIdentity.get(identity), event),
      );
    });

  return Array.from(eventByIdentity.values()).map(
    (event): LegacyStudentScheduleEvent => ({
      id: event.eventId,
      title: event.title,
      start: toDateKey(event.startAt),
      end: toDateKey(event.endAt),
      period: event.period,
      eventType: legacyEventTypeFromW8(event),
      targetType: event.classIds.length ? "class" : "common",
      targetClass: event.classIds[0],
      description: event.description,
    }),
  );
};

export const loadLegacyStudentScheduleProjection = async (input: {
  config: SystemConfig;
  studentUid: string;
}): Promise<LegacyStudentScheduleProjection> => {
  const studentUid = String(input.studentUid || "").trim();
  if (!studentUid) {
    throw new Error("학생 일정 조회에 필요한 사용자 정보가 없습니다.");
  }

  const state = await getW8DomainState({
    config: input.config,
    domain: "SCHEDULE",
    audience: "student",
    source: "CURRENT",
    studentUid,
  });
  const [year, semester] = state.semesterId.split("-");

  return {
    semesterId: state.semesterId,
    year: year || input.config.year,
    semester: semester || input.config.semester,
    events: projectW8StudentScheduleEvents(state.scheduleEvents),
  };
};
