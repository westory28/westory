import React from "react";
import attendanceStamp from "../../../assets/attendance-stamp.webp";
import "./attendanceStamp.css";

const AttendanceStamp = ({ date }: { date?: string }) => (
  <img
    className="student-attendance-stamp"
    src={attendanceStamp}
    width={36}
    height={24}
    alt={date ? `${date} 출석 완료` : "출석 완료"}
    draggable={false}
  />
);

export default AttendanceStamp;
