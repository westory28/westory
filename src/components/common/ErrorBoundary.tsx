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
  }

  componentDidCatch(error: unknown) {
    console.error("Unhandled render error:", error);
    if (typeof window === "undefined" || !isAssetLoadFailure(error)) return;
    void recoverAssetLoad(error).then((recovery) => {
      if (!this.mounted) return;
      this.setState({ recovery });
      if (recovery === "reloading") {
        clearTimeout(this.navigationTimer);
        // beforeunload can cancel navigation. Do not strand the page behind
        // a permanent loading surface if the browser stays here.
        this.navigationTimer = setTimeout(() => {
          if (this.mounted) this.setState({ recovery: "reload-blocked" });
        }, 3000);
      }
    });
  }

  componentWillUnmount() {
    this.mounted = false;
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
        : recovery === "draft"
          ? "입력 중이던 내용이 있어 자동으로 새로고침하지 않았습니다. 다시 불러오면 저장하지 않은 내용이 사라질 수 있습니다."
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
              window.location.reload();
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
