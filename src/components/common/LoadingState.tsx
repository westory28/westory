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
import LoadingLogo, { finishLoadingIn } from "./LoadingLogo";
import "./loadingState.css";

type LoadingStateProps = {
  // Kept for existing callers; shared loading uses one accessible status label.
  message?: string;
  detail?: string;
  className?: string;
  warning?: string;
  showWarning?: boolean;
  scope?: "container" | "screen";
};

type LoadingOverlayProps = LoadingStateProps & { zIndexClassName?: string };

type LoadingKind = "page" | "inline" | "overlay";
type LoadingRequestTarget = {
  target: HTMLElement | null;
  kind: LoadingKind;
};
type RegisterLoading = (
  id: string,
  request: LoadingRequestTarget,
) => () => void;
const LoadingContext = createContext<RegisterLoading | null>(null);
const containerKeys = new WeakMap<HTMLElement, string>();
const containerLeases = new WeakMap<
  HTMLElement,
  { count: number; classes: string[] }
>();

/** Coalesce requests only within the same container; screen scope is explicit. */
export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<Map<string, LoadingRequestTarget>>(
    () => new Map(),
  );
  const register = useCallback<RegisterLoading>((id, request) => {
    if (request.target && !containerKeys.has(request.target))
      containerKeys.set(request.target, id);
    setRequests((current) => new Map(current).set(id, request));
    return () => {
      setRequests((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, []);
  const containers = new Map<HTMLElement, LoadingKind>();
  let screenPending = false;
  for (const { target, kind } of requests.values()) {
    if (target) containers.set(target, kind);
    else screenPending = true;
  }
  return (
    <LoadingContext.Provider value={register}>
      {children}
      {screenPending ? (
        <LoadingScreen />
      ) : (
        [...containers].map(([target, kind]) =>
          createPortal(
            <ContainerLoadingSurface target={target} kind={kind} />,
            target,
            containerKeys.get(target),
          ),
        )
      )}
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
      className="ws-loading-surface ws-loading-screen ws-loading-overlay"
      data-loading-scope="screen"
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

function ContainerLoadingSurface({
  target,
  kind,
}: {
  target: HTMLElement;
  kind: LoadingKind;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const overlay = layer.current;
    if (!overlay || kind !== "overlay") return;
    const previousFocus = document.activeElement;
    const previousBusy = target.getAttribute("aria-busy");
    const lease = containerLeases.get(target) || { count: 0, classes: [] };
    containerLeases.set(target, lease);
    lease.count++;
    const addClass = (name: string) => {
      if (!target.classList.contains(name)) {
        target.classList.add(name);
        lease.classes.push(name);
      }
    };
    addClass("ws-loading-container");
    if (getComputedStyle(target).position === "static")
      addClass("ws-loading-container--positioned");
    // An empty result slot needs room, but a compact toolbar keeps its size.
    if (
      target.clientHeight < 88 &&
      ![...target.children].some(
        (child) =>
          child !== overlay && child.getBoundingClientRect().height > 0,
      )
    )
      addClass("ws-loading-container--empty");
    target.setAttribute("aria-busy", "true");
    const inertStates = new Map<HTMLElement, boolean>();
    const protectContent = () => {
      for (const child of target.children) {
        if (
          !(child instanceof HTMLElement) ||
          child === overlay ||
          child.classList.contains("ws-loading-request") ||
          inertStates.has(child)
        )
          continue;
        inertStates.set(child, child.inert);
        child.inert = true;
      }
    };
    protectContent();
    if (
      previousFocus instanceof HTMLElement &&
      target.contains(previousFocus) &&
      previousFocus.closest("[inert]")
    )
      previousFocus.blur();
    const contentObserver = new MutationObserver(protectContent);
    contentObserver.observe(target, { childList: true });

    const ancestors: HTMLElement[] = [];
    for (let node = target.parentElement; node; node = node.parentElement)
      ancestors.push(node);
    const position = () => {
      const box = target.getBoundingClientRect();
      const originX = box.left + target.clientLeft;
      const originY = box.top + target.clientTop;
      let top = Math.max(0, originY);
      let bottom = Math.min(innerHeight, originY + target.clientHeight);
      let left = Math.max(0, originX);
      let right = Math.min(innerWidth, originX + target.clientWidth);
      for (const ancestor of ancestors) {
        const style = getComputedStyle(ancestor);
        const clip = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, clip.top + ancestor.clientTop);
          bottom = Math.min(
            bottom,
            clip.top + ancestor.clientTop + ancestor.clientHeight,
          );
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, clip.left + ancestor.clientLeft);
          right = Math.min(
            right,
            clip.left + ancestor.clientLeft + ancestor.clientWidth,
          );
        }
      }
      Object.assign(overlay.style, {
        top: `${target.scrollTop}px`,
        left: `${target.scrollLeft}px`,
        width: `${target.clientWidth}px`,
        height: `${target.clientHeight}px`,
      });
      overlay.style.setProperty(
        "--ws-loading-center-y",
        `${(top + bottom) / 2 - originY}px`,
      );
      overlay.style.setProperty(
        "--ws-loading-center-x",
        `${(left + right) / 2 - originX}px`,
      );
      overlay.style.setProperty(
        "--ws-loading-logo-width",
        `${Math.max(16, Math.min(288, target.clientWidth - 32, ((target.clientHeight - 16) * 1024) / 293))}px`,
      );
    };
    position();
    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(position)
        : null;
    resizeObserver?.observe(target);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      contentObserver.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      for (const [child, inert] of inertStates) child.inert = inert;
      if (previousBusy === null) target.removeAttribute("aria-busy");
      else target.setAttribute("aria-busy", previousBusy);
      lease.count--;
      // Keep the containing block through child cleanup, StrictMode probes
      // and consecutive requests, then restore exactly the classes we added.
      queueMicrotask(() => {
        if (lease.count === 0) {
          for (const name of lease.classes) target.classList.remove(name);
          containerLeases.delete(target);
        }
      });
      if (
        document.activeElement === document.body &&
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.closest("[inert]")
      )
        previousFocus.focus({ preventScroll: true });
    };
  }, [target, kind]);
  return (
    <div
      ref={layer}
      // Parent stack spacing must not offset this out-of-flow surface.
      style={kind === "overlay" ? { margin: 0 } : undefined}
      className={`ws-loading-surface ${kind === "overlay" ? "ws-loading-container-overlay" : `ws-loading-${kind}`}`}
      data-loading-scope="container"
    >
      <LoadingContent />
    </div>
  );
}

function LoadingRequest({
  className = "",
  scope = "container",
  kind,
}: LoadingStateProps & { kind: LoadingKind }) {
  const register = useContext(LoadingContext);
  const id = useId();
  const placeholder = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState<LoadingRequestTarget | null>(null);
  const marker = scope === "screen" || kind === "overlay";
  useLayoutEffect(() => {
    const slot = placeholder.current;
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
          (node instanceof HTMLDialogElement && !node.open) ||
          node.getAttribute("aria-hidden") === "true" ||
          getComputedStyle(node).display === "none",
      );
      const target =
        scope === "screen"
          ? null
          : kind === "overlay"
            ? placeholder.current?.parentElement
            : placeholder.current;
      if (target === undefined) return;
      if (!register)
        setFallback((previous) =>
          shown
            ? previous?.target === target && previous.kind === kind
              ? previous
              : { target, kind }
            : null,
        );
      else if (shown && !release) release = register(id, { target, kind });
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
      // The provider portal may unmount after this slot leaves the DOM.
      // Capture an in-flow logo while its local rectangle is still available.
      if (scope === "container" && kind !== "overlay" && slot)
        finishLoadingIn(slot);
      release?.();
    };
  }, [id, register, scope, kind]);
  return (
    <>
      <div
        ref={placeholder}
        hidden={marker}
        aria-hidden={marker ? "true" : undefined}
        style={marker ? { display: "none" } : undefined}
        className={
          marker
            ? "ws-loading-request"
            : `ws-loading-slot ws-loading-slot--${kind} ${className}`
        }
      />
      {!register &&
        fallback &&
        (fallback.target ? (
          createPortal(
            <ContainerLoadingSurface target={fallback.target} kind={kind} />,
            fallback.target,
          )
        ) : (
          <LoadingScreen />
        ))}
    </>
  );
}

export const PageLoading: React.FC<LoadingStateProps> = (props) => (
  <LoadingRequest {...props} kind="page" />
);

export const LoadingOverlay: React.FC<LoadingOverlayProps> = (props) => (
  <LoadingRequest {...props} kind="overlay" />
);

export const InlineLoading: React.FC<LoadingStateProps> = (props) => (
  <LoadingRequest {...props} kind="inline" />
);
