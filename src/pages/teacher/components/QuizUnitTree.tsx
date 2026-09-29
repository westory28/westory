import React, { useEffect, useState } from "react";
import { db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../../../contexts/AuthContext";
import { getSemesterDocPath } from "../../../lib/semesterScope";

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

interface QuizUnitTreeProps {
  onSelect: (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => void;
}

const QuizUnitTree: React.FC<QuizUnitTreeProps> = ({ onSelect }) => {
  const { config } = useAuth();
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const loadTree = async () => {
      try {
        const scopedTree = await getDoc(
          doc(db, getSemesterDocPath(config, "curriculum", "tree")),
        );
        if (scopedTree.exists()) {
          setTreeData(scopedTree.data().tree || []);
          return;
        }

        const legacyTree = await getDoc(doc(db, "curriculum", "tree"));
        if (legacyTree.exists()) {
          setTreeData(legacyTree.data().tree || []);
        }
      } catch (e) {
        console.error("Failed to load curriculum tree", e);
      }
    };
    loadTree();
  }, [config]);

  const handleSelect = (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => {
    setActiveId(node.id);
    onSelect(node, type, parentTitle);
  };

  return (
    <>
      <button
        type="button"
        className={`teacher-settings-section${activeId === "exam_prep" ? " is-active" : ""}`}
        aria-current={activeId === "exam_prep" ? "page" : undefined}
        onClick={() =>
          handleSelect({ id: "exam_prep", title: "모의고사" }, "special")
        }
      >
        <i className="fas fa-file-contract" aria-hidden="true" />
        <span>모의고사</span>
      </button>
      {treeData.map((big) => (
        <div key={big.id}>
          <div className="px-3 py-2 text-sm font-bold text-gray-700 break-words">
            {big.title}
          </div>
          {big.children?.map((mid) => (
            <button
              type="button"
              key={mid.id}
              className={`teacher-settings-section${activeId === mid.id ? " is-active" : ""}`}
              aria-current={activeId === mid.id ? "page" : undefined}
              onClick={() => handleSelect(mid, "normal", big.title)}
              title={mid.title}
            >
              <i className="far fa-folder" aria-hidden="true" />
              <span className="min-w-0 break-words">{mid.title}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
};

export default QuizUnitTree;
