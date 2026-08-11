import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { STUDENT_MAINTENANCE_ROUTE } from "../../lib/studentMaintenance";
import { auth } from "../../lib/firebase";
import {
  canAccessTeacherPortal,
  getDefaultTeacherRoute,
} from "../../lib/permissions";
import { PageLoading } from "../common/LoadingState";

const Maintenance = React.lazy(() => import("../../pages/student/Maintenance"));

const StudentMaintenanceGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    currentUser,
    userData,
    studentMaintenanceConfig,
    studentMaintenanceAccessStatus,
  } = useAuth();
  const location = useLocation();
  const maintenanceRoute = location.pathname === STUDENT_MAINTENANCE_ROUTE;

  if (!currentUser) {
    if (maintenanceRoute && auth.currentUser) {
      return <PageLoading message="점검 상태를 확인하고 있습니다." />;
    }
    return maintenanceRoute ? <Navigate to="/" replace /> : <>{children}</>;
  }

  if (studentMaintenanceAccessStatus === "checking") {
    return <PageLoading message="접속 가능 상태를 확인하고 있습니다." />;
  }

  const blocked =
    studentMaintenanceAccessStatus === "blocked" ||
    studentMaintenanceAccessStatus === "error";
  if (blocked) {
    if (!maintenanceRoute) {
      return <Navigate to={STUDENT_MAINTENANCE_ROUTE} replace />;
    }
    return (
      <React.Suspense
        fallback={<PageLoading message="점검 안내를 준비하고 있습니다." />}
      >
        <Maintenance
          config={studentMaintenanceConfig}
          unavailable={studentMaintenanceAccessStatus === "error"}
        />
      </React.Suspense>
    );
  }

  if (maintenanceRoute) {
    const target = canAccessTeacherPortal(userData, currentUser.email)
      ? getDefaultTeacherRoute(userData, currentUser.email)
      : "/student/dashboard";
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};

export default StudentMaintenanceGate;
