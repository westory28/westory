import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db, getHttpsCallable } from "./firebase";

export const SEMESTER_MANIFEST_COLLECTION = "semester_manifests";
export const SEMESTER_READINESS_REPORT_COLLECTION =
  "semester_readiness_reports";
export const ACTIVE_SEMESTER_POINTER_PATH = "site_settings/semester_active";

export type SemesterStatus =
  | "DRAFT"
  | "PREPARING"
  | "VALIDATING"
  | "READY"
  | "ACTIVE"
  | "CLOSING"
  | "CLOSED"
  | "ARCHIVED"
  | "FAILED"
  | "QUARANTINED";

export type SemesterProvenance = "CURRENT" | "PREPARING" | "ARCHIVE" | "LEGACY";

export type SemesterReadinessCheckStatus =
  | "PASS"
  | "FAIL"
  | "WARNING"
  | "PENDING"
  | "NOT_APPLICABLE";

export interface SemesterManifest {
  semesterId: string;
  schoolYear: string;
  term: "1" | "2";
  displayName: string;
  status: SemesterStatus;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  revision: number;
  readinessPolicyVersion: string;
  provenance: SemesterProvenance;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  activatedAt?: unknown;
  activatedBy?: string;
  closedAt?: unknown;
  closedBy?: string;
}

export interface SemesterReadinessCheck {
  checkId: string;
  label: string;
  category?: string;
  required: boolean;
  status: SemesterReadinessCheckStatus;
  severity?: string;
  evidence?: string;
  resultSummary?: string;
  evaluatedAt?: unknown;
  evaluatedRevision?: number;
  policyVersion?: string;
  failureReason?: string;
  ownerWave?: string;
}

export interface SemesterReadinessReport {
  semesterId: string;
  status: "PASS" | "FAIL" | "STALE";
  stale: boolean;
  policyVersion: string;
  evaluatedRevision: number;
  dependencyHash: string;
  evaluatedAt?: unknown;
  requiredPassed: number;
  requiredTotal: number;
  checks: SemesterReadinessCheck[];
}

export interface ActiveSemesterPointer {
  semesterId: string;
  revision: number;
  previousSemesterId?: string | null;
  activatedAt?: unknown;
  activatedBy?: string;
}

export interface SemesterCoreSnapshot {
  manifests: SemesterManifest[];
  readinessReports: Record<string, SemesterReadinessReport>;
  activePointer: ActiveSemesterPointer | null;
}

export type SemesterResolveRequest =
  | { mode: "ACTIVE" }
  | { mode: "PREPARING" }
  | { mode: "EXPLICIT"; semesterId: string };

export type SemesterResolveResult =
  | {
      ok: true;
      manifest: SemesterManifest;
      provenance: SemesterProvenance;
    }
  | {
      ok: false;
      reason:
        | "SEMESTER_NOT_FOUND"
        | "NO_ACTIVE_SEMESTER"
        | "CONFLICTING_ACTIVE_SEMESTER"
        | "NO_PREPARING_SEMESTER";
    };

const STATUSES = new Set<SemesterStatus>([
  "DRAFT",
  "PREPARING",
  "VALIDATING",
  "READY",
  "ACTIVE",
  "CLOSING",
  "CLOSED",
  "ARCHIVED",
  "FAILED",
  "QUARANTINED",
]);

const PROVENANCES = new Set<SemesterProvenance>([
  "CURRENT",
  "PREPARING",
  "ARCHIVE",
  "LEGACY",
]);

const CHECK_LABELS: Record<string, string> = {
  manifest_schema: "Manifest schema",
  identity_unique: "학년도·학기 조합 유일성",
  date_range: "학기 날짜 범위",
  required_settings: "필수 학기 설정",
  status_transition: "상태 전환 가능 여부",
  schema_version: "Manifest schema version",
  policy_version: "Readiness policy version",
  active_conflict: "활성 학기 충돌",
  revision_freshness: "Manifest revision 일치",
  blocking_issues: "미해결 차단 문제",
  trusted_shell_complete: "신뢰할 수 있는 학기 shell",
  semester_duration: "학기 운영 기간",
  archive_readiness: "이전 학기 아카이브 준비",
  class_readiness: "학급 편성 준비",
  enrollment_readiness: "학생 학적 준비",
};

const normalizeManifest = (
  id: string,
  raw: Record<string, unknown>,
): SemesterManifest | null => {
  const schoolYear = String(raw.schoolYear || "").trim();
  const term = String(raw.term || "").trim();
  const status = String(raw.status || "").trim() as SemesterStatus;
  const storedProvenance = String(
    raw.provenance || "",
  ).trim() as SemesterProvenance;
  if (
    !/^\d{4}$/.test(schoolYear) ||
    (term !== "1" && term !== "2") ||
    !STATUSES.has(status)
  ) {
    return null;
  }
  const provenance = PROVENANCES.has(storedProvenance)
    ? storedProvenance
    : status === "ACTIVE"
      ? "CURRENT"
      : status === "CLOSED" || status === "ARCHIVED"
        ? "ARCHIVE"
        : status === "QUARANTINED"
          ? "LEGACY"
          : "PREPARING";
  return {
    semesterId: String(raw.semesterId || id).trim() || id,
    schoolYear,
    term,
    displayName:
      String(raw.displayName || "").trim() || `${schoolYear}학년도 ${term}학기`,
    status,
    startDate: String(raw.startDate || raw.startAt || ""),
    endDate: String(raw.endDate || raw.endAt || ""),
    schemaVersion: Number(raw.schemaVersion || 0),
    revision: Number(raw.revision || 0),
    readinessPolicyVersion: String(raw.readinessPolicyVersion || ""),
    provenance,
    createdAt: raw.createdAt,
    createdBy: String(raw.createdBy || ""),
    updatedAt: raw.updatedAt,
    updatedBy: String(raw.updatedBy || ""),
    activatedAt: raw.activatedAt,
    activatedBy: String(raw.activatedBy || ""),
    closedAt: raw.closedAt,
    closedBy: String(raw.closedBy || ""),
  };
};

const normalizeReadinessReport = (
  id: string,
  raw: Record<string, unknown>,
): SemesterReadinessReport | null => {
  const rawStatus = String(raw.status || "").trim();
  if (!new Set(["PASS", "FAIL", "STALE"]).has(rawStatus)) return null;
  const reportStatus =
    raw.stale === true || rawStatus === "STALE" ? "STALE" : rawStatus;
  const checks = Array.isArray(raw.checks)
    ? raw.checks
        .filter(
          (item): item is Record<string, unknown> =>
            !!item &&
            typeof item === "object" &&
            ("id" in item || "checkId" in item),
        )
        .map((item) => {
          const checkId = String(item.id || item.checkId || "");
          return {
            checkId,
            label: String(item.label || CHECK_LABELS[checkId] || checkId),
            category: String(item.category || "core"),
            required: item.required !== false,
            status: String(
              item.status || "PENDING",
            ) as SemesterReadinessCheckStatus,
            severity: String(item.severity || "blocking"),
            evidence: String(item.evidence || ""),
            resultSummary: String(item.detail || item.resultSummary || ""),
            failureReason: String(item.failureReason || ""),
            ownerWave: String(item.ownerWave || "W3"),
          };
        })
    : [];
  return {
    semesterId: String(raw.semesterId || id).trim() || id,
    status: reportStatus as SemesterReadinessReport["status"],
    stale: raw.stale === true,
    policyVersion: String(raw.policyVersion || ""),
    evaluatedRevision: Number(raw.evaluatedRevision || 0),
    dependencyHash: String(raw.dependencyHash || ""),
    evaluatedAt: raw.evaluatedAt,
    requiredPassed: Number(raw.requiredPassCount || raw.requiredPassed || 0),
    requiredTotal: Number(raw.requiredCheckCount || raw.requiredTotal || 0),
    checks,
  };
};

export const loadSemesterCoreSnapshot =
  async (): Promise<SemesterCoreSnapshot> => {
    const [manifestSnapshot, readinessSnapshot, pointerSnapshot] =
      await Promise.all([
        getDocs(collection(db, SEMESTER_MANIFEST_COLLECTION)),
        getDocs(collection(db, SEMESTER_READINESS_REPORT_COLLECTION)),
        getDoc(doc(db, ACTIVE_SEMESTER_POINTER_PATH)),
      ]);

    const manifests = manifestSnapshot.docs
      .map((item) => normalizeManifest(item.id, item.data()))
      .filter((item): item is SemesterManifest => item !== null)
      .sort((left, right) =>
        `${right.schoolYear}-${right.term}`.localeCompare(
          `${left.schoolYear}-${left.term}`,
        ),
      );
    const readinessReports = readinessSnapshot.docs.reduce<
      Record<string, SemesterReadinessReport>
    >((reports, item) => {
      const report = normalizeReadinessReport(item.id, item.data());
      if (report) reports[report.semesterId] = report;
      return reports;
    }, {});
    const pointer = pointerSnapshot.exists() ? pointerSnapshot.data() : null;
    const activePointer =
      pointer && typeof pointer.semesterId === "string"
        ? {
            semesterId: pointer.semesterId,
            revision: Number(pointer.revision || 0),
            previousSemesterId:
              typeof pointer.previousSemesterId === "string"
                ? pointer.previousSemesterId
                : null,
            activatedAt: pointer.activatedAt,
            activatedBy: String(pointer.activatedBy || ""),
          }
        : null;

    return { manifests, readinessReports, activePointer };
  };

export const resolveSemester = (
  snapshot: SemesterCoreSnapshot,
  request: SemesterResolveRequest,
): SemesterResolveResult => {
  if (request.mode === "EXPLICIT") {
    const manifest = snapshot.manifests.find(
      (item) => item.semesterId === request.semesterId,
    );
    return manifest
      ? { ok: true, manifest, provenance: manifest.provenance }
      : { ok: false, reason: "SEMESTER_NOT_FOUND" };
  }

  if (request.mode === "PREPARING") {
    const preparing = snapshot.manifests.filter((item) =>
      ["DRAFT", "PREPARING", "VALIDATING", "READY", "FAILED"].includes(
        item.status,
      ),
    );
    if (preparing.length === 0) {
      return { ok: false, reason: "NO_PREPARING_SEMESTER" };
    }
    const manifest = preparing[0];
    return { ok: true, manifest, provenance: "PREPARING" };
  }

  const operational = snapshot.manifests.filter((item) =>
    ["ACTIVE", "CLOSING"].includes(item.status),
  );
  if (!snapshot.activePointer) {
    return operational.length === 0
      ? { ok: false, reason: "NO_ACTIVE_SEMESTER" }
      : { ok: false, reason: "CONFLICTING_ACTIVE_SEMESTER" };
  }
  if (operational.length !== 1) {
    return { ok: false, reason: "CONFLICTING_ACTIVE_SEMESTER" };
  }
  if (
    operational[0].semesterId !== snapshot.activePointer.semesterId ||
    operational[0].revision !== snapshot.activePointer.revision
  ) {
    return { ok: false, reason: "CONFLICTING_ACTIVE_SEMESTER" };
  }
  return { ok: true, manifest: operational[0], provenance: "CURRENT" };
};

export const isReadinessCurrent = (
  manifest: SemesterManifest,
  report: SemesterReadinessReport | null | undefined,
) =>
  !!report &&
  report.status === "PASS" &&
  !report.stale &&
  report.evaluatedRevision === manifest.revision &&
  report.policyVersion === manifest.readinessPolicyVersion &&
  Boolean(report.dependencyHash);

export interface ServerSemesterCoreState {
  active: SemesterManifest | null;
  preparing: SemesterManifest | null;
  requested: SemesterManifest | null;
  provenance: SemesterProvenance | null;
  readiness: {
    current: boolean;
    reason: string | null;
    dependencyHash: string | null;
  } | null;
  error:
    | null
    | "SEMESTER_NOT_FOUND"
    | "NO_ACTIVE_SEMESTER"
    | "CONFLICTING_ACTIVE_SEMESTER";
}

export const getServerSemesterCoreState = async (semesterId?: string) => {
  const callable = await getHttpsCallable<
    { semesterId?: string },
    ServerSemesterCoreState
  >("getSemesterCoreState");
  const response = await callable(semesterId ? { semesterId } : {});
  return response.data;
};
