import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { acquirePageScrollLock } from "../../../../lib/pageScrollLock";

const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/** Yut's landscape/native-fullscreen/page-fallback contract, without game I/O. */
export default function useRhythmStage(
  ref: RefObject<HTMLElement>,
  pause: () => void,
) {
  const [size, setSize] = useState(viewport);
  const [mode, setMode] = useState<"native" | "page" | null>(null);
  const mounted = useRef(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const fullscreen = mode !== null;
  const rotated = fullscreen && size.height > size.width;
  const portrait =
    !fullscreen &&
    (size.width <= 1023 || matchMedia("(any-pointer: coarse)").matches) &&
    size.height > size.width;
  useEffect(() => {
    mounted.current = true;
    const resize = () => setSize(viewport());
    const change = () => {
      resize();
      setMode(document.fullscreenElement === ref.current ? "native" : null);
      pause();
    };
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", change);
    const shell = ref.current;
    return () => {
      mounted.current = false;
      window.removeEventListener("resize", resize);
      document.removeEventListener("fullscreenchange", change);
      if (document.fullscreenElement === shell)
        void document.exitFullscreen().catch(() => {});
    };
  }, [ref, pause]);
  useEffect(() => {
    if (portrait) pause();
  }, [portrait, pause]);
  const exit = useCallback(() => {
    pause();
    if (document.fullscreenElement === ref.current)
      void document.exitFullscreen().catch(() => setMode(null));
    else setMode(null);
  }, [ref, pause]);
  const enter = async () => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    pause();
    setSize(viewport());
    const shell = ref.current;
    try {
      if (shell?.requestFullscreen) {
        await shell.requestFullscreen();
        if (!mounted.current && document.fullscreenElement === shell)
          await document.exitFullscreen();
        return;
      }
    } catch {
      /* iOS and restricted browsers use a fixed, rotated page view. */
    }
    if (mounted.current) setMode("page");
  };
  useEffect(() => {
    if (!fullscreen) return;
    const release = acquirePageScrollLock();
    const previous = returnFocus.current;
    ref.current
      ?.querySelector<HTMLButtonElement>(".rhythm-fullscreen")
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && mode === "page")
        exit();
      if (event.key !== "Tab") return;
      const controls = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
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
    document.addEventListener("keydown", key);
    return () => {
      release();
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else
        ref.current
          ?.querySelector<HTMLButtonElement>(
            ".rhythm-orientation-gate button, .rhythm-fullscreen",
          )
          ?.focus({ preventScroll: true });
    };
  }, [fullscreen, mode, exit, ref]);
  return {
    fullscreen,
    rotated,
    portrait,
    enter,
    exit,
    width: Math.max(size.width, size.height),
    height: Math.min(size.width, size.height),
  };
}

/** Inverse of the clockwise 90-degree canvas transform. */
export function rhythmPointerPosition(
  rect: DOMRect,
  x: number,
  y: number,
  rotated: boolean,
) {
  return rotated
    ? { x: (y - rect.top) / rect.height, y: 1 - (x - rect.left) / rect.width }
    : { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}
