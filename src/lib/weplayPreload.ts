let studentPage: Promise<typeof import("../pages/student/Weplay")> | undefined;

export function loadStudentWeplay() {
  return (studentPage ??= import("../pages/student/Weplay").catch((error) => {
    studentPage = undefined;
    throw error;
  }));
}

/** Navigation intent loads code only: no student data or game-start requests. */
export function preloadStudentWeplay() {
  void loadStudentWeplay().catch(() => undefined);
}
