import type { AuthenticationStatus } from "../contexts/AuthContext";
import type { UserData } from "../types";
import {
  canAccessTeacherPath,
  getDefaultTeacherRoute,
  isAllowedWestoryEmail,
} from "./permissions";

export type AccessGateStatus =
  | "UNKNOWN"
  | "AUTHENTICATING"
  | "AUTHORIZED"
  | "UNAUTHORIZED"
  | "SESSION_EXPIRED"
  | "ERROR";

export type AccessDenialReason =
  | "AUTHENTICATION_REQUIRED"
  | "EMAIL_NOT_ALLOWED"
  | "PROFILE_NOT_READY"
  | "ROUTE_NOT_ALLOWED";

export interface AccessIdentity {
  uid: string;
  email?: string | null;
}

export interface ProtectedRouteAccessInput {
  authenticationStatus: AuthenticationStatus;
  identity: AccessIdentity | null;
  userData: UserData | null;
  pathname: string;
}

export interface ProtectedRouteAccessDecision {
  status: AccessGateStatus;
  reason?: AccessDenialReason;
  safeRoute?: string;
}

const getSafeRoute = (userData: UserData | null, email?: string | null) => {
  if (!userData || userData.role === "student") return "/student/dashboard";
  return getDefaultTeacherRoute(userData, email);
};

export const resolveProtectedRouteAccess = ({
  authenticationStatus,
  identity,
  userData,
  pathname,
}: ProtectedRouteAccessInput): ProtectedRouteAccessDecision => {
  if (authenticationStatus === "UNKNOWN") {
    return { status: "UNKNOWN" };
  }

  if (authenticationStatus === "AUTHENTICATING") {
    return { status: "AUTHENTICATING" };
  }

  if (authenticationStatus === "SESSION_EXPIRED") {
    return { status: "SESSION_EXPIRED" };
  }

  if (authenticationStatus === "ERROR") {
    return { status: "ERROR" };
  }

  if (authenticationStatus === "ANONYMOUS" || !identity) {
    return {
      status: "UNAUTHORIZED",
      reason: "AUTHENTICATION_REQUIRED",
      safeRoute: "/",
    };
  }

  if (!isAllowedWestoryEmail(identity.email)) {
    return {
      status: "UNAUTHORIZED",
      reason: "EMAIL_NOT_ALLOWED",
      safeRoute: "/",
    };
  }

  if (!userData || userData.uid !== identity.uid) {
    return {
      status: "AUTHENTICATING",
      reason: "PROFILE_NOT_READY",
    };
  }

  if (
    pathname.startsWith("/teacher") &&
    !canAccessTeacherPath(pathname, userData, identity.email)
  ) {
    return {
      status: "UNAUTHORIZED",
      reason: "ROUTE_NOT_ALLOWED",
      safeRoute: getSafeRoute(userData, identity.email),
    };
  }

  return { status: "AUTHORIZED" };
};
