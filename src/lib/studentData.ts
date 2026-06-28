import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export interface StudentDataDeleteResult {
  uid: string;
  year: string;
  semester: string;
  userDocumentDeleted?: boolean;
  userProfileCleared?: boolean;
  authUserDeleted?: boolean;
  authUserDeleteError?: string;
  deletedRelatedDocCount: number;
  updatedRosterCount: number;
  removedRosterRowCount: number;
}

export interface StudentDataUpdateInput {
  uid: string;
  grade: string;
  class: string;
  number: string | number;
  name: string;
  email: string;
}

export interface StudentDataUpdateResult {
  uid: string;
  year: string;
  semester: string;
  updatedRelatedDocCount: number;
  updatedRosterCount: number;
  updatedRosterRowCount: number;
}

export interface LessonCorePointResetResult {
  uid: string;
  year: string;
  semester: string;
  resetRoot: boolean;
  resetUnitCount: number;
  removedCorePointFindCount: number;
}

export const deleteStudentData = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentDataDeleteResult> => {
  const { year, semester } = getYearSemester(config);
  const callable = await getHttpsCallable<
    { uid: string; year: string; semester: string },
    StudentDataDeleteResult
  >("deleteStudentData");
  const result = await callable({
    uid,
    year,
    semester,
  });
  return result.data;
};

export const resetLessonCorePointProgress = async (
  config: ConfigLike,
  uid: string,
): Promise<LessonCorePointResetResult> => {
  const { year, semester } = getYearSemester(config);
  const callable = await getHttpsCallable<
    { uid: string; year: string; semester: string },
    LessonCorePointResetResult
  >("resetLessonCorePointProgress");
  const result = await callable({
    uid,
    year,
    semester,
  });
  return result.data;
};

export const updateStudentData = async (
  config: ConfigLike,
  input: StudentDataUpdateInput,
): Promise<StudentDataUpdateResult> => {
  const { year, semester } = getYearSemester(config);
  const callable = await getHttpsCallable<
    StudentDataUpdateInput & { year: string; semester: string },
    StudentDataUpdateResult
  >("updateStudentData");
  const result = await callable({
    ...input,
    year,
    semester,
  });
  return result.data;
};
