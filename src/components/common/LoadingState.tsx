import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
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

type RegisterLoading = (id: string) => () => void;
const LoadingContext = createContext<RegisterLoading | null>(null);

/** One screen for concurrent route, panel and explicit-operation requests. */
export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<Set<string>>(() => new Set());
  const register = useCallback<RegisterLoading>((id) => {
    setRequests((current) => new Set(current).add(id));
    return () => {
      setRequests((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    };
  }, []);
  return (
    <LoadingContext.Provider value={register}>
      {children}
      {requests.size > 0 && <LoadingScreen />}
    </LoadingContext.Provider>
  );
}

function LoadingScreen() {
  const layer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const overlay = layer.current;
    if (!overlay) return;
    const previousFocus = document.activeElement;
    // Native modal dialogs live above all z-index layers. Use the same top
    // layer so a request inside the dictionary dialog has identical coverage.
    if (typeof overlay.showModal === "function") overlay.showModal();
    else overlay.setAttribute("open", "");
    const releaseScrollLock = acquirePageScrollLock();
    const inertStates = new Map<HTMLElement, boolean>();
    const protectBackground = () => {
      for (const node of [
        ...document.body.children,
        ...document.querySelectorAll("dialog[open]"),
      ]) {
        if (
          !(node instanceof HTMLElement) ||
          node === overlay ||
          inertStates.has(node)
        )
          continue;
        inertStates.set(node, node.inert);
        node.inert = true;
      }
    };
    protectBackground();
    const observer = new MutationObserver(protectBackground);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      observer.disconnect();
      for (const [node, inert] of inertStates) node.inert = inert;
      if (typeof overlay.close === "function") overlay.close();
      releaseScrollLock();
      if (
        document.activeElement === document.body &&
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.closest("[inert]")
      )
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={layer}
      className="ws-loading-screen ws-loading-overlay"
      aria-label="처리 중"
      onCancel={(event) => event.preventDefault()}
    >
      <LoadingContent />
    </dialog>,
    document.body,
  );
}

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

function LoadingRequest({ className = "" }: LoadingStateProps) {
  const register = useContext(LoadingContext);
  const id = useId();
  const placeholder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const ancestors: HTMLElement[] = [];
    for (
      let node = placeholder.current?.parentElement;
      node;
      node = node.parentElement
    )
      ancestors.push(node);
    let release: (() => void) | undefined;
    const sync = () => {
      // Hidden tabs stay mounted to preserve drafts, but must not block the
      // active screen while their background work finishes.
      const shown = !ancestors.some(
        (node) =>
          node.hidden ||
          node.getAttribute("aria-hidden") === "true" ||
          getComputedStyle(node).display === "none",
      );
      if (!register) setVisible(shown);
      else if (shown && !release) release = register(id);
      else if (!shown && release) {
        release();
        release = undefined;
      }
    };
    const observer = new MutationObserver(sync);
    for (const node of ancestors)
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden", "class", "style", "open"],
      });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      release?.();
    };
  }, [id, register]);
  return (
    <>
      <span
        ref={placeholder}
        hidden
        aria-hidden="true"
        style={{ display: "none" }}
        className={`ws-loading-request ${className}`}
      />
      {!register && visible && <LoadingScreen />}
    </>
  );
}

export const PageLoading: React.FC<LoadingStateProps> = LoadingRequest;

// Keep legacy props for callers; one viewport layer now owns stacking and size.
export const LoadingOverlay: React.FC<LoadingOverlayProps> = LoadingRequest;

export const InlineLoading: React.FC<LoadingStateProps> = LoadingRequest;
