import { RefObject, useLayoutEffect, useRef } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";

const interactive =
  'a[href],button,input,select,textarea,summary,[contenteditable="true"],[role="button"],[tabindex]';
const scrollKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** Call before the modal's passive effect so suspension restores the body first. */
export function useEntryFinale(
  root: RefObject<HTMLDivElement>,
  suspended: boolean,
) {
  const consumed = useRef(false);
  const motionEnabled = useEntryMotionEnabled();
  useLayoutEffect(() => {
    const page = root.current;
    const scene = page?.querySelector<HTMLElement>(".entry-finish");
    if (!page || !scene || suspended) return;
    const body = document.body;
    const html = document.documentElement;
    let frame = 0,
      timer = 0,
      locked = false,
      lastY = window.scrollY;
    let alignedY = lastY,
      alignedX = window.scrollX;
    let lockViewport = "";
    let saved: [HTMLElement, string, string, string][] = [];
    const complete = () => {
      scene.dataset.entered = "true";
      scene.dataset.finaleComplete = "true";
      consumed.current = true;
    };
    const restore = (item: (typeof saved)[number]) => {
      const [element, property, value, priority] = item;
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    };
    const release = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (!locked) return;
      locked = false;
      document.removeEventListener("wheel", cancelScroll, true);
      document.removeEventListener("touchmove", cancelScroll, true);
      // Keep instant scrolling until the fixed body is back in normal document flow.
      saved.filter((item) => item[1] !== "scroll-behavior").forEach(restore);
      window.scrollTo({ left: alignedX, top: alignedY, behavior: "auto" });
      saved.filter((item) => item[1] === "scroll-behavior").forEach(restore);
      saved = [];
      page.style.removeProperty("--entry-scrollbar");
      lastY = window.scrollY;
      delete page.dataset.finaleLocked;
      complete();
    };
    const viewportHeight = () =>
      Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
    const viewportKey = () =>
      [
        window.innerWidth,
        window.innerHeight,
        viewportHeight(),
        window.visualViewport?.scale,
      ].join(":");
    const offset = () => (window.innerWidth < 768 ? 72 : 80);
    const start = (top: number) => {
      const stage = scene.querySelector<HTMLElement>(".entry-stage");
      if (
        !motionEnabled ||
        viewportHeight() < 600 ||
        !stage ||
        stage.scrollHeight > viewportHeight() - offset() + 2 ||
        page.hasAttribute("inert") ||
        body.style.position === "fixed"
      ) {
        complete();
        return;
      }
      consumed.current = true;
      alignedX = window.scrollX;
      const gap = Math.max(0, window.innerWidth - html.clientWidth);
      const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
      const capture = (element: HTMLElement, properties: string[]) => {
        properties.forEach((property) =>
          saved.push([
            element,
            property,
            element.style.getPropertyValue(property),
            element.style.getPropertyPriority(property),
          ]),
        );
      };
      capture(body, [
        "position",
        "top",
        "left",
        "right",
        "width",
        "overflow",
        "padding-right",
        "box-sizing",
      ]);
      capture(html, ["overflow", "overscroll-behavior", "scroll-behavior"]);
      html.style.setProperty("scroll-behavior", "auto", "important");
      window.scrollTo({
        left: alignedX,
        top: Math.max(0, window.scrollY + top - offset()),
        behavior: "auto",
      });
      alignedY = window.scrollY;
      lastY = alignedY;
      lockViewport = viewportKey();
      locked = true;
      page.style.setProperty("--entry-scrollbar", `${gap}px`);
      page.dataset.finaleLocked = "true";
      body.style.position = "fixed";
      body.style.top = `${-alignedY}px`;
      body.style.left = `${-alignedX}px`;
      body.style.right = "0";
      body.style.width = "100%";
      body.style.boxSizing = "border-box";
      body.style.overflow = "hidden";
      body.style.paddingRight = `${padding + gap}px`;
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      document.addEventListener("wheel", cancelScroll, {
        passive: false,
        capture: true,
      });
      document.addEventListener("touchmove", cancelScroll, {
        passive: false,
        capture: true,
      });
      timer = window.setTimeout(release, 1400);
      scene.dataset.entered = "true";
    };
    const read = () => {
      frame = 0;
      if (locked || document.hidden) return;
      const currentY = window.scrollY;
      const down = currentY > lastY + 1;
      lastY = currentY;
      if (consumed.current) return;
      const rect = scene.getBoundingClientRect();
      if (rect.top > viewportHeight() * 0.55) return;
      // Restored positions and upward jumps reveal the ending without interception.
      if (!down || rect.bottom <= offset()) complete();
      else start(rect.top);
    };
    const request = () => {
      if (!frame && !locked && !document.hidden)
        frame = window.requestAnimationFrame(read);
    };
    const cancelScroll = (event: Event) => {
      if (
        ("touches" in event && (event as TouchEvent).touches.length > 1) ||
        ("ctrlKey" in event && (event as WheelEvent).ctrlKey)
      ) {
        release();
        return;
      }
      if (locked && event.cancelable) event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!locked) return;
      if (event.key === "Escape" || event.key === "Tab") release();
      else if (scrollKeys.has(event.key)) event.preventDefault();
    };
    const pointerdown = (event: PointerEvent) => {
      if (
        locked &&
        event.target instanceof Element &&
        event.target.closest(interactive)
      )
        release();
    };
    const resize = () => {
      // Hiding the scrollbar can resize only visualViewport.width; it is not a rotation.
      if (locked && viewportKey() === lockViewport) return;
      release();
      lastY = window.scrollY;
      request();
    };
    const visibility = () => {
      if (document.hidden) release();
      else request();
    };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", release);
    window.visualViewport?.addEventListener("resize", resize);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown, true);
    document.addEventListener("focusin", release, true);
    document.addEventListener("visibilitychange", visibility);
    if (!motionEnabled || viewportHeight() < 600) complete();
    else request();
    return () => {
      window.cancelAnimationFrame(frame);
      release();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", release);
      window.visualViewport?.removeEventListener("resize", resize);
      document.removeEventListener("wheel", cancelScroll, true);
      document.removeEventListener("touchmove", cancelScroll, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown, true);
      document.removeEventListener("focusin", release, true);
      document.removeEventListener("visibilitychange", visibility);
      window.cancelAnimationFrame(frame);
    };
  }, [root, suspended, motionEnabled]);
}
