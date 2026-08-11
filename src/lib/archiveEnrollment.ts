import { getHttpsCallable } from "./firebase";
import type { EnrollmentRosterPayload } from "./commandGateway";
import { requestStepUpReauthentication } from "./stepUpReauth";

export const W4_READINESS_REGISTRY_VERSION = "w4-v1";
export const W4_ARCHIVE_ACCESS_POLICY = "ADMIN_ONLY" as const;

export type EnrollmentProvenanceSource =
  | "CURRENT"
  | "PREPARING"
  | "ARCHIVE"
  | "LEGACY"
  | "EXPLICIT";

export interface RosterValidationSummary {
  expectedStudentCount: number;
  classCount: number;
  enrollmentCount: number;
  duplicateClassCount: number;
  duplicateStudentCount: number;
  duplicateStudentNumberCount: number;
  duplicateExpectedStudentCount: number;
  orphanStudentCount: number;
  orphanTeacherCount: number;
  orphanClassCount: number;
  missingStudentCount: number;
  unexpectedStudentCount: number;
  existingClassConflictCount: number;
}

export interface RosterPreviewResult {
  semesterId: string;
  rosterId: string;
  passed: boolean;
  validationHash: string;
  summary: RosterValidationSummary;
  writeCount: 0;
}

export interface SemesterClassRecord {
  classId: string;
  semesterId: string;
  grade: string;
  classNumber: string;
  classKey: string;
  displayName: string;
  status: "ACTIVE" | "INACTIVE";
  homeroomTeacherUid: string;
  revision: number;
  provenance: "CANONICAL";
}

export interface SemesterEnrollmentRecord {
  enrollmentId?: string;
  studentUid: string;
  semesterId?: string;
  classId?: string;
  studentNumber: string;
  enrollmentStatus?:
    | "PENDING"
    | "ACTIVE"
    | "TRANSFERRED"
    | "WITHDRAWN"
    | "COMPLETED";
  revision?: number;
  provenance?: "CANONICAL";
  snapshot?: {
    displayName?: string;
    grade?: string;
    classNumber?: string;
    classDisplayName?: string;
    studentNumber?: string;
  };
  displayName?: string;
  grade?: string;
  classNumber?: string;
}

export interface ArchiveManifestRecord {
  semesterId: string;
  archiveStatus: "PREPARED" | "FROZEN";
  integrityHash: string;
  unresolvedBlockingCount: number;
  accessPolicy: "ADMIN_ONLY";
  counts: Record<string, number>;
  writeFenceVersion: "w4-v1";
}

export interface ArchiveEnrollmentState {
  semesterId: string;
  provenance: "CURRENT" | "PREPARING" | "ARCHIVE" | "LEGACY";
  source: string;
  readOnly: boolean;
  schemaVersion: number;
  legacy: boolean;
  status: string;
  classes: SemesterClassRecord[];
  enrollments: SemesterEnrollmentRecord[];
  rosterImports: Array<Record<string, unknown>>;
  archive: ArchiveManifestRecord | null;
}

export const previewEnrollmentRoster = async (
  payload: EnrollmentRosterPayload,
) => {
  await requestStepUpReauthentication("previewEnrollmentRoster");
  const callable = await getHttpsCallable<
    EnrollmentRosterPayload,
    RosterPreviewResult
  >("previewEnrollmentRoster");
  const response = await callable(payload);
  return response.data;
};

export const getArchiveEnrollmentState = async (request: {
  source: EnrollmentProvenanceSource;
  semesterId?: string;
  studentUid?: string;
  callSite: string;
}) => {
  const callable = await getHttpsCallable<
    typeof request,
    ArchiveEnrollmentState
  >("getArchiveEnrollmentState");
  const response = await callable(request);
  return response.data;
};
