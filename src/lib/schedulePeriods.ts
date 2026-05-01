export const SCHEDULE_PERIOD_OPTIONS = [
  { value: "beforeCheck", label: "조회 전", order: 0 },
  { value: "check", label: "조회", order: 1 },
  { value: "period1", label: "1교시", order: 2 },
  { value: "period2", label: "2교시", order: 3 },
  { value: "period3", label: "3교시", order: 4 },
  { value: "period4", label: "4교시", order: 5 },
  { value: "period5", label: "5교시", order: 6 },
  { value: "period6", label: "6교시", order: 7 },
  { value: "period7", label: "7교시", order: 8 },
  { value: "closing", label: "종례", order: 9 },
  { value: "afterSchool", label: "방과 후", order: 10 },
] as const;

export type SchedulePeriodValue = (typeof SCHEDULE_PERIOD_OPTIONS)[number]["value"];

export const DEFAULT_SCHEDULE_PERIOD: SchedulePeriodValue = "period1";

const PERIOD_OPTION_BY_VALUE = new Map(
  SCHEDULE_PERIOD_OPTIONS.map((option) => [option.value, option]),
);

const LEGACY_PERIOD_VALUE_BY_LABEL = new Map<string, SchedulePeriodValue>(
  SCHEDULE_PERIOD_OPTIONS.flatMap((option) => [
    [option.label, option.value],
    [option.value, option.value],
  ]),
);

export const normalizeSchedulePeriod = (
  value: unknown,
  fallback: SchedulePeriodValue = DEFAULT_SCHEDULE_PERIOD,
): SchedulePeriodValue => {
  const rawValue = String(value ?? "").trim();
  return LEGACY_PERIOD_VALUE_BY_LABEL.get(rawValue) || fallback;
};

export const getSchedulePeriodLabel = (value: unknown) => {
  return PERIOD_OPTION_BY_VALUE.get(normalizeSchedulePeriod(value)).label;
};

export const getSchedulePeriodOrder = (value: unknown) => {
  return PERIOD_OPTION_BY_VALUE.get(normalizeSchedulePeriod(value)).order;
};

export const compareSchedulePeriod = (
  left: { startPeriod?: unknown; period?: unknown; title?: string },
  right: { startPeriod?: unknown; period?: unknown; title?: string },
) => {
  const orderDiff =
    getSchedulePeriodOrder(left.startPeriod ?? left.period) -
    getSchedulePeriodOrder(right.startPeriod ?? right.period);
  if (orderDiff !== 0) return orderDiff;
  return String(left.title || "").localeCompare(String(right.title || ""), "ko");
};

export const compareCalendarSchedule = <
  T extends {
    start?: string;
    startPeriod?: unknown;
    period?: unknown;
    title?: string;
  },
>(
  left: T,
  right: T,
) => {
  const leftDate = String(left.start || "").split("T")[0];
  const rightDate = String(right.start || "").split("T")[0];
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return compareSchedulePeriod(left, right);
};
