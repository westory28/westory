import React from "react";
import LoadingLogo from "./LoadingLogo";
import "./loadingState.css";

type LoadingStateProps = {
  // Kept for existing callers; shared loading uses one accessible status label.
  message?: string;
  detail?: string;
  className?: string;
  warning?: string;
  showWarning?: boolean;
};

type LoadingOverlayProps = LoadingStateProps & { zIndexClassName?: string };

const LoadingContent: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <div
    className={`ws-loading ${className}`}
    role="status"
    aria-live="polite"
    aria-label="처리 중"
    aria-busy="true"
  >
    <LoadingLogo />
  </div>
);

export const PageLoading: React.FC<LoadingStateProps> = ({
  className = "",
}) => (
  <div className="ws-loading-page">
    <LoadingContent className={className} />
  </div>
);

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  zIndexClassName = "z-[90]",
  className = "",
}) => (
  <div className={`ws-loading-overlay ${zIndexClassName}`}>
    <LoadingContent className={className} />
  </div>
);

export const InlineLoading: React.FC<LoadingStateProps> = ({
  className = "",
}) => (
  <div className={`ws-loading-inline ${className}`}>
    <LoadingContent />
  </div>
);
