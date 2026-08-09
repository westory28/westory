import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { resolveProtectedRouteAccess } from "../../lib/accessControl";
import { isAdminUser } from "../../lib/permissions";
import {
  clearSessionTiming,
  isStoredSessionExpired,
  resolveSessionPolicy,
  shouldEnforceClientIdleSession,
  writeSessionReturnPath,
} from "../../lib/sessionPolicy";
import { ProtectedAccessBoundary } from "./ProtectedAccessBoundary";

const ProtectedAccessGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    authenticationStatus,
    authenticationError,
    currentUser,
    userData,
    logout,
    applicationSessionAuthorityMode,
  } = useAuth();
  const location = useLocation();
  const sessionPolicy = resolveSessionPolicy(
    location.pathname,
    isAdminUser(userData, currentUser?.email),
  );
  const localSessionExpired =
    shouldEnforceClientIdleSession(applicationSessionAuthorityMode) &&
    authenticationStatus === "AUTHENTICATED" &&
    isStoredSessionExpired(sessionPolicy);
  const effectiveAuthenticationStatus =
    authenticationStatus === "AUTHENTICATED" &&
    applicationSessionAuthorityMode === null
      ? "AUTHENTICATING"
      : localSessionExpired
        ? "SESSION_EXPIRED"
        : authenticationStatus;
  const decision = resolveProtectedRouteAccess({
    authenticationStatus: effectiveAuthenticationStatus,
    identity: currentUser
      ? { uid: currentUser.uid, email: currentUser.email }
      : null,
    userData,
    pathname: location.pathname,
  });

  React.useEffect(() => {
    if (!localSessionExpired || !currentUser) return;
    writeSessionReturnPath(currentUser.uid, location.pathname, location.search);
    clearSessionTiming();
    void logout("expired");
  }, [
    currentUser,
    localSessionExpired,
    location.pathname,
    location.search,
    logout,
  ]);

  return (
    <ProtectedAccessBoundary
      decision={decision}
      authenticationError={authenticationError}
    >
      {children}
    </ProtectedAccessBoundary>
  );
};

export default ProtectedAccessGate;
