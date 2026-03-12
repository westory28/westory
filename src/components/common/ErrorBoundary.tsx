import React from 'react';

type Props = {
    children: React.ReactNode;
};

type State = {
    hasError: boolean;
    message: string;
};

const ERROR_STORAGE_KEY = 'westory:last-render-error';
const CHUNK_RELOAD_KEY = 'westoryChunkReloaded';

const normalizeErrorMessage = (error: unknown) =>
    String((error as { message?: string })?.message || error || 'Unknown render error');

const isChunkLoadFailure = (error: unknown): boolean => {
    const message = normalizeErrorMessage(error);
    return [
        'ChunkLoadError',
        'Loading chunk',
        'Failed to fetch dynamically imported module',
        'Importing a module script failed',
        'error loading dynamically imported module',
    ].some((text) => message.includes(text));
};

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error: unknown): State {
        return {
            hasError: true,
            message: normalizeErrorMessage(error),
        };
    }

    componentDidCatch(error: unknown) {
        const message = normalizeErrorMessage(error);
        console.error('Unhandled render error:', error);

        if (typeof window === 'undefined') return;

        window.sessionStorage.setItem(ERROR_STORAGE_KEY, message);

        if (isChunkLoadFailure(error) && window.sessionStorage.getItem(CHUNK_RELOAD_KEY) !== '1') {
            window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
            window.location.reload();
        }
    }

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        const persistedMessage = typeof window !== 'undefined'
            ? window.sessionStorage.getItem(ERROR_STORAGE_KEY) || ''
            : '';
        const message = this.state.message || persistedMessage || 'Unknown render error';
        const isChunkError = isChunkLoadFailure(message);

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
                    <h1 className="text-lg font-semibold text-gray-900">
                        페이지를 불러오지 못했습니다.
                    </h1>
                    <p className="mt-2 text-sm text-gray-600">
                        {isChunkError
                            ? '배포 파일을 다시 받는 중 문제가 생겼습니다. 새로고침 후 다시 시도해 주세요.'
                            : '초기 화면을 그리는 중 오류가 발생했습니다. 아래 진단 메시지를 확인해 주세요.'}
                    </p>
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
                        <div className="text-xs font-bold uppercase tracking-wide text-amber-700">
                            Diagnostic
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-amber-900">
                            {message}
                        </pre>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (typeof window === 'undefined') return;
                            window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
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
