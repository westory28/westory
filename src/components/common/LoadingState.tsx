import React from "react";

const DEFAULT_WARNING =
  "자료를 불러오는 중에는 새로고침하거나 다른 화면으로 이동하지 마세요.";

type LoadingStateProps = {
  message?: string;
  detail?: string;
  className?: string;
  warning?: string;
  showWarning?: boolean;
};

type LoadingOverlayProps = LoadingStateProps & {
  zIndexClassName?: string;
};

const LoadingMark: React.FC = () => (
  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
  </div>
);

const LoadingCard: React.FC<LoadingStateProps> = ({
  message = "자료를 불러오는 중입니다.",
  detail,
  className = "",
  warning = DEFAULT_WARNING,
  showWarning = true,
}) => (
  <div
    className={`inline-block max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white px-6 py-5 text-center shadow-xl ${className}`}
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <LoadingMark />
    <p className="mt-3 whitespace-nowrap text-[clamp(0.75rem,3.5vw,0.875rem)] font-bold text-gray-800">
      {message}
    </p>
    {detail && (
      <p className="mt-1 whitespace-nowrap text-[clamp(0.625rem,3vw,0.75rem)] font-medium text-gray-500">
        {detail}
      </p>
    )}
    {showWarning && (
      <p className="mt-2 whitespace-nowrap text-[clamp(0.625rem,3vw,0.75rem)] font-semibold text-amber-700">
        {warning}
      </p>
    )}
  </div>
);

export const PageLoading: React.FC<LoadingStateProps> = (props) => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <LoadingCard
      {...props}
      className={`w-fit max-w-[calc(100vw-2rem)] ${props.className || ""}`}
    />
  </div>
);

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  zIndexClassName = "z-[90]",
  ...props
}) => (
  <div
    className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm`}
  >
    <LoadingCard
      {...props}
      className={`w-fit max-w-[calc(100vw-2rem)] ${props.className || ""}`}
    />
  </div>
);

export const InlineLoading: React.FC<LoadingStateProps> = ({
  className = "",
  showWarning = false,
  ...props
}) => (
  <div className={`flex justify-center px-4 py-10 ${className}`}>
    <LoadingCard
      {...props}
      showWarning={showWarning}
      className="mx-auto w-fit max-w-[calc(100vw-2rem)] shadow-sm"
    />
  </div>
);
