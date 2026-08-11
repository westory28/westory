import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  STUDENT_MAINTENANCE_ROUTE,
  type StudentMaintenanceAccessStatus,
} from "../../lib/studentMaintenance";
import {
  canAccessTeacherPortal,
  getDefaultTeacherRoute,
} from "../../lib/permissions";
import { PageLoading } from "./LoadingState";
import Maintenance from "../../pages/student/Maintenance";

const PUBLIC_PATHS = new Set(["/", STUDENT_MAINTENANCE_ROUTE]);

const isChecking = (status: StudentMaintenanceAccessStatus) =>
  status === "checking";

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
  const isMaintenanceRoute = location.pathname === STUDENT_MAINTENANCE_ROUTE;

  if (!currentUser) {
    if (!PUBLIC_PATHS.has(location.pathname)) {
      return <Navigate to="/" replace />;
    }
    return <>{children}</>;
  }

  if (isChecking(studentMaintenanceAccessStatus)) {
    return <PageLoading message="접속 상태를 확인하는 중입니다." />;
  }

  if (
    studentMaintenanceAccessStatus === "blocked" ||
    studentMaintenanceAccessStatus === "error"
  ) {
    if (!isMaintenanceRoute) {
      return <Navigate to={STUDENT_MAINTENANCE_ROUTE} replace />;
    }

    return (
      <Maintenance
        config={studentMaintenanceConfig}
        unavailable={studentMaintenanceAccessStatus === "error"}
      />
    );
  }

  if (isMaintenanceRoute) {
    const target = canAccessTeacherPortal(userData, currentUser.email)
      ? getDefaultTeacherRoute(userData, currentUser.email)
      : "/student/dashboard";
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};

export default StudentMaintenanceGate;
