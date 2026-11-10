import React from "react";
import { LoadingOverlay } from "../../../components/common/LoadingState";

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

interface QuizUnitTreeProps {
  selectedId?: string;
  treeData: TreeUnit[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onSelect: (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => void;
}

const QuizUnitTree: React.FC<QuizUnitTreeProps> = ({
  onSelect,
  selectedId,
  treeData,
  loading,
  loadError,
  onRetry,
}) => {
  const handleSelect = (
    node: TreeUnit,
    type: "special" | "normal",
    parentTitle?: string,
  ) => {
    onSelect(node, type, parentTitle);
  };

  return (
    <div className="quiz-unit-tree">
      <button
        type="button"
        className={`teacher-settings-section quiz-mock-exam-entry${selectedId === "exam_prep" ? " is-active" : ""}`}
        aria-current={selectedId === "exam_prep" ? "page" : undefined}
        onClick={() =>
          handleSelect({ id: "exam_prep", title: "모의고사" }, "special")
        }
      >
        <i className="fas fa-file-contract" aria-hidden="true" />
        <span>모의고사</span>
      </button>
      {loading && <LoadingOverlay />}
      {loadError && (
        <div className="p-3 text-sm text-red-700" role="alert">
          단원을 불러오지 못했습니다.
          <button
            type="button"
            className="block min-h-11 font-bold underline"
            onClick={onRetry}
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
              className={`teacher-settings-section${selectedId === mid.id ? " is-active" : ""}`}
              aria-current={selectedId === mid.id ? "page" : undefined}
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
