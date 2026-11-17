import { useCallback, useEffect, useRef, useState } from "react";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";

/** Native fullscreen with a keyboard-accessible fallback for restricted browsers. */
export default function useWeplayFullscreen() {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"native" | "page" | null>(null);
  const exit = useCallback(() => {
    if (document.fullscreenElement === host.current)
      void document.exitFullscreen?.().catch(() => setMode(null));
    else setMode(null);
  }, []);
  const enter = useCallback(async () => {
    try {
      if (host.current?.requestFullscreen) {
        await host.current.requestFullscreen();
        setMode("native");
        return;
      }
    } catch {
      /* Keep fullscreen available when the native API is restricted. */
    }
    setMode("page");
  }, []);
  useEffect(() => {
    const changed = () =>
      setMode(document.fullscreenElement === host.current ? "native" : null);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!mode) return;
    const release = acquirePageScrollLock();
    const previousFocus = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (
        mode !== "page" ||
        event.defaultPrevented ||
        host.current?.querySelector("dialog[open]")
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        host.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) || [],
      ).filter(
        (node) => node.getClientRects().length && !node.closest("[inert]"),
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      release();
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [mode, exit]);
  return { host, fullscreen: mode !== null, enter, exit };
}
