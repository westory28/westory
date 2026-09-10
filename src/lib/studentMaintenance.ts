import type { User } from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./firebase";
import { ADMIN_EMAIL } from "./permissions";
import type { UserData } from "../types";

export const STUDENT_MAINTENANCE_CONFIG_DOC_ID = "student_maintenance";
export const STUDENT_MAINTENANCE_ROUTE = "/maintenance";

export const DEFAULT_STUDENT_MAINTENANCE_TITLE = "위스토리 2학기 준비 중";
export const DEFAULT_STUDENT_MAINTENANCE_MESSAGE = [
  "새 학기를 위한 시스템 점검과 서비스 개편이 진행 중입니다.",
  "학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.",
  "더 안정적이고 편리한 위스토리로 다시 만나겠습니다.",
].join("\n");

export type StudentMaintenanceRole = UserData["role"];
export type StudentMaintenanceAccessStatus =
  | "anonymous"
  | "checking"
  | "allowed"
  | "blocked"
  | "error";

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

export interface StudentMaintenanceBootstrap {
  config: StudentMaintenanceConfig;
  profile: UserData | null;
  profileStatus: "ready" | "missing" | "malformed";
  accessStatus: Exclude<
    StudentMaintenanceAccessStatus,
    "anonymous" | "checking"
  >;
}

const BOOTSTRAP_DEDUPE_MS = 2_000;
const bootstrapCache = new Map<
  string,
  {
    promise?: Promise<StudentMaintenanceBootstrap>;
    result?: StudentMaintenanceBootstrap;
    resolvedAt?: number;
  }
>();

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

const CONFIG_KEYS = [
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

const isFirestoreTimestamp = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as { toMillis?: unknown }).toMillis === "function";

export const normalizeStudentMaintenanceConfig = (
  raw: Record<string, unknown> | null | undefined,
): StudentMaintenanceConfig => {
  if (!raw) return { ...DEFAULT_STUDENT_MAINTENANCE_CONFIG };

  const rawKeys = Object.keys(raw).sort();
  const bypassUids = raw.bypassUids;
  const blockedRoles = raw.blockedRoles;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const updatedBy =
    typeof raw.updatedBy === "string" ? raw.updatedBy.trim() : "";

  const malformed =
    rawKeys.join("|") !== CONFIG_KEYS.join("|") ||
    typeof raw.enabled !== "boolean" ||
    !Array.isArray(blockedRoles) ||
    blockedRoles.length !== 1 ||
    blockedRoles[0] !== "student" ||
    !Array.isArray(bypassUids) ||
    bypassUids.length > 20 ||
    new Set(bypassUids).size !== bypassUids.length ||
    bypassUids.some(
      (uid) =>
        typeof uid !== "string" ||
        uid !== uid.trim() ||
        uid.length === 0 ||
        uid.length > 128,
    ) ||
    !title ||
    raw.title !== title ||
    title.length > 80 ||
    !message ||
    raw.message !== message ||
    message.length > 500 ||
    !updatedBy ||
    raw.updatedBy !== updatedBy ||
    !(raw.startedAt === null || isFirestoreTimestamp(raw.startedAt)) ||
    !isFirestoreTimestamp(raw.updatedAt) ||
    (raw.enabled === true && raw.startedAt === null) ||
    (raw.enabled === false && raw.startedAt !== null) ||
    typeof raw.revision !== "number" ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0;

  if (malformed) {
    throw new Error("Student maintenance configuration is malformed.");
  }

  return {
    enabled: raw.enabled as boolean,
    blockedRoles: ["student"],
    bypassUids: [...(bypassUids as string[])],
    title,
    message,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    updatedBy,
    revision: raw.revision as number,
  };
};

const normalizeBootstrapProfile = (
  user: User,
  raw: Record<string, unknown> | null,
): Pick<StudentMaintenanceBootstrap, "profile" | "profileStatus"> => {
  if (!raw) return { profile: null, profileStatus: "missing" };
  if (
    raw.role !== "student" &&
    raw.role !== "teacher" &&
    raw.role !== "staff"
  ) {
    return { profile: null, profileStatus: "malformed" };
  }
  return {
    profile: {
      ...(raw as unknown as UserData),
      uid: user.uid,
      email: String(raw.email || user.email || ""),
      role: raw.role,
    },
    profileStatus: "ready",
  };
};

export const resolveStudentMaintenanceAccess = ({
  user,
  config,
  profile,
  profileStatus,
}: {
  user: User;
  config: StudentMaintenanceConfig;
  profile: UserData | null;
  profileStatus: StudentMaintenanceBootstrap["profileStatus"];
}): StudentMaintenanceBootstrap["accessStatus"] => {
  if (!config.enabled) return "allowed";
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  if (email === ADMIN_EMAIL || config.bypassUids.includes(user.uid)) {
    return "allowed";
  }
  if (profileStatus !== "ready" || !profile || profile.uid !== user.uid) {
    return "blocked";
  }
  return config.blockedRoles.includes(profile.role) ? "blocked" : "allowed";
};

const loadStudentMaintenanceBootstrap = async (
  user: User,
): Promise<StudentMaintenanceBootstrap> => {
  try {
    const maintenanceRef = doc(
      db,
      "site_settings",
      STUDENT_MAINTENANCE_CONFIG_DOC_ID,
    );
    const profileRef = doc(db, "users", user.uid);
    const [maintenanceSnap, profileSnap] = await Promise.all([
      getDocFromServer(maintenanceRef),
      getDocFromServer(profileRef),
    ]);
    const config = normalizeStudentMaintenanceConfig(
      maintenanceSnap.exists()
        ? (maintenanceSnap.data() as Record<string, unknown>)
        : null,
    );
    const { profile, profileStatus } = normalizeBootstrapProfile(
      user,
      profileSnap.exists()
        ? (profileSnap.data() as Record<string, unknown>)
        : null,
    );
    return {
      config,
      profile,
      profileStatus,
      accessStatus: resolveStudentMaintenanceAccess({
        user,
        config,
        profile,
        profileStatus,
      }),
    };
  } catch (error) {
    console.error("Failed to verify student maintenance access", error);
    return {
      config: DEFAULT_STUDENT_MAINTENANCE_CONFIG,
      profile: null,
      profileStatus: "malformed",
      accessStatus: "error",
    };
  }
};

export const invalidateStudentMaintenanceBootstrap = (uid: string) => {
  bootstrapCache.delete(uid);
};

export const readStudentMaintenanceBootstrap = (
  user: User,
): Promise<StudentMaintenanceBootstrap> => {
  const cached = bootstrapCache.get(user.uid);
  if (cached?.promise) return cached.promise;
  if (
    cached?.result &&
    cached.resolvedAt &&
    Date.now() - cached.resolvedAt <= BOOTSTRAP_DEDUPE_MS
  ) {
    return Promise.resolve(cached.result);
  }

  const promise = loadStudentMaintenanceBootstrap(user).then((result) => {
    // A read started before reauthentication must not repopulate the cache
    // after a newer epoch has invalidated or replaced its flight.
    if (bootstrapCache.get(user.uid)?.promise === promise) {
      bootstrapCache.set(user.uid, { result, resolvedAt: Date.now() });
    }
    return result;
  });
  bootstrapCache.set(user.uid, { promise });
  return promise;
};
