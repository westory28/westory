import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import { isSemesterArchive } from "./semesterArchive";
import { getYearSemester } from "./semesterScope";
import type { StudentEnrollmentProfile } from "./studentRoster";

type ConfigLike = Parameters<typeof getYearSemester>[0];
export interface TeacherStudentRoster {
  year: string;
  semester: string;
  students: Array<
    Record<string, unknown> & StudentEnrollmentProfile & { id: string }
  >;
  schoolConfig: {
    grades?: Array<{ value?: string; label?: string }>;
    classes?: Array<{ value?: string; label?: string }>;
  } | null;
}
const flights = new WeakMap<
  NonNullable<typeof auth.currentUser>,
  Map<string, Promise<TeacherStudentRoster>>
>();

// Only overlapping requests are shared. A completed roster is never an
// authorization cache: a later visit/refresh rechecks the live server session
// and permission, and errors are immediately retryable.
export const loadTeacherStudentRoster = async (
  config: ConfigLike,
  permissionKey: string,
  options: { fresh?: boolean } = {},
): Promise<TeacherStudentRoster> => {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 상태를 확인해 주세요.");
  const { year, semester } = getYearSemester(config);
  const { claims } = await user.getIdTokenResult();
  const authTime = Number(claims.auth_time);
  if (
    auth.currentUser !== user ||
    !Number.isSafeInteger(authTime) ||
    authTime <= 0
  )
    throw new Error("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
  let userFlights = flights.get(user);
  if (!userFlights) {
    userFlights = new Map();
    flights.set(user, userFlights);
  }
  const key = JSON.stringify([
    authTime,
    year,
    semester,
    permissionKey,
    isSemesterArchive,
  ]);
  const existing = userFlights.get(key);
  if (existing && !options.fresh) return existing;
  const flight = (async () => {
    let response: TeacherStudentRoster;
    if (isSemesterArchive) {
      // Archive mode intentionally forbids callable requests. Preserve its
      // existing rules-checked read path; it never dispatches a live command.
      const [snapshot, school] = await Promise.all([
        getDocs(collection(db, "users")),
        getDoc(doc(db, "site_settings", "school_config")).catch(() => null),
      ]);
      response = {
        year,
        semester,
        students: snapshot.docs.map((entry) => ({
          ...entry.data(),
          id: entry.id,
        })),
        schoolConfig: school?.exists() ? school.data() : null,
      };
    } else {
      const result = await callWithApplicationSession<
        { year: string; semester: string },
        TeacherStudentRoster
      >("getTeacherStudentRoster", { year, semester }, user);
      response = result.data;
    }
    if (
      auth.currentUser !== user ||
      Number((await user.getIdTokenResult()).claims.auth_time) !== authTime
    )
      throw new Error("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
    if (
      response.year !== year ||
      response.semester !== semester ||
      !Array.isArray(response.students)
    )
      throw new Error(
        "학생 명단의 학기를 확인하지 못했습니다. 다시 시도해 주세요.",
      );
    return response;
  })();
  userFlights.set(key, flight);
  try {
    return await flight;
  } finally {
    if (userFlights.get(key) === flight) userFlights.delete(key);
  }
};
