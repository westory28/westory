import React from "react";
import { NavLink } from "react-router-dom";

const tabs = [
  { label: "성적 계산기", to: "/student/score" },
  { label: "성적 리포트", to: "/student/score/report" },
];

const ScoreSubTabs: React.FC = () => (
  <nav className="mb-6 flex w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
    {tabs.map((tab) => (
      <NavLink
        key={tab.to}
        to={tab.to}
        end={tab.to === "/student/score"}
        className={({ isActive }) =>
          `flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-extrabold transition ${
            isActive
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"
          }`
        }
      >
        {tab.label}
      </NavLink>
    ))}
  </nav>
);

export default ScoreSubTabs;
