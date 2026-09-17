import type { SemesterEnrollmentRecord } from "./archiveEnrollment";

/** Class moves retain their old enrollment. A roster has one row per pupil. */
export const selectSemesterRosterEnrollments = (
  enrollments: SemesterEnrollmentRecord[],
  historical: boolean,
): SemesterEnrollmentRecord[] => {
  if (!historical)
    return enrollments.filter((item) => item.enrollmentStatus === "ACTIVE");
  const byStudent = new Map<string, SemesterEnrollmentRecord>();
  const priority = (item: SemesterEnrollmentRecord) =>
    item.enrollmentStatus === "ACTIVE"
      ? 3
      : ["COMPLETED", "WITHDRAWN"].includes(item.enrollmentStatus || "")
        ? 2
        : item.enrollmentStatus === "TRANSFERRED"
          ? 1
          : 0;
  for (const item of enrollments) {
    if (!item.studentUid) continue;
    const previous = byStudent.get(item.studentUid);
    if (
      !previous ||
      priority(item) > priority(previous) ||
      (priority(item) === priority(previous) &&
        (item.effectiveFrom || "").localeCompare(previous.effectiveFrom || "") >
          0) ||
      (priority(item) === priority(previous) &&
        item.effectiveFrom === previous.effectiveFrom &&
        (item.revision || 0) > (previous.revision || 0))
    ) {
      byStudent.set(item.studentUid, item);
    }
  }
  return [...byStudent.values()];
};
