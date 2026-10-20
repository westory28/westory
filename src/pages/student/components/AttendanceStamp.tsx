import React from "react";
import "./attendanceStamp.css";

const AttendanceStamp = ({ date }: { date?: string }) => (
  <span
    className="student-attendance-stamp"
    role="img"
    aria-label={date ? `${date} 출석 완료` : "출석 완료"}
    title={date ? `${date} 출석 완료` : "출석 완료"}
  >
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 8 2.5 2.5L12 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export default AttendanceStamp;
