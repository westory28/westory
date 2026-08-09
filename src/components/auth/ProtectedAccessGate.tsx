import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { resolveProtectedRouteAccess } from "../../lib/accessControl";
import { isStoredSessionExpired } from "../../lib/sessionPolicy";
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
  } = useAuth();
  const location = useLocation();
  const localSessionExpired =
    authenticationStatus === "AUTHENTICATED" && isStoredSessionExpired();
  const decision = resolveProtectedRouteAccess({
    authenticationStatus: localSessionExpired
      ? "SESSION_EXPIRED"
      : authenticationStatus,
    identity: currentUser
      ? { uid: currentUser.uid, email: currentUser.email }
      : null,
    userData,
    pathname: location.pathname,
  });

  React.useEffect(() => {
    if (!localSessionExpired || !currentUser) return;
    void logout("expired");
  }, [currentUser, localSessionExpired, logout]);

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
