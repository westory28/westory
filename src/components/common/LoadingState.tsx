import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

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
  showWarning = false,
}) => (
  <div
    className={`inline-block max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white px-6 py-5 text-center shadow-xl ${className}`}
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <LoadingMark />
    <p className="mt-3 break-keep text-[clamp(0.75rem,3.5vw,0.875rem)] font-bold leading-6 text-gray-800">
      {message}
    </p>
    {detail && (
      <p className="mt-1 break-keep text-[clamp(0.625rem,3vw,0.75rem)] font-medium leading-5 text-gray-500">
        {detail}
      </p>
    )}
    {showWarning && (
      <p className="mt-2 break-keep text-[clamp(0.625rem,3vw,0.75rem)] font-semibold leading-5 text-amber-700">
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

const pageReadOwners = new Set<symbol>();
const pageReadListeners = new Set<() => void>();
let originalBodyOverflow = "";
let originalPageFocus: HTMLElement | null = null;
const subscribeToPageReads = (listener: () => void) => {
  pageReadListeners.add(listener);
  return () => {
    pageReadListeners.delete(listener);
  };
};
const notifyPageReads = () =>
  pageReadListeners.forEach((listener) => listener());

const BlockingPageRead: React.FC = () => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="ws-page-read-loading"
      aria-label="자료를 불러오는 중입니다."
      aria-busy="true"
      onCancel={(event) => event.preventDefault()}
    >
      <LoadingCard message="자료를 불러오는 중입니다." />
    </dialog>,
    document.body,
  );
};

const SharedPageRead: React.FC = () => {
  const owner = useRef(Symbol("page-read"));
  const presenter = useSyncExternalStore(
    subscribeToPageReads,
    () => pageReadOwners.values().next().value,
    () => undefined,
  );
  useEffect(() => {
    const token = owner.current;
    if (!pageReadOwners.size) {
      originalBodyOverflow = document.body.style.overflow;
      originalPageFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      document.body.style.overflow = "hidden";
    }
    pageReadOwners.add(token);
    notifyPageReads();
    return () => {
      pageReadOwners.delete(token);
      if (!pageReadOwners.size) {
        document.body.style.overflow = originalBodyOverflow;
        const opener = originalPageFocus;
        queueMicrotask(() => {
          if (!pageReadOwners.size && opener?.isConnected) opener.focus();
        });
      }
      notifyPageReads();
    };
  }, []);
  return presenter === owner.current ? <BlockingPageRead /> : null;
};

/** Page reads block background pointer and keyboard input once shown. */
export const PageDataLoading: React.FC<LoadingStateProps> = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, []);
  return visible ? <SharedPageRead /> : null;
};
