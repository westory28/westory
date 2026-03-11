import React from 'react';

type Props = {
    children: React.ReactNode;
};

type State = {
    hasError: boolean;
    isChunkLoadError: boolean;
};

const CHUNK_RELOAD_KEY = 'westoryChunkReloaded';

const isChunkLoadFailure = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return [
        'ChunkLoadError',
        'Loading chunk',
        'Failed to fetch dynamically imported module',
        'Importing a module script failed',
    ].some((text) => message.includes(text));
};

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, isChunkLoadError: false };
    }

    static getDerivedStateFromError(error: unknown): State {
        return { hasError: true, isChunkLoadError: isChunkLoadFailure(error) };
    }

    componentDidCatch(error: unknown) {
        console.error('Unhandled render error:', error);

        if (
            typeof window !== 'undefined' &&
            isChunkLoadFailure(error) &&
            window.sessionStorage.getItem(CHUNK_RELOAD_KEY) !== '1'
        ) {
            window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
            window.location.reload();
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                    <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
                        <h1 className="text-lg font-semibold text-gray-900">
                            {this.state.isChunkLoadError ? '페이지를 새 버전으로 다시 불러오는 중입니다.' : '페이지를 불러오지 못했습니다.'}
                        </h1>
                        <p className="mt-2 text-sm text-gray-600">
                            {this.state.isChunkLoadError
                                ? '배포 직후에는 브라우저에 남아 있던 이전 파일 때문에 잠시 오류가 날 수 있습니다. 아래 버튼으로 다시 시도해주세요.'
                                : '브라우저를 새로고침한 뒤 다시 시도해 주세요.'}
                        </p>
                        <div className="mt-4 flex justify-center">
                            <button
                                type="button"
                                onClick={() => {
                                    if (typeof window === 'undefined') return;
                                    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
                                    window.location.reload();
                                }}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
                            >
                                다시 불러오기
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
