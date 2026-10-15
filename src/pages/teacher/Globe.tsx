import React from "react";
import { Navigate } from "react-router-dom";

export default function TeacherGlobe() {
  return <Navigate to="/teacher/lesson/maps?view=globe" replace />;
}
