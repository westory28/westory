import React from "react";

export type TeacherIconName =
  | "home"
  | "lesson"
  | "assessment"
  | "score"
  | "wis"
  | "students"
  | "calendar"
  | "notice"
  | "shop"
  | "dictionary"
  | "settings"
  | "chevron"
  | "collapse"
  | "menu"
  | "close";

const paths: Record<Exclude<TeacherIconName, "wis">, React.ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  lesson: (
    <>
      <rect x="7" y="3" width="13" height="15" rx="2" />
      <path d="M16 18v2a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m4 1h5m-5 4h5m-5 4h3" />
    </>
  ),
  assessment: (
    <>
      <path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M8 11l2 2 4-4m-6 8h6m1-11 4-4 3 3-4 4-4 1Z" />
    </>
  ),
  score: (
    <>
      <path d="M3 3v18h18M7 17v-5m5 5V8m5 9v-7M6 7l5-4 5 2 5-3" />
    </>
  ),
  students: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3Zm14-16a3 3 0 0 1 0 6m2 10h2v-3a6 6 0 0 0-4-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18" />
    </>
  ),
  notice: (
    <>
      <path d="m4 10 5-1 11-5v16L9 15l-5-1Zm5 5 2 6H7l-2-7m18-4v4" />
    </>
  ),
  shop: (
    <>
      <path d="M4 9h16v12H4ZM3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 21v-6h6v6" />
    </>
  ),
  dictionary: (
    <>
      <path d="M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16M6 8h3m-3 4h3m6-4h3m-3 4h3" />
    </>
  ),
  settings: (
    <>
      <path
        d="m9 3-.5 2-2 .9-1.8-.6-2 3.4L4.2 10v2l-1.5 1.3 2 3.4 1.8-.6 2 .9.5 2h4l.5-2 2-.9 1.8.6 2-3.4-1.5-1.3v-2l1.5-1.3-2-3.4-1.8.6-2-.9L13 3Z"
        transform="translate(1 1)"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  collapse: (
    <>
      <path d="m13 7-5 5 5 5m6-10-5 5 5 5" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};

const TeacherNavigationIcon: React.FC<{
  name: TeacherIconName;
  className?: string;
}> = ({ name, className = "" }) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={`teacher-nav-icon ${className}`}
  >
    {name === "wis" ? (
      <>
        <circle cx="12" cy="12" r="9" />
        <path
          d="m5.7 8 1.8 8 2.2-5 2.1 5 1.8-8m4.9 3c-3-1.1-4.1 1.2-1.9 2s1.4 3-1.3 2.1"
          strokeWidth="1.5"
        />
      </>
    ) : (
      paths[name]
    )}
  </svg>
);

export default TeacherNavigationIcon;
