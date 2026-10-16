import PortalWorkspace from "../../components/common/PortalWorkspace";
import React, { useEffect, useState } from "react";
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
  const { config, userData, currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<
    "special" | "normal"
  >("normal");
  const [parentTitle, setParentTitle] = useState("");
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState("diagnostic");
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [sourceQuestion, setSourceQuestion] =
    useState<QuizQuestionDraft | null>(null);
  const canRead = canReadQuizManagement(userData, currentUser?.email || "");
  const canWrite = canWriteQuizManagement(userData, currentUser?.email || "");
  const requestedTab = searchParams.get("tab");
  const activeTab =
    canWrite && !["analysis", "bank", "log"].includes(requestedTab || "")
      ? "manage"
      : "analysis";
  const isManageTab = activeTab === "manage";

  useEffect(() => {
    setMobileTreeOpen(false);
    if (requestedTab === "bank" || requestedTab === "log") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", "analysis");
      setSearchParams(nextParams, { replace: true });
    }
  }, [requestedTab, searchParams, setSearchParams]);

  useEffect(() => {
    const loadTree = async () => {
      try {
        const semesterTree = await getDoc(
          doc(db, getSemesterDocPath(config, "curriculum", "tree")),
        );
        if (semesterTree.exists()) {
          setTreeData(semesterTree.data().tree || []);
          return;
        }

        const legacyTree = await getDoc(doc(db, "curriculum", "tree"));
        if (legacyTree.exists()) {
          setTreeData(legacyTree.data().tree || []);
        }
      } catch (error) {
        console.error(error);
      }
    };
    void loadTree();
  }, [config?.year, config?.semester]);

  if (!canRead) return null;

  const handleNodeSelect = (
    node: TreeUnit,
    type: "special" | "normal",
    parent?: string,
  ) => {
    setSourceQuestion(null);
    setSelectedNode(node);
    setSelectedNodeType(type);
    setParentTitle(parent || "");
    setMobileTreeOpen(false);
  };

  const openDerivedQuestion = (question: QuizQuestionDraft) => {
    const parent = treeData.find((big) =>
      big.children?.some((mid) => mid.id === question.unitId),
    );
    const unit = parent?.children?.find((mid) => mid.id === question.unitId);
    setSelectedNode(
      unit || {
        id: question.unitId,
        title: question.category === "exam_prep" ? "모의고사" : "선택 단원",
      },
    );
    setSelectedNodeType(
      question.category === "exam_prep" ? "special" : "normal",
    );
    setParentTitle(parent?.title || "");
    setSourceQuestion(question);
    setSearchParams({ tab: "manage" });
  };

  return (
    <PortalWorkspace
      footerActive={isManageTab && canWrite}
      className={
        isManageTab && canWrite
          ? "teacher-sub-workspace teacher-sub-workspace--page quiz-workspace"
          : "min-h-[calc(100dvh-64px)] bg-gray-50"
      }
    >
      {canWrite && isManageTab && (
        <TeacherSubNavigation
          className="quiz-navigation"
          title="문제 등록"
          activeLabel={selectedNode?.title || "단원 및 평가 선택"}
          open={mobileTreeOpen}
          onOpenChange={setMobileTreeOpen}
        >
          <QuizUnitTree
            onSelect={handleNodeSelect}
            selectedId={selectedNode?.id}
          />
        </TeacherSubNavigation>
      )}
      <main
        className={
          isManageTab && canWrite
            ? "teacher-sub-content"
            : "w-full max-w-7xl mx-auto px-4 lg:px-6 py-4 pb-8"
        }
      >
        <header className="quiz-workspace-header">
          <h1 className="text-2xl font-extrabold text-gray-900">평가 관리</h1>
          <nav className="quiz-workspace-tabs" aria-label="평가 관리 보기">
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
                className={`quiz-workspace-tab${activeTab === tab.id ? " is-active" : ""}`}
                onClick={() => {
                  setSourceQuestion(null);
                  setSearchParams({ tab: tab.id });
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

        {activeTab === "analysis" && (
          <div>
            <QuizBankTab
              canEdit={canWrite}
              onDeriveQuestion={openDerivedQuestion}
            />
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
