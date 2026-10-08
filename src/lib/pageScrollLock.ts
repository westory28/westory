type SavedStyle = {
  style: CSSStyleDeclaration;
  property: string;
  value: string;
  priority: string;
};

const locks = new WeakMap<
  Document,
  { owners: Set<symbol>; styles: SavedStyle[] }
>();

/** Keep overlapping dialogs locked until their last owner closes, in any order. */
export const acquirePageScrollLock = (): (() => void) => {
  if (typeof document === "undefined") return () => {};
  const page = document;
  let state = locks.get(page);
  if (!state) {
    const styles: SavedStyle[] = [];
    for (const element of [page.documentElement, page.body]) {
      for (const [property, value] of [
        ["overflow-x", "hidden"],
        ["overflow-y", "hidden"],
        ["overscroll-behavior-x", "contain"],
        ["overscroll-behavior-y", "contain"],
      ]) {
        styles.push({
          style: element.style,
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        });
        element.style.setProperty(property, value);
      }
    }
    state = { owners: new Set(), styles };
    locks.set(page, state);
  }
  const owner = Symbol();
  state.owners.add(owner);
  return () => {
    if (!state.owners.delete(owner) || state.owners.size) return;
    for (const { style, property, value, priority } of state.styles) {
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    }
    locks.delete(page);
  };
};
