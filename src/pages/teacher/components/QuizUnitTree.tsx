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
  selectedId?: string;
  onSelect: (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => void;
}

const QuizUnitTree: React.FC<QuizUnitTreeProps> = ({
  onSelect,
  selectedId,
}) => {
  const { config } = useAuth();
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setActiveId(selectedId || null);
  }, [selectedId]);

  useEffect(() => {
    const loadTree = async () => {
      setLoading(true);
      setLoadError(false);
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
        setLoadError(true);
        console.error("Failed to load curriculum tree", e);
      } finally {
        setLoading(false);
      }
    };
    loadTree();
  }, [config, retryKey]);

  const handleSelect = (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => {
    setActiveId(node.id);
    onSelect(node, type, parentTitle);
  };

  return (
    <div className="quiz-unit-tree">
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
      {loading && (
        <p className="p-3 text-sm text-gray-500" role="status">
          단원을 불러오는 중입니다.
        </p>
      )}
      {loadError && (
        <div className="p-3 text-sm text-red-700" role="alert">
          단원을 불러오지 못했습니다.
          <button
            type="button"
            className="block min-h-11 font-bold underline"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {treeData.map((big) => (
        <div key={big.id}>
          <div className="quiz-unit-label quiz-unit-group" title={big.title}>
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
              <span className="quiz-unit-label">{mid.title}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default QuizUnitTree;
