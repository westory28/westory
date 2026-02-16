import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './assets/index.css';
import ErrorBoundary from './components/common/ErrorBoundary';

if (
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('github.io') &&
    window.location.pathname.startsWith('/westory') &&
    !window.location.hash
) {
    window.location.replace(`${window.location.origin}${window.location.pathname}#/`);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>,
);
