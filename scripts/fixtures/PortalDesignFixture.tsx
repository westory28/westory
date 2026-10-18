import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, useLocation } from "react-router-dom";
import Header from "../../src/components/common/Header";
import PortalSubNavigation from "../../src/components/common/PortalSubNavigation";
import PortalWorkspace, {
  PortalWorkspaceFooterProvider,
} from "../../src/components/common/PortalWorkspace";
import HistoryMaps from "../../src/components/common/HistoryMaps";
import Settings from "../../src/pages/teacher/Settings";
import { historyAtlasDataset } from "../../src/data/historyAtlasContent";
import "../../src/assets/index.css";
import "../../src/components/layout/teacherLayout.css";
import "../../src/components/layout/studentLayout.css";
import "../../src/pages/teacher/teacherSettings.css";

const labels = [
  "기본 설정",
  "등록된 자료와 학생의 학습 기록을 확인하는 긴 한글 메뉴",
  "표시 설정",
  "접근 권한",
  "지난 기록",
];

function NavigationFixture({ tree = false }: { tree?: boolean }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  return (
    <PortalWorkspace
      className={`teacher-sub-workspace${tree ? "" : " teacher-sub-workspace--tabs"}`}
    >
      <PortalSubNavigation
        title={tree ? "수업 자료" : "자료 설정"}
        activeLabel={labels[active]}
        variant={tree ? "tree" : "tabs"}
        open={open}
        onOpenChange={setOpen}
      >
        {tree ? (
          <>
            <button
              type="button"
              className="teacher-settings-section"
              aria-expanded={branchOpen}
              onClick={() => setBranchOpen(!branchOpen)}
            >
              한국사의 전개
            </button>
            {branchOpen && (
              <button
                type="button"
                className="teacher-settings-section"
                aria-current={active === 1 ? "page" : undefined}
                onClick={() => {
                  setActive(1);
                  setOpen(false);
                }}
              >
                {labels[1]}
              </button>
            )}
          </>
        ) : (
          labels.map((label, index) => (
            <button
              type="button"
              key={label}
              className={`teacher-settings-section${active === index ? " is-active" : ""}`}
              aria-current={active === index ? "page" : undefined}
              onClick={() => {
                setActive(index);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))
        )}
      </PortalSubNavigation>
      <section className="teacher-sub-content">
        <header className="ws-page-header">
          <h1>학습 자료</h1>
        </header>
        <div className="ws-filter-bar">
          <label>
            검색
            <input aria-label="자료 검색" defaultValue="긴 한글 수업 자료" />
          </label>
        </div>
        <section className="ws-surface">
          <h2>선택한 자료</h2>
          <p data-testid="selected">{labels[active]}</p>
          <button type="button">자료 열기</button>
        </section>
      </section>
    </PortalWorkspace>
  );
}

function Fixture() {
  const location = useLocation();
  const portal = location.pathname.startsWith("/student")
    ? "student"
    : "teacher";
  const [collapsed, setCollapsed] = useState(false);
  const kind = new URLSearchParams(window.location.search).get("kind") || "map";
  return (
    <PortalWorkspaceFooterProvider>
      <div
        className={`flex min-h-screen flex-col bg-gray-50 ${portal}-layout${collapsed ? " is-sidebar-collapsed" : ""}`}
      >
        <Header
          teacherLayout={portal === "teacher"}
          studentLayout={portal === "student"}
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed(!collapsed)}
        />
        <main className="min-h-0 w-full flex-1">
          {kind === "settings" ? (
            <Settings />
          ) : kind === "map" ? (
            <PortalWorkspace as="div" className="history-atlas-page">
              <HistoryMaps dataset={historyAtlasDataset} />
            </PortalWorkspace>
          ) : (
            <NavigationFixture tree={kind === "tree"} />
          )}
        </main>
      </div>
    </PortalWorkspaceFooterProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Fixture />
  </HashRouter>,
);
