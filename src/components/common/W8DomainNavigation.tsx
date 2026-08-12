import React from "react";
import { Link, useLocation } from "react-router-dom";

type W8DomainNavigationProps = {
  audience: "student" | "teacher";
};

const STUDENT_ITEMS = [
  { label: "나의 학습", to: "/student/learning" },
  { label: "일정", to: "/student/schedule" },
  { label: "출석", to: "/student/attendance" },
  { label: "공지", to: "/student/communication" },
];

const TEACHER_ITEMS = [
  { label: "학습 운영", to: "/teacher/learning" },
  { label: "일정", to: "/teacher/schedule" },
  { label: "출석", to: "/teacher/attendance" },
  { label: "공지 운영", to: "/teacher/communication" },
];

const W8DomainNavigation: React.FC<W8DomainNavigationProps> = ({
  audience,
}) => {
  const location = useLocation();
  const items = audience === "student" ? STUDENT_ITEMS : TEACHER_ITEMS;
  const routeContext = new URLSearchParams();
  const currentParams = new URLSearchParams(location.search);
  ["semesterId", "source"].forEach((key) => {
    const value = currentParams.get(key);
    if (value) routeContext.set(key, value);
  });
  const routeSearch = routeContext.toString();

  return (
    <nav className="w8-domain-nav" aria-label="학습과 학교생활 메뉴">
      {items.map((item) => {
        const active =
          location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={`${item.to}${routeSearch ? `?${routeSearch}` : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default W8DomainNavigation;
