import KoreanLunarCalendar from "korean-lunar-calendar";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  type Firestore,
  where,
  writeBatch,
} from "firebase/firestore";
import type { CalendarEvent } from "../types";

export interface KoreanPublicHoliday {
  title: string;
  start: string;
  source: "kasi" | "generated";
}

interface HolidaySeed {
  title: string;
  start: string;
  substituteTitle?: string;
  substitutePolicy?: "weekend-or-holiday" | "sunday-or-holiday";
  hasOverlap?: boolean;
}

const holidayCache = new Map<string, Promise<KoreanPublicHoliday[]>>();

const toDateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
};

const isWeekend = (dateKey: string) => {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  return day === 0 || day === 6;
};

const isSunday = (dateKey: string) =>
  new Date(`${dateKey}T00:00:00`).getDay() === 0;

const sanitizeDocId = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 60);

const lunarToSolar = (year: number, month: number, day: number) => {
  const calendar = new KoreanLunarCalendar();
  const valid = calendar.setLunarDate(year, month, day, false);
  if (!valid) return null;
  const solar = calendar.getSolarCalendar();
  return toDateKey(solar.year, solar.month, solar.day);
};

const addHoliday = (
  map: Map<string, HolidaySeed>,
  holiday: HolidaySeed,
  targetYear: number,
) => {
  if (!holiday.start.startsWith(`${targetYear}-`)) return;
  const current = map.get(holiday.start);
  if (current) {
    current.hasOverlap = true;
    current.substitutePolicy ||= holiday.substitutePolicy;
    current.substituteTitle ||= holiday.substituteTitle;
    return;
  }
  map.set(holiday.start, holiday);
};

const nextAvailableWeekday = (fromDateKey: string, occupied: Set<string>) => {
  let candidate = addDays(fromDateKey, 1);
  while (isWeekend(candidate) || occupied.has(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
};

const addSubstituteHolidays = (
  holidays: Map<string, HolidaySeed>,
  targetYear: number,
) => {
  const occupied = new Set(holidays.keys());
  const seeds = Array.from(holidays.values());

  seeds.forEach((holiday) => {
    if (!holiday.substitutePolicy) return;

    const needsSubstitute =
      holiday.substitutePolicy === "weekend-or-holiday"
        ? isWeekend(holiday.start) || Boolean(holiday.hasOverlap)
        : isSunday(holiday.start) || Boolean(holiday.hasOverlap);

    if (!needsSubstitute) return;

    const substituteDate = nextAvailableWeekday(holiday.start, occupied);
    if (!substituteDate.startsWith(`${targetYear}-`)) return;

    occupied.add(substituteDate);
    holidays.set(substituteDate, {
      title: holiday.substituteTitle || `${holiday.title} 대체공휴일`,
      start: substituteDate,
    });
  });
};

const generateKoreanPublicHolidays = (
  targetYear: number,
): KoreanPublicHoliday[] => {
  const holidays = new Map<string, HolidaySeed>();

  addHoliday(
    holidays,
    { title: "신정", start: toDateKey(targetYear, 1, 1) },
    targetYear,
  );

  const seollal = lunarToSolar(targetYear, 1, 1);
  if (seollal) {
    [
      {
        title: "설날 연휴",
        start: addDays(seollal, -1),
        substituteTitle: "설날 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
      {
        title: "설날",
        start: seollal,
        substituteTitle: "설날 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
      {
        title: "설날 연휴",
        start: addDays(seollal, 1),
        substituteTitle: "설날 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
    ].forEach((holiday) => addHoliday(holidays, holiday, targetYear));
  }

  [
    {
      title: "삼일절",
      start: toDateKey(targetYear, 3, 1),
      substituteTitle: "삼일절 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
    ...(targetYear >= 2026
      ? [{ title: "노동절", start: toDateKey(targetYear, 5, 1) }]
      : []),
    {
      title: "어린이날",
      start: toDateKey(targetYear, 5, 5),
      substituteTitle: "어린이날 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
    { title: "현충일", start: toDateKey(targetYear, 6, 6) },
    ...(targetYear >= 2026
      ? [{ title: "제헌절", start: toDateKey(targetYear, 7, 17) }]
      : []),
    {
      title: "광복절",
      start: toDateKey(targetYear, 8, 15),
      substituteTitle: "광복절 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
    {
      title: "개천절",
      start: toDateKey(targetYear, 10, 3),
      substituteTitle: "개천절 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
    {
      title: "한글날",
      start: toDateKey(targetYear, 10, 9),
      substituteTitle: "한글날 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
    {
      title: "성탄절",
      start: toDateKey(targetYear, 12, 25),
      substituteTitle: "성탄절 대체공휴일",
      substitutePolicy: "weekend-or-holiday" as const,
    },
  ].forEach((holiday) => addHoliday(holidays, holiday, targetYear));

  const buddhaBirthday = lunarToSolar(targetYear, 4, 8);
  if (buddhaBirthday) {
    addHoliday(
      holidays,
      {
        title: "부처님오신날",
        start: buddhaBirthday,
        substituteTitle: "부처님오신날 대체공휴일",
        substitutePolicy: "weekend-or-holiday",
      },
      targetYear,
    );
  }

  const chuseok = lunarToSolar(targetYear, 8, 15);
  if (chuseok) {
    [
      {
        title: "추석 연휴",
        start: addDays(chuseok, -1),
        substituteTitle: "추석 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
      {
        title: "추석",
        start: chuseok,
        substituteTitle: "추석 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
      {
        title: "추석 연휴",
        start: addDays(chuseok, 1),
        substituteTitle: "추석 대체공휴일",
        substitutePolicy: "sunday-or-holiday" as const,
      },
    ].forEach((holiday) => addHoliday(holidays, holiday, targetYear));
  }

  if (targetYear === 2026) {
    addHoliday(
      holidays,
      { title: "전국동시지방선거", start: "2026-06-03" },
      targetYear,
    );
  }

  addSubstituteHolidays(holidays, targetYear);

  return Array.from(holidays.values())
    .map((holiday) => ({
      title: holiday.title,
      start: holiday.start,
      source: "generated" as const,
    }))
    .sort((left, right) => left.start.localeCompare(right.start));
};

const fetchKasiPublicHolidays = async (targetYear: number) => {
  const response = await fetch(
    `/api/korean-holidays?year=${encodeURIComponent(String(targetYear))}`,
  );
  if (!response.ok) {
    throw new Error(`Holiday proxy failed: ${response.status}`);
  }

  const data = (await response.json()) as { holidays?: KoreanPublicHoliday[] };
  return (data.holidays || [])
    .filter((holiday) => holiday?.title && holiday?.start)
    .map((holiday) => ({ ...holiday, source: "kasi" as const }))
    .sort((left, right) => left.start.localeCompare(right.start));
};

export const getKoreanPublicHolidays = (targetYear: string | number) => {
  const year = Number(targetYear);
  const cacheKey = String(year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return Promise.resolve([]);
  }
  if (!holidayCache.has(cacheKey)) {
    holidayCache.set(
      cacheKey,
      fetchKasiPublicHolidays(year)
        .catch((error) => {
          console.warn(
            "Falling back to generated Korean public holidays:",
            error,
          );
          return [];
        })
        .then((officialHolidays) =>
          officialHolidays.length > 0
            ? officialHolidays
            : generateKoreanPublicHolidays(year),
        ),
    );
  }
  return holidayCache.get(cacheKey)!;
};

export const toHolidayCalendarEvent = (
  holiday: KoreanPublicHoliday,
): CalendarEvent => ({
  id: `holiday_${holiday.start}_${sanitizeDocId(holiday.title)}`,
  title: holiday.title,
  start: holiday.start,
  end: holiday.start,
  eventType: "holiday",
  targetType: "common",
  targetClass: undefined,
  description:
    holiday.source === "kasi"
      ? "한국천문연구원 특일 정보 기준 공휴일"
      : "대한민국 공휴일 규칙 기준 자동 생성",
});

export const mergeEventsWithKoreanPublicHolidays = (
  events: CalendarEvent[],
  holidays: KoreanPublicHoliday[],
) => [
  ...events.filter((event) => event.eventType !== "holiday"),
  ...holidays.map(toHolidayCalendarEvent),
];

export const syncKoreanPublicHolidaysToFirestore = async ({
  db,
  year,
  semester,
}: {
  db: Firestore;
  year: string | number;
  semester: string | number;
}) => {
  const holidays = await getKoreanPublicHolidays(year);
  if (holidays.length === 0) return { count: 0 };

  const path = `years/${year}/semesters/${semester}/calendar`;
  const holidayQuery = query(
    collection(db, path),
    where("eventType", "==", "holiday"),
  );
  const holidaySnap = await getDocs(holidayQuery);
  const batch = writeBatch(db);

  holidaySnap.forEach((item) => batch.delete(item.ref));
  holidays.forEach((holiday) => {
    const event = toHolidayCalendarEvent(holiday);
    const ref = doc(db, path, event.id);
    batch.set(ref, {
      ...event,
      targetClass: null,
      holidaySource: holiday.source,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return { count: holidays.length };
};

export const ensureKoreanPublicHolidaysSynced = async ({
  db,
  year,
  semester,
  force = false,
}: {
  db: Firestore;
  year: string | number;
  semester: string | number;
  force?: boolean;
}) => {
  const markerKey = `westory:holiday-sync:${year}:${semester}`;
  const today = new Date().toLocaleDateString("en-CA");
  if (!force && window.localStorage.getItem(markerKey) === today) {
    return { count: 0, skipped: true };
  }

  const result = await syncKoreanPublicHolidaysToFirestore({
    db,
    year,
    semester,
  });
  window.localStorage.setItem(markerKey, today);
  return { ...result, skipped: false };
};
