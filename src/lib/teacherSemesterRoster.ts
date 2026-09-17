import { collection, getDocs } from "firebase/firestore";
import type { SystemConfig } from "../types";
import { getArchiveEnrollmentState } from "./archiveEnrollment";
import { db } from "./firebase";
import { selectSemesterRosterEnrollments } from "./semesterRoster";

/** A historical roster must never borrow today's names, classes or numbers. */
export const loadTeacherSemesterRoster = async (
  config: SystemConfig | null,
): Promise<Array<Record<string, any> & { uid: string }>> => {
  if (!config?.teacherViewOnly) {
    const snapshot = await getDocs(collection(db, "users"));
    return snapshot.docs.map((item) => ({ ...item.data(), uid: item.id }));
  }
  const state = await getArchiveEnrollmentState({
    source: "EXPLICIT",
    semesterId: `${config.year}-${config.semester}`,
    callSite: "TeacherSemesterRoster",
  });
  return selectSemesterRosterEnrollments(state.enrollments, true).map(
    (item) => {
      const semesterClass = state.classes.find(
        (row) => row.classId === item.classId,
      );
      return {
        uid: item.studentUid,
        role: "student",
        name: item.snapshot?.displayName || item.displayName || "학생",
        grade: item.snapshot?.grade || item.grade || semesterClass?.grade || "",
        class:
          item.snapshot?.classNumber ||
          item.classNumber ||
          semesterClass?.classNumber ||
          "",
        number: item.snapshot?.studentNumber || item.studentNumber || "",
        email: "",
      };
    },
  );
};
