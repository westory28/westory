import type { User } from "firebase/auth";
import type { UserData } from "../types";

export const STUDENT_MAINTENANCE_CONFIG_DOC_ID = "student_maintenance";
export const STUDENT_MAINTENANCE_ROUTE = "/maintenance";

export const DEFAULT_STUDENT_MAINTENANCE_TITLE = "위스토리 2학기 준비 중";
export const DEFAULT_STUDENT_MAINTENANCE_MESSAGE = [
  "새 학기를 위한 시스템 점검과 서비스 개편이 진행 중입니다.",
  "학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.",
  "더 안정적이고 편리한 위스토리로 다시 만나겠습니다.",
].join("\n");

export type StudentMaintenanceRole = "student" | "teacher" | "staff";

export interface StudentMaintenanceConfig {
  enabled: boolean;
  blockedRoles: StudentMaintenanceRole[];
  bypassUids: string[];
  title: string;
  message: string;
  startedAt: unknown | null;
  updatedAt: unknown | null;
  updatedBy: string;
  revision: number;
}

export type StudentMaintenanceConfigStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export type UserProfileStatus =
  | "idle"
  | "loading"
  | "ready"
  | "missing"
  | "malformed"
  | "error";

export type StudentMaintenanceAccessStatus =
  | "anonymous"
  | "checking"
  | "allowed"
  | "blocked"
  | "error";

export const DEFAULT_STUDENT_MAINTENANCE_CONFIG: StudentMaintenanceConfig = {
  enabled: false,
  blockedRoles: ["student"],
  bypassUids: [],
  title: DEFAULT_STUDENT_MAINTENANCE_TITLE,
  message: DEFAULT_STUDENT_MAINTENANCE_MESSAGE,
  startedAt: null,
  updatedAt: null,
  updatedBy: "",
  revision: 0,
};

const STUDENT_MAINTENANCE_CONFIG_KEYS = [
  "blockedRoles",
  "bypassUids",
  "enabled",
  "message",
  "revision",
  "startedAt",
  "title",
  "updatedAt",
  "updatedBy",
] as const;

const MAINTENANCE_ROLES = new Set<StudentMaintenanceRole>([
  "student",
  "teacher",
  "staff",
]);

const normalizeStringList = (value: unknown, maxItems: number) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, maxItems),
    ),
  );
};

const isFirestoreTimestamp = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { toMillis?: unknown }).toMillis === "function";

export const normalizeStudentMaintenanceConfig = (
  raw: Record<string, unknown> | null | undefined,
): StudentMaintenanceConfig => {
  if (!raw) return { ...DEFAULT_STUDENT_MAINTENANCE_CONFIG };

  if (
    Object.keys(raw).sort().join("|") !==
      STUDENT_MAINTENANCE_CONFIG_KEYS.join("|") ||
    typeof raw.enabled !== "boolean" ||
    !Array.isArray(raw.blockedRoles) ||
    !Array.isArray(raw.bypassUids) ||
    typeof raw.title !== "string" ||
    typeof raw.message !== "string" ||
    typeof raw.updatedBy !== "string" ||
    !("startedAt" in raw) ||
    !("updatedAt" in raw)
  ) {
    throw new Error("Student maintenance configuration is malformed.");
  }

  const blockedRoles = normalizeStringList(raw.blockedRoles, 3).filter(
    (role): role is StudentMaintenanceRole =>
      MAINTENANCE_ROLES.has(role as StudentMaintenanceRole),
  );
  const revision = raw.revision;
  const title = String(raw.title || "").trim();
  const message = String(raw.message || "").trim();
  const updatedBy = String(raw.updatedBy || "").trim();
  const bypassUids = normalizeStringList(raw.bypassUids, 20);

  if (
    blockedRoles.length !== 1 ||
    blockedRoles[0] !== "student" ||
    blockedRoles.length !== raw.blockedRoles.length ||
    raw.blockedRoles[0] !== "student" ||
    raw.bypassUids.some(
      (uid) =>
        typeof uid !== "string" ||
        uid !== uid.trim() ||
        !uid ||
        uid.length > 128,
    ) ||
    raw.bypassUids.length > 20 ||
    bypassUids.length !== raw.bypassUids.length ||
    !title ||
    title.length > 80 ||
    !message ||
    message.length > 500 ||
    !updatedBy ||
    (raw.startedAt !== null && !isFirestoreTimestamp(raw.startedAt)) ||
    !isFirestoreTimestamp(raw.updatedAt) ||
    (raw.enabled === true && raw.startedAt === null) ||
    (raw.enabled === false && raw.startedAt !== null) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    throw new Error("Student maintenance configuration is malformed.");
  }

  return {
    enabled: raw.enabled === true,
    blockedRoles:
      blockedRoles.length > 0
        ? blockedRoles
        : [...DEFAULT_STUDENT_MAINTENANCE_CONFIG.blockedRoles],
    bypassUids,
    title: title || DEFAULT_STUDENT_MAINTENANCE_TITLE,
    message: message || DEFAULT_STUDENT_MAINTENANCE_MESSAGE,
    startedAt: raw.startedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    updatedBy,
    revision,
  };
};

export const resolveStudentMaintenanceAccess = ({
  currentUser,
  userData,
  profileStatus,
  config,
  configStatus,
}: {
  currentUser: User | null;
  userData: UserData | null;
  profileStatus: UserProfileStatus;
  config: StudentMaintenanceConfig | null;
  configStatus: StudentMaintenanceConfigStatus;
}): StudentMaintenanceAccessStatus => {
  if (!currentUser) return "anonymous";
  if (configStatus === "error") return "error";
  if (configStatus !== "ready" || !config) return "checking";

  const email = String(currentUser.email || "")
    .trim()
    .toLowerCase();
  const isAdmin = email === "westoria28@gmail.com";
  const isBypass = config.bypassUids.includes(currentUser.uid);

  if (config.enabled && (isAdmin || isBypass)) return "allowed";
  if (profileStatus === "error") return "error";

  if (!config.enabled) {
    if (profileStatus === "loading" || profileStatus === "idle") {
      return "checking";
    }
    return "allowed";
  }

  if (
    profileStatus !== "ready" ||
    !userData ||
    userData.uid !== currentUser.uid
  ) {
    return "blocked";
  }

  return config.blockedRoles.includes(userData.role) ? "blocked" : "allowed";
};
