export const SESSION_ACTIVITY_EVENT = "westory:session-activity";

const SESSION_ACTIVITY_IGNORE_SELECTOR = '[data-session-ignore="true"]';
const SESSION_CLICK_ACTIVITY_SELECTOR = [
  '[data-session-action="true"]',
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(",");
const SESSION_CHANGE_ACTIVITY_SELECTOR = [
  "select",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
  'input[type="color"]',
  'input[type="date"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="time"]',
  'input[type="week"]',
  'input[type="range"]',
].join(",");
const SESSION_DISABLED_SELECTOR = '[disabled], [aria-disabled="true"]';

const getEventElement = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target : null;

export const isSessionActivityIgnored = (
  target: EventTarget | null,
): boolean => {
  const element = getEventElement(target);
  return Boolean(element?.closest(SESSION_ACTIVITY_IGNORE_SELECTOR));
};

export const getSessionActivityTarget = (
  target: EventTarget | null,
): Element | null => {
  const element = getEventElement(target);
  if (!element || isSessionActivityIgnored(element)) return null;

  const activityTarget = element.closest(SESSION_CLICK_ACTIVITY_SELECTOR);
  if (!activityTarget || isSessionActivityIgnored(activityTarget)) return null;
  if (activityTarget.closest(SESSION_DISABLED_SELECTOR)) return null;
  if (
    activityTarget instanceof HTMLInputElement &&
    activityTarget.type === "hidden"
  ) {
    return null;
  }

  return activityTarget;
};

export const getSessionChangeActivityTarget = (
  target: EventTarget | null,
): Element | null => {
  const element = getEventElement(target);
  if (!element || isSessionActivityIgnored(element)) return null;

  const activityTarget = element.closest(SESSION_CHANGE_ACTIVITY_SELECTOR);
  if (!activityTarget || isSessionActivityIgnored(activityTarget)) return null;
  if (activityTarget.closest(SESSION_DISABLED_SELECTOR)) return null;

  return activityTarget;
};

export const emitSessionActivity = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT));
};
