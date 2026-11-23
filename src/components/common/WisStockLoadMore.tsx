import React, { useId } from "react";
import "./WisStockLoadMore.css";

interface WisStockLoadMoreProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  progress?: string;
}

const WisStockLoadMore: React.FC<WisStockLoadMoreProps> = ({
  onClick,
  loading = false,
  disabled = false,
  progress,
}) => {
  const progressId = useId();
  const label = loading ? "불러오는 중" : "더보기";
  return (
    <button
      type="button"
      className="ws-wis-stock-load-more"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-describedby={progress ? progressId : undefined}
    >
      {label}
      {progress && (
        <span id={progressId} aria-live="polite" aria-atomic="true">
          {progress}
        </span>
      )}
    </button>
  );
};

export default WisStockLoadMore;
