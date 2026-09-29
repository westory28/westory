import PortalWorkspace from "../../components/common/PortalWorkspace";
import React, { useEffect, useState } from "react";
import QuizUnitTree from "./components/QuizUnitTree";
import TeacherSubNavigation from "./components/TeacherSubNavigation";
import QuizEditor from "./components/QuizEditor";
import QuizLogTab from "./components/QuizLogTab";
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

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

const ManageQuiz: React.FC = () => {
  const { config, userData, currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"manage" | "log" | "bank">(
    "manage",
  );
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
  const canRead = canReadQuizManagement(userData, currentUser?.email || "");
  const canWrite = canWriteQuizManagement(userData, currentUser?.email || "");
  const isManageTab = activeTab === "manage";

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "log") setActiveTab("log");
    else if (requestedTab === "bank") setActiveTab("bank");
    else setActiveTab(canWrite ? "manage" : "log");
    setMobileTreeOpen(false);
  }, [canWrite, searchParams]);

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
  }, [config]);

  if (!canRead) return null;

  const handleNodeSelect = (
    node: TreeUnit,
    type: "special" | "normal",
    parent?: string,
  ) => {
    setSelectedNode(node);
    setSelectedNodeType(type);
    setParentTitle(parent || "");
    setMobileTreeOpen(false);
  };

  return (
    <PortalWorkspace
      footerActive={isManageTab && canWrite}
      className={
        isManageTab && canWrite
          ? "teacher-sub-workspace teacher-sub-workspace--page"
          : "min-h-[calc(100dvh-64px)] bg-gray-50"
      }
    >
      {canWrite && isManageTab && (
        <TeacherSubNavigation
          title="문제 등록"
          activeLabel={selectedNode?.title || "단원 및 평가 선택"}
          open={mobileTreeOpen}
          onOpenChange={setMobileTreeOpen}
        >
          <QuizUnitTree onSelect={handleNodeSelect} />
        </TeacherSubNavigation>
      )}
      <main
        className={
          isManageTab && canWrite
            ? "teacher-sub-content"
            : "w-full max-w-7xl mx-auto px-4 lg:px-6 py-4 pb-8"
        }
      >
        {!canWrite && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            읽기 전용 권한입니다. 문제 등록, 수정, 삭제는 관리자만 가능합니다.
          </div>
        )}

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

        {activeTab === "log" && (
          <div>
            <QuizLogTab />
          </div>
        )}
        {activeTab === "bank" && (
          <div>
            <QuizBankTab canEdit={canWrite} />
          </div>
        )}

        <QuizSettingsModal
          isOpen={canWrite && settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          nodeId={selectedNode?.id || ""}
          nodeTitle={selectedNode?.title || ""}
          category={settingsCategory}
          canEdit={canWrite}
        />
      </main>
    </PortalWorkspace>
  );
};

export default ManageQuiz;
