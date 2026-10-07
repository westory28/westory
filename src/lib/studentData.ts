import { auth, getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import {
  callStudentDataService,
  updateCanonicalStudentProfile,
  type StudentProfileOperation,
} from "./studentProfileCommands";

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
  operation?: StudentProfileOperation;
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
  const ownerUid = auth.currentUser?.uid || "";
  const { year, semester } = getYearSemester(config);
  if (await updateCanonicalStudentProfile(config, input)) {
    return {
      uid: input.uid,
      year,
      semester,
      updatedRelatedDocCount: 0,
      updatedRosterCount: 0,
      updatedRosterRowCount: 0,
    };
  }
  const { operation: _operation, ...profile } = input;
  return callStudentDataService<
    StudentDataUpdateInput & { year: string; semester: string },
    StudentDataUpdateResult
  >("updateStudentData", { ...profile, year, semester }, ownerUid);
};
