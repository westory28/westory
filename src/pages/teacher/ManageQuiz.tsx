import PortalWorkspace from "../../components/common/PortalWorkspace";
import React, { useEffect, useId, useState } from "react";
import TeacherNavigationIcon from "../../components/layout/TeacherNavigationIcon";
import QuizUnitTree from "./components/QuizUnitTree";
import TeacherSubNavigation from "./components/TeacherSubNavigation";
import QuizEditor, { type QuizQuestionDraft } from "./components/QuizEditor";
import QuizBankTab from "./components/QuizBankTab";
import QuizSettingsModal from "./components/QuizSettingsModal";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getSemesterDocPath } from "../../lib/semesterScope";
import {
  canReadQuizManagement,
  canWriteQuizManagement,
} from "../../lib/permissions";
import "./components/QuizWorkspace.css";

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

const ManageQuiz: React.FC = () => {
  const { config, userData, currentUser, authGeneration } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const identityKey = `${currentUser?.uid || ""}:${authGeneration}:${config?.year}:${config?.semester}`;
  const [treeState, setTreeState] = useState<{
    identity: string;
    data: TreeUnit[];
    loading: boolean;
    error: boolean;
  }>({ identity: "", data: [], loading: true, error: false });
  const [treeVersion, setTreeVersion] = useState(0);
  const treeData = treeState.identity === identityKey ? treeState.data : [];
  const treeLoading = treeState.identity !== identityKey || treeState.loading;
  const requestedUnitId = searchParams.get("unitId") || "";
  const parent = treeData.find((big) =>
    big.children?.some((mid) => mid.id === requestedUnitId),
  );
  const selectedNode =
    requestedUnitId === "exam_prep"
      ? { id: "exam_prep", title: "모의고사" }
      : parent?.children?.find((mid) => mid.id === requestedUnitId) || null;
  const selectedNodeType =
    selectedNode?.id === "exam_prep" ? "special" : "normal";
  const parentTitle = parent?.title || "";
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState("diagnostic");
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treeId = useId();
  const [sourceQuestion, setSourceQuestion] =
    useState<QuizQuestionDraft | null>(null);
  const canRead = canReadQuizManagement(userData, currentUser?.email || "");
  const canWrite = canWriteQuizManagement(userData, currentUser?.email || "");
  const requestedTab = searchParams.get("tab");
  const activeTab =
    canWrite && !["analysis", "bank", "log"].includes(requestedTab || "")
      ? "manage"
      : "analysis";

  useEffect(() => {
    setMobileTreeOpen(false);
    if (requestedTab === "bank" || requestedTab === "log") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", "analysis");
      setSearchParams(nextParams, { replace: true });
    }
  }, [requestedTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setTreeState({
      identity: identityKey,
      data: [],
      loading: true,
      error: false,
    });
    const loadTree = async () => {
      try {
        const semesterTree = await getDoc(
          doc(db, getSemesterDocPath(config, "curriculum", "tree")),
        );
        if (!active) return;
        if (semesterTree.exists()) {
          setTreeState({
            identity: identityKey,
            data: semesterTree.data().tree || [],
            loading: false,
            error: false,
          });
          return;
        }

        const legacyTree = await getDoc(doc(db, "curriculum", "tree"));
        if (active)
          setTreeState({
            identity: identityKey,
            data: legacyTree.exists() ? legacyTree.data().tree || [] : [],
            loading: false,
            error: false,
          });
      } catch (error) {
        if (active)
          setTreeState({
            identity: identityKey,
            data: [],
            loading: false,
            error: true,
          });
        console.error(error);
      }
    };
    void loadTree();
    return () => {
      active = false;
    };
  }, [identityKey, canRead, treeVersion]);

  if (!canRead) return null;

  const handleNodeSelect = (node: TreeUnit, type: "special" | "normal") => {
    setSourceQuestion(null);
    const nextParams = new URLSearchParams({ tab: activeTab, unitId: node.id });
    if (type === "special") nextParams.set("category", "exam_prep");
    setSearchParams(nextParams);
    setMobileTreeOpen(false);
  };

  const openDerivedQuestion = (question: QuizQuestionDraft) => {
    setSourceQuestion(question);
    setSearchParams({
      tab: "manage",
      unitId: question.unitId,
      category: question.category,
    });
  };

  return (
    <PortalWorkspace
      className={`teacher-sub-workspace teacher-sub-workspace--page quiz-workspace${treeCollapsed ? " quiz-workspace--tree-collapsed" : ""}`}
    >
      <TeacherSubNavigation
        className="quiz-navigation"
        title="평가 목차"
        activeLabel={selectedNode?.title || "단원 및 평가 선택"}
        open={mobileTreeOpen}
        onOpenChange={setMobileTreeOpen}
      >
        <div id={treeId} className="quiz-navigation-tree">
          <QuizUnitTree
            onSelect={handleNodeSelect}
            selectedId={selectedNode?.id}
            treeData={treeData}
            loading={treeLoading}
            loadError={treeState.identity === identityKey && treeState.error}
            onRetry={() => setTreeVersion((value) => value + 1)}
          />
        </div>
        <button
          type="button"
          className="quiz-navigation-collapse"
          aria-label={`평가 목차 ${treeCollapsed ? "펼치기" : "접기"}`}
          title={`평가 목차 ${treeCollapsed ? "펼치기" : "접기"}`}
          aria-expanded={!treeCollapsed}
          aria-controls={treeId}
          onClick={() => setTreeCollapsed((value) => !value)}
        >
          <TeacherNavigationIcon name="chevron" />
        </button>
      </TeacherSubNavigation>
      <main className="teacher-sub-content">
        <header className="quiz-workspace-header">
          <h1 className="text-2xl font-extrabold text-gray-900">평가 관리</h1>
          <nav className="ws-page-tabs mt-4" aria-label="평가 관리 보기">
            {[
              ...(canWrite
                ? [
                    {
                      id: "manage",
                      label: "문제 등록",
                      icon: "fa-pen-to-square",
                    },
                  ]
                : []),
              { id: "analysis", label: "평가 분석", icon: "fa-chart-simple" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={activeTab === tab.id ? "is-active" : ""}
                onClick={() => {
                  setSourceQuestion(null);
                  const nextParams = new URLSearchParams({ tab: tab.id });
                  if (selectedNode) {
                    nextParams.set("unitId", selectedNode.id);
                    if (selectedNodeType === "special")
                      nextParams.set("category", "exam_prep");
                  }
                  setSearchParams(nextParams);
                }}
              >
                <i className={`fas ${tab.icon}`} aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </nav>
        </header>
        {canWrite && activeTab === "manage" && (
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 flex-col">
              {selectedNode ? (
                <QuizEditor
                  node={selectedNode}
                  type={selectedNodeType}
                  parentTitle={parentTitle}
                  treeData={treeData}
                  canEdit={canWrite}
                  sourceQuestion={sourceQuestion}
                  onOpenSettings={(cat) => {
                    setSettingsCategory(cat);
                    setSettingsModalOpen(true);
                  }}
                />
              ) : (
                <div className="h-full min-h-[520px] py-16 flex flex-col items-center justify-center text-gray-400">
                  <i className="fas fa-mouse-pointer text-4xl mb-4"></i>
                  <p className="text-lg text-center">
                    모의고사 또는 중단원을 선택해 주세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "analysis" && selectedNode && (
          <div className="quiz-analysis-content">
            <div className="quiz-analysis-unit-heading">
              {parentTitle && <p>{parentTitle}</p>}
              <h2>{selectedNode.title}</h2>
            </div>
            <QuizBankTab
              initialUnitId={selectedNode.id}
              initialCategory={searchParams.get("category") || ""}
              unitScoped
              canEdit={canWrite}
              onDeriveQuestion={openDerivedQuestion}
            />
          </div>
        )}
        {activeTab === "analysis" && !selectedNode && (
          <div className="h-full min-h-[520px] py-16 flex flex-col items-center justify-center text-gray-400">
            <i
              className="fas fa-mouse-pointer text-4xl mb-4"
              aria-hidden="true"
            />
            <p className="text-lg text-center">
              모의고사 또는 중단원을 선택해 주세요.
            </p>
          </div>
        )}

        {canWrite && settingsModalOpen && (
          <QuizSettingsModal
            key={`${selectedNode?.id || ""}:${settingsCategory}`}
            isOpen={canWrite && settingsModalOpen}
            onClose={() => setSettingsModalOpen(false)}
            nodeId={selectedNode?.id || ""}
            nodeTitle={selectedNode?.title || ""}
            category={settingsCategory}
            canEdit={canWrite}
          />
        )}
      </main>
    </PortalWorkspace>
  );
};

export default ManageQuiz;
