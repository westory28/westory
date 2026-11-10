const INTERNAL_PORTAL_PATH = /^\/(?:student|teacher)(?:\/|$)/;
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;
const PARSE_ORIGIN = "https://notification.invalid";

/** Notifications open existing portal screens, never an external destination. */
export const getSafeNotificationTargetUrl = (value: unknown): string => {
  if (typeof value !== "string" || CONTROL_OR_BACKSLASH.test(value)) return "";
  const target = value.trim();
  if (!/^\/(?:student|teacher)(?:\/|[?#]|$)/.test(target)) return "";
  try {
    const url = new URL(target, PARSE_ORIGIN);
    if (
      url.origin !== PARSE_ORIGIN ||
      !INTERNAL_PORTAL_PATH.test(url.pathname) ||
      CONTROL_OR_BACKSLASH.test(decodeURIComponent(url.pathname))
    )
      return "";
    // Preserve the existing route, encoded IDs/titles, query and fragment.
    return target;
  } catch {
    return "";
  }
};
