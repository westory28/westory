import { HISTORY_DICTIONARY_HANGUL_INITIALS } from "./historyDictionaryInitials";

interface InitialDragOptions {
  isDisabled: () => boolean;
  getItems: () => readonly string[];
  getValue: () => string;
  onSelect: (initial: string, focus?: boolean) => void;
  onFocus?: (initial: string) => void;
  onCapacityChange: (capacity: number) => void;
}

export type HistoryDictionaryInitialRow =
  | { type: "initial"; value: string }
  | { type: "more"; direction: -1 | 1; target: string };

export function getHistoryDictionaryInitialItems(
  numbersOpen: boolean,
  lettersOpen: boolean,
): string[] {
  return [
    "",
    "0-9",
    ...(numbersOpen
      ? Array.from({ length: 10 }, (_, index) => String(index))
      : []),
    ...HISTORY_DICTIONARY_HANGUL_INITIALS,
    "a-z",
    ...(lettersOpen
      ? Array.from({ length: 26 }, (_, index) =>
          String.fromCharCode(97 + index),
        )
      : []),
  ];
}

/** Keep the group controls discoverable while fitting only real, visible rows. */
export function getHistoryDictionaryInitialWindow(
  items: readonly string[],
  value: string,
  capacity: number,
): HistoryDictionaryInitialRow[] {
  const slots = Math.max(1, Math.floor(capacity));
  const selected = items.includes(value) ? value : items[0];
  const initial = (item: string): HistoryDictionaryInitialRow => ({
    type: "initial",
    value: item,
  });
  if (slots === 1) return [initial(selected)];
  const leading = slots >= 4 ? ["", "0-9"] : slots === 3 ? [""] : [];
  const trailing = ["a-z"];
  const body = items.filter(
    (item) => !leading.includes(item) && !trailing.includes(item),
  );
  const budget = slots - leading.length - trailing.length;
  let focus = body.indexOf(selected);
  if (focus < 0)
    focus =
      selected === "a-z"
        ? Math.max(
            0,
            body.findIndex((item) => item === "a"),
          )
        : 0;
  if (selected === "a-z" && !body.includes("a")) focus = body.length - 1;
  if (body.length <= budget)
    return [...leading, ...body, ...trailing].map(initial);
  let count = Math.min(body.length, budget);
  let start = 0;
  for (; count > 1; count--) {
    start = Math.max(
      0,
      Math.min(body.length - count, focus - Math.floor((count - 1) / 2)),
    );
    if (
      count + Number(start > 0) + Number(start + count < body.length) <=
      budget
    )
      break;
  }
  start = Math.max(
    0,
    Math.min(body.length - count, focus - Math.floor((count - 1) / 2)),
  );
  const room = budget - count;
  const before =
    room >= 1 && start > 0 && (room >= 2 || start + count === body.length);
  const after = start + count < body.length && room >= 1;
  return [
    ...leading.map(initial),
    ...(before
      ? [
          {
            type: "more" as const,
            direction: -1 as const,
            target: body[start - 1],
          },
        ]
      : []),
    ...body.slice(start, start + count).map(initial),
    ...(after
      ? [
          {
            type: "more" as const,
            direction: 1 as const,
            target: body[start + count],
          },
        ]
      : []),
    ...trailing.map(initial),
  ];
}

interface InitialRailBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export function intersectHistoryDictionaryInitialBounds(
  bounds: InitialRailBounds,
  clip: InitialRailBounds,
  clipX = true,
  clipY = true,
): InitialRailBounds {
  return {
    left: clipX ? Math.max(bounds.left, clip.left) : bounds.left,
    right: clipX ? Math.min(bounds.right, clip.right) : bounds.right,
    top: clipY ? Math.max(bounds.top, clip.top) : bounds.top,
    bottom: clipY ? Math.min(bounds.bottom, clip.bottom) : bounds.bottom,
  };
}

export function getHistoryDictionaryInitialDragSteps(distance: number) {
  return Math.trunc(distance / 44);
}

/** Pointer/wheel movement advances a logical index; replacing a window never re-hits a stationary pointer. */
export function attachHistoryDictionaryInitialDrag(
  rail: HTMLElement,
  options: InitialDragOptions,
) {
  const ownerDocument = rail.ownerDocument;
  const view = ownerDocument.defaultView;
  const clippingAncestors: {
    node: HTMLElement;
    clipX: boolean;
    clipY: boolean;
  }[] = [];
  for (let node = rail.parentElement; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    const clipX = /^(auto|scroll|hidden|clip)$/.test(style?.overflowX ?? "");
    const clipY = /^(auto|scroll|hidden|clip)$/.test(style?.overflowY ?? "");
    if (clipX || clipY) clippingAncestors.push({ node, clipX, clipY });
  }
  let pointerId: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let lastPointerY = 0;
  let dragDistance = 0;
  let pendingButton: HTMLButtonElement | null = null;
  let moreClickIntent: {
    target: string;
    source: "pointer" | "keyboard";
  } | null = null;
  let suppressPointerClick = false;
  let frame: number | null = null;
  let edgeDirection = 0;
  let edgeSince = 0;
  let edgeLastStep = 0;
  let layoutFrame: number | null = null;
  let disposed = false;
  let wheelDistance = 0;
  let wheelDirection = 0;
  let lastWheelStep = -Infinity;
  let lastWheelTime = -Infinity;
  const heightProperty = "--history-dictionary-rail-visible-height";
  const originalHeight = rail.style.getPropertyValue(heightProperty);
  const originalHeightPriority = rail.style.getPropertyPriority(heightProperty);

  const clippingBounds = () => {
    let bounds: InitialRailBounds = {
      left: -Infinity,
      top: -Infinity,
      right: Infinity,
      bottom: Infinity,
    };
    if (view) {
      const viewport = view.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      bounds = {
        left,
        top,
        right: left + (viewport?.width ?? view.innerWidth),
        bottom: top + (viewport?.height ?? view.innerHeight),
      };
    }
    for (const { node, clipX, clipY } of clippingAncestors)
      bounds = intersectHistoryDictionaryInitialBounds(
        bounds,
        node.getBoundingClientRect(),
        clipX,
        clipY,
      );
    return bounds;
  };
  const visibleBounds = () =>
    intersectHistoryDictionaryInitialBounds(
      rail.getBoundingClientRect(),
      clippingBounds(),
    );
  const fitVisibleHeight = () => {
    if (layoutFrame !== null) view?.cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    if (disposed) return;
    const bounds = rail.getBoundingClientRect();
    const clip = clippingBounds();
    if (bounds.right <= bounds.left || !Number.isFinite(clip.bottom)) return;
    const height = `${Math.max(54, Math.floor(clip.bottom - Math.max(bounds.top, clip.top) - 16))}px`;
    if (rail.style.getPropertyValue(heightProperty) !== height)
      rail.style.setProperty(heightProperty, height);
    // CSS gives the capsule the logical list height, capped by the scrollport.
    // Rendering fewer rows therefore cannot prevent this measurement growing again.
    options.onCapacityChange(
      Math.max(1, Math.floor((rail.clientHeight - 8) / 44)),
    );
  };
  const scheduleFit = () => {
    if (!disposed && layoutFrame === null)
      layoutFrame = view?.requestAnimationFrame(fitVisibleHeight) ?? null;
  };
  const resizeObserver = view?.ResizeObserver
    ? new view.ResizeObserver(scheduleFit)
    : null;
  for (const node of new Set([
    rail.parentElement,
    ...clippingAncestors.map(({ node }) => node),
  ]))
    if (node) resizeObserver?.observe(node);
  fitVisibleHeight();

  const moveTo = (index: number, focus = false) => {
    if (options.isDisabled()) return;
    const items = options.getItems();
    const value = items[Math.max(0, Math.min(items.length - 1, index))];
    if (value !== undefined && (value !== options.getValue() || focus))
      options.onSelect(value, focus);
  };
  const moveBy = (steps: number, focus = false) =>
    moveTo(
      Math.max(0, options.getItems().indexOf(options.getValue())) + steps,
      focus,
    );
  const stop = () => {
    const capturedId = pointerId;
    pointerId = null;
    pendingButton = null;
    moreClickIntent = null;
    dragDistance = 0;
    edgeDirection = 0;
    if (frame !== null) view?.cancelAnimationFrame(frame);
    frame = null;
    if (capturedId !== null && rail.hasPointerCapture(capturedId))
      rail.releasePointerCapture(capturedId);
  };
  const tick = (time: number) => {
    frame = null;
    if (pointerId === null || options.isDisabled()) {
      stop();
      return;
    }
    const bounds = visibleBounds();
    const direction =
      pointerX < bounds.left ||
      pointerX > bounds.right ||
      bounds.bottom <= bounds.top
        ? 0
        : pointerY <= bounds.top + 22
          ? -1
          : pointerY >= bounds.bottom - 22
            ? 1
            : 0;
    if (direction !== edgeDirection) {
      edgeDirection = direction;
      edgeSince = time;
      edgeLastStep = time;
    }
    if (direction && time - edgeSince >= 400 && time - edgeLastStep >= 220) {
      moveBy(direction);
      dragDistance = 0;
      edgeLastStep = time;
    }
    if (pointerId !== null) frame = view?.requestAnimationFrame(tick) ?? null;
  };
  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null) return;
    suppressPointerClick = false;
    moreClickIntent = null;
    const button = (
      event.target as Element | null
    )?.closest?.<HTMLButtonElement>("button");
    if (
      !button ||
      !rail.contains(button) ||
      button.disabled ||
      options.isDisabled() ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    // A height/focus change can reuse this ellipsis button for a different
    // window boundary before click fires. Preserve the pressed target.
    const moreTarget = button.getAttribute("data-history-initial-more-target");
    if (moreTarget !== null)
      moreClickIntent = { target: moreTarget, source: "pointer" };
    fitVisibleHeight();
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = lastPointerY = event.clientY;
    dragDistance = 0;
    // All/group/ellipsis taps keep their native click action; moving starts a drag.
    if (!button.hasAttribute("data-history-initial-character")) {
      pendingButton = button;
      return;
    }
    try {
      rail.setPointerCapture(event.pointerId);
    } catch {
      pointerId = null;
      return;
    }
    suppressPointerClick = true;
    event.preventDefault();
    button.focus({ preventScroll: true });
    const initial = button.getAttribute("data-history-initial");
    if (initial !== null) options.onSelect(initial);
    if (pointerId !== null) frame = view?.requestAnimationFrame(tick) ?? null;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (
      options.isDisabled() ||
      (event.pointerType === "mouse" && event.buttons === 0)
    ) {
      stop();
      return;
    }
    if (pendingButton) {
      if (Math.abs(event.clientY - lastPointerY) < 6) return;
      try {
        rail.setPointerCapture(event.pointerId);
      } catch {
        stop();
        return;
      }
      const initial = pendingButton.getAttribute("data-history-initial");
      pendingButton = null;
      moreClickIntent = null;
      suppressPointerClick = true;
      if (initial !== null) options.onSelect(initial);
      frame = view?.requestAnimationFrame(tick) ?? null;
    }
    event.preventDefault();
    pointerX = event.clientX;
    pointerY = event.clientY;
    const bounds = visibleBounds();
    if (pointerX >= bounds.left && pointerX <= bounds.right) {
      dragDistance += pointerY - lastPointerY;
      const steps = getHistoryDictionaryInitialDragSteps(dragDistance);
      if (steps) {
        moveBy(steps);
        dragDistance -= steps * 44;
      }
    } else dragDistance = 0;
    lastPointerY = pointerY;
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const focus = event.type === "pointerup" && !pendingButton;
    const intent =
      event.type === "pointerup" && pendingButton ? moreClickIntent : null;
    stop();
    moreClickIntent = intent;
    if (focus) options.onFocus?.(options.getValue());
  };
  const onLostPointerCapture = (event: PointerEvent) => {
    // Moving touch capture from a button to the rail also emits a bubbling
    // lostpointercapture for that button; the rail still owns the gesture.
    if (event.target === rail) onPointerEnd(event);
  };
  const onOutsidePointerMove = (event: PointerEvent) => {
    if (!rail.contains(event.target as Node)) onPointerMove(event);
  };
  const onOutsidePointerEnd = (event: PointerEvent) => {
    if (!rail.contains(event.target as Node)) onPointerEnd(event);
  };
  const onClick = (event: MouseEvent) => {
    if (suppressPointerClick && event.detail > 0) {
      suppressPointerClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const intent = moreClickIntent;
    moreClickIntent = null;
    if (
      intent &&
      !options.isDisabled() &&
      (intent.source === "pointer" ? event.detail > 0 : event.detail === 0)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.onSelect(intent.target, true);
    }
  };
  const onWheel = (event: WheelEvent) => {
    if (
      options.isDisabled() ||
      event.ctrlKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      !event.deltaY
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 80 : 1);
    if (
      event.timeStamp - lastWheelTime > 180 ||
      wheelDirection !== Math.sign(delta)
    ) {
      wheelDistance = 0;
      lastWheelStep = -Infinity;
    }
    lastWheelTime = event.timeStamp;
    wheelDirection = Math.sign(delta);
    wheelDistance = Math.max(-144, Math.min(144, wheelDistance + delta));
    if (
      Math.abs(wheelDistance) >= 48 &&
      event.timeStamp - lastWheelStep >= 120
    ) {
      moveBy(Math.sign(wheelDistance));
      wheelDistance -= Math.sign(wheelDistance) * 48;
      lastWheelStep = event.timeStamp;
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.isDisabled() || event.altKey || event.ctrlKey || event.metaKey)
      return;
    moreClickIntent = null;
    if (event.key === "Enter" || event.key === " ") {
      const button = (
        event.target as Element | null
      )?.closest?.<HTMLButtonElement>(
        "button[data-history-initial-more-target]",
      );
      const target = button?.getAttribute("data-history-initial-more-target");
      if (target != null) moreClickIntent = { target, source: "keyboard" };
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Home") moveTo(0, true);
    else if (event.key === "End") moveTo(options.getItems().length - 1, true);
    else {
      const button = (
        event.target as Element | null
      )?.closest?.<HTMLButtonElement>("button[data-history-initial]");
      const focused = button?.getAttribute("data-history-initial");
      const index = focused == null ? -1 : options.getItems().indexOf(focused);
      moveTo(
        (index >= 0
          ? index
          : Math.max(0, options.getItems().indexOf(options.getValue()))) +
          (event.key === "ArrowUp" ? -1 : 1),
        true,
      );
    }
  };
  rail.addEventListener("pointerdown", onPointerDown);
  rail.addEventListener("pointermove", onPointerMove);
  rail.addEventListener("pointerup", onPointerEnd);
  rail.addEventListener("pointercancel", onPointerEnd);
  rail.addEventListener("lostpointercapture", onLostPointerCapture);
  rail.addEventListener("click", onClick, { capture: true });
  rail.addEventListener("wheel", onWheel, { passive: false });
  rail.addEventListener("keydown", onKeyDown);
  ownerDocument.addEventListener("pointermove", onOutsidePointerMove);
  ownerDocument.addEventListener("pointerup", onOutsidePointerEnd);
  ownerDocument.addEventListener("pointercancel", onOutsidePointerEnd);
  view?.addEventListener("blur", stop);
  ownerDocument.addEventListener("scroll", scheduleFit, {
    capture: true,
    passive: true,
  });
  view?.addEventListener("resize", scheduleFit);
  view?.visualViewport?.addEventListener("resize", scheduleFit);
  view?.visualViewport?.addEventListener("scroll", scheduleFit);
  return {
    cancel: stop,
    refresh: fitVisibleHeight,
    dispose() {
      disposed = true;
      stop();
      rail.removeEventListener("pointerdown", onPointerDown);
      rail.removeEventListener("pointermove", onPointerMove);
      rail.removeEventListener("pointerup", onPointerEnd);
      rail.removeEventListener("pointercancel", onPointerEnd);
      rail.removeEventListener("lostpointercapture", onLostPointerCapture);
      rail.removeEventListener("click", onClick, { capture: true });
      rail.removeEventListener("wheel", onWheel);
      rail.removeEventListener("keydown", onKeyDown);
      ownerDocument.removeEventListener("pointermove", onOutsidePointerMove);
      ownerDocument.removeEventListener("pointerup", onOutsidePointerEnd);
      ownerDocument.removeEventListener("pointercancel", onOutsidePointerEnd);
      view?.removeEventListener("blur", stop);
      ownerDocument.removeEventListener("scroll", scheduleFit, {
        capture: true,
      });
      view?.removeEventListener("resize", scheduleFit);
      view?.visualViewport?.removeEventListener("resize", scheduleFit);
      view?.visualViewport?.removeEventListener("scroll", scheduleFit);
      resizeObserver?.disconnect();
      if (layoutFrame !== null) view?.cancelAnimationFrame(layoutFrame);
      layoutFrame = null;
      if (originalHeight)
        rail.style.setProperty(
          heightProperty,
          originalHeight,
          originalHeightPriority,
        );
      else rail.style.removeProperty(heightProperty);
    },
  };
}
