import React from "react";
import { PageLoading } from "./LoadingState";
import {
  isAssetLoadFailure,
  normalizeAssetError,
  recoverAssetLoad,
  type AssetRecoveryResult,
} from "../../lib/assetRecovery";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
  recovery: AssetRecoveryResult | "checking" | "reload-blocked" | null;
};

class ErrorBoundary extends React.Component<Props, State> {
  private mounted = true;
  private navigationTimer: ReturnType<typeof setTimeout> | undefined;
  private recover = async (manual = false, retry = true) => {
    if (typeof window === "undefined") return;
    clearTimeout(this.navigationTimer);
    this.setState({ recovery: "checking" });
    const recovery = await recoverAssetLoad(this.state.message, {
      retry,
      manual,
    });
    if (!this.mounted) return;
    this.setState({ recovery });
    if (recovery === "reloading") {
      // A genuine beforeunload guard may cancel navigation. Keep retry usable.
      this.navigationTimer = setTimeout(() => {
        if (this.mounted) this.setState({ recovery: "reload-blocked" });
      }, 3000);
    }
  };
  private onOnline = () => {
    if (
      ["offline", "unavailable", "save-failed"].includes(
        this.state.recovery || "",
      )
    )
      void this.recover();
  };
  private onAssetError = (event: Event) => {
    const error = (event as Event & { payload?: unknown }).payload;
    if (!isAssetLoadFailure(error)) return;
    // Capture the owning screen's checkpoint before replacing its subtree.
    // This also covers failed background preloads that React.lazy never renders.
    void recoverAssetLoad(error);
    this.setState(
      {
        hasError: true,
        message: normalizeAssetError(error),
        recovery: "checking",
      },
      () => {
        void this.recover(false, false);
      },
    );
  };

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "", recovery: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: normalizeAssetError(error),
      recovery: isAssetLoadFailure(error) ? "checking" : null,
    };
  }

  componentDidMount() {
    this.mounted = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("vite:preloadError", this.onAssetError);
  }

  componentDidCatch(error: unknown) {
    console.error("Unhandled render error:", error);
    if (typeof window === "undefined" || !isAssetLoadFailure(error)) return;
    void this.recover(false, false);
  }

  componentWillUnmount() {
    this.mounted = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("vite:preloadError", this.onAssetError);
    clearTimeout(this.navigationTimer);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { message, recovery } = this.state;
    if (recovery === "checking" || recovery === "reloading")
      return <PageLoading scope="screen" />;
    const description =
      recovery === "offline"
        ? "인터넷 연결이 끊겨 있습니다. 연결한 뒤 다시 불러와 주세요."
        : recovery === "save-failed"
          ? "입력 내용을 아직 저장하지 못했습니다. 연결을 확인한 뒤 다시 불러와 주세요."
          : recovery === "retry-limit" || recovery === "reload-blocked"
            ? "새 버전으로 자동 복구하지 못했습니다. 다시 불러와 주세요."
            : recovery
              ? "화면 파일을 받지 못했습니다. 연결 상태를 확인한 뒤 다시 불러와 주세요."
              : "화면을 표시하는 중 문제가 생겼습니다. 다시 불러와 주세요.";

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">
            페이지를 불러오지 못했습니다.
          </h1>
          <p className="mt-2 text-sm text-gray-600">{description}</p>
          <details className="mt-4 text-left text-sm text-gray-600">
            <summary className="cursor-pointer">오류 정보</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
              {message}
            </pre>
          </details>
          <button
            type="button"
            onClick={() => {
              if (typeof window === "undefined") return;
              if (isAssetLoadFailure(message)) void this.recover(true);
              else window.location.reload();
            }}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
