import React from 'react';

type Props = {
    children: React.ReactNode;
};

type State = {
    hasError: boolean;
};

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.error('Unhandled render error:', error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                    <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
                        <h1 className="text-lg font-semibold text-gray-900">페이지를 불러오지 못했습니다.</h1>
                        <p className="mt-2 text-sm text-gray-600">
                            브라우저를 새로고침한 뒤 다시 시도해 주세요.
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
