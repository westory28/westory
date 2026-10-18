interface InitialDragOptions {
  isDisabled: () => boolean;
  onSelect: (initial: string) => void;
}

const INITIAL_SELECTOR = "button[data-history-initial]";
const CHARACTER_SELECTOR = "button[data-history-initial-character]";

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

/** Pixels per second near either end of the rail, including a captured pointer outside it. */
export function getHistoryDictionaryInitialScrollSpeed(
  pointerY: number,
  top: number,
  bottom: number,
): number {
  if (bottom <= top) return 0;
  const edge = Math.min(40, (bottom - top) / 3);
  if (pointerY < top + edge)
    return -480 * Math.min(1, (top + edge - pointerY) / edge);
  if (pointerY > bottom - edge)
    return 480 * Math.min(1, (pointerY - (bottom - edge)) / edge);
  return 0;
}

/** Native pointer listeners keep capture and drag cleanup independent of React renders. */
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
  let lastInitial: string | undefined;
  let suppressPointerClick = false;
  let frame: number | null = null;
  let lastFrameTime: number | null = null;
  let layoutFrame: number | null = null;
  let disposed = false;
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
      bounds = intersectHistoryDictionaryInitialBounds(bounds, {
        left,
        top,
        right: left + (viewport?.width ?? view.innerWidth),
        bottom: top + (viewport?.height ?? view.innerHeight),
      });
    }
    for (const { node, clipX, clipY } of clippingAncestors) {
      bounds = intersectHistoryDictionaryInitialBounds(
        bounds,
        node.getBoundingClientRect(),
        clipX,
        clipY,
      );
    }
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
    const railBounds = rail.getBoundingClientRect();
    const clip = clippingBounds();
    if (railBounds.right <= railBounds.left || !Number.isFinite(clip.bottom))
      return;
    // Use the scrollport bottom, not the rail's current bottom, so the rail can
    // grow again after its sticky position moves upward.
    const height = `${Math.max(44, Math.floor(clip.bottom - Math.max(railBounds.top, clip.top) - 16))}px`;
    if (rail.style.getPropertyValue(heightProperty) !== height)
      rail.style.setProperty(heightProperty, height);
  };

  const scheduleFit = () => {
    if (!disposed && layoutFrame === null)
      layoutFrame = view?.requestAnimationFrame(fitVisibleHeight) ?? null;
  };
  const resizeObserver = view?.ResizeObserver
    ? new view.ResizeObserver(scheduleFit)
    : null;
  const observed = new Set([
    rail.parentElement,
    ...clippingAncestors.map(({ node }) => node),
  ]);
  for (const node of observed) if (node) resizeObserver?.observe(node);
  fitVisibleHeight();

  const findButton = (
    target: EventTarget | null,
    selector = INITIAL_SELECTOR,
  ) => {
    const button = (target as Element | null)?.closest?.<HTMLButtonElement>(
      selector,
    );
    return button && rail.contains(button) && !button.disabled ? button : null;
  };

  const choose = (button: HTMLButtonElement | null) => {
    const initial = button?.getAttribute("data-history-initial");
    if (initial == null || initial === lastInitial || options.isDisabled())
      return;
    lastInitial = initial;
    options.onSelect(initial);
  };

  const chooseAtPointer = () => {
    const bounds = visibleBounds();
    if (
      bounds.bottom <= bounds.top ||
      pointerX < bounds.left ||
      pointerX > bounds.right
    )
      return;
    const inset = Math.min(5, (bounds.bottom - bounds.top) / 2);
    const y = Math.max(
      bounds.top + inset,
      Math.min(bounds.bottom - inset, pointerY),
    );
    choose(findButton(ownerDocument.elementFromPoint(pointerX, y)));
  };

  const stop = () => {
    const capturedId = pointerId;
    pointerId = null;
    lastInitial = undefined;
    lastFrameTime = null;
    if (frame !== null) view?.cancelAnimationFrame(frame);
    frame = null;
    if (capturedId !== null && rail.hasPointerCapture(capturedId)) {
      rail.releasePointerCapture(capturedId);
    }
  };

  const tick = (time: number) => {
    frame = null;
    if (pointerId === null || options.isDisabled()) {
      stop();
      return;
    }
    const bounds = visibleBounds();
    const speed =
      pointerX >= bounds.left && pointerX <= bounds.right
        ? getHistoryDictionaryInitialScrollSpeed(
            pointerY,
            bounds.top,
            bounds.bottom,
          )
        : 0;
    const elapsed =
      lastFrameTime === null ? 16 : Math.min(32, time - lastFrameTime);
    lastFrameTime = time;
    const previousTop = rail.scrollTop;
    rail.scrollTop = Math.max(
      0,
      Math.min(
        rail.scrollHeight - rail.clientHeight,
        previousTop + (speed * elapsed) / 1000,
      ),
    );
    if (rail.scrollTop !== previousTop) chooseAtPointer();
    if (pointerId !== null) frame = view?.requestAnimationFrame(tick) ?? null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null) return;
    suppressPointerClick = false;
    const button = findButton(event.target, CHARACTER_SELECTOR);
    if (
      !button ||
      options.isDisabled() ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    // Filters above the rail can move it without resizing its direct parent.
    fitVisibleHeight();
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    lastInitial = undefined;
    try {
      rail.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that ended before capture still has the normal click path.
      pointerId = null;
      return;
    }
    suppressPointerClick = true;
    event.preventDefault();
    button.focus({ preventScroll: true });
    choose(button);
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
    event.preventDefault();
    pointerX = event.clientX;
    pointerY = event.clientY;
    chooseAtPointer();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === pointerId) stop();
  };

  const onClick = (event: MouseEvent) => {
    // Keyboard/assistive clicks have detail 0 and must retain their native action.
    if (suppressPointerClick && event.detail > 0) {
      suppressPointerClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  rail.addEventListener("pointerdown", onPointerDown);
  rail.addEventListener("pointermove", onPointerMove);
  rail.addEventListener("pointerup", onPointerEnd);
  rail.addEventListener("pointercancel", onPointerEnd);
  rail.addEventListener("lostpointercapture", onPointerEnd);
  rail.addEventListener("click", onClick, { capture: true });
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
    dispose() {
      disposed = true;
      stop();
      rail.removeEventListener("pointerdown", onPointerDown);
      rail.removeEventListener("pointermove", onPointerMove);
      rail.removeEventListener("pointerup", onPointerEnd);
      rail.removeEventListener("pointercancel", onPointerEnd);
      rail.removeEventListener("lostpointercapture", onPointerEnd);
      rail.removeEventListener("click", onClick, { capture: true });
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
