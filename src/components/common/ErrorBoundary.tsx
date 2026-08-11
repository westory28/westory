import React from "react";
import StatePanel from "./StatePanel";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

const ERROR_STORAGE_KEY = "westory:last-render-error";
const CHUNK_RELOAD_KEY = "westoryChunkReloaded";

const normalizeErrorMessage = (error: unknown) =>
  String(
    (error as { message?: string })?.message || error || "Unknown render error",
  );

const isChunkLoadFailure = (error: unknown): boolean => {
  const message = normalizeErrorMessage(error);
  return [
    "ChunkLoadError",
    "Loading chunk",
    "Failed to fetch dynamically imported module",
    "Importing a module script failed",
    "error loading dynamically imported module",
  ].some((text) => message.includes(text));
};

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: normalizeErrorMessage(error),
    };
  }

  componentDidCatch(error: unknown) {
    const message = normalizeErrorMessage(error);
    console.error("Unhandled render error:", error);

    if (typeof window === "undefined") return;

    window.sessionStorage.setItem(ERROR_STORAGE_KEY, message);

    if (
      isChunkLoadFailure(error) &&
      window.sessionStorage.getItem(CHUNK_RELOAD_KEY) !== "1"
    ) {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.message || "Unknown render error";
    const isChunkError = isChunkLoadFailure(message);

    return (
      <main className="ws-access-state">
        <StatePanel
          state="ERROR"
          title="페이지를 불러오지 못했습니다."
          description={
            isChunkError
              ? "새 배포 파일을 받는 중 문제가 생겼습니다. 다시 불러와 주세요."
              : "화면을 그리는 중 문제가 생겼습니다. 입력한 내용은 다시 확인해 주세요."
          }
          retryable
          contactAdmin
          action={{
            label: "다시 불러오기",
            onClick: () => {
              if (typeof window === "undefined") return;
              window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
              window.location.reload();
            },
          }}
        />
      </main>
    );
  }
}

export default ErrorBoundary;
