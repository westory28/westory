export const SESSION_ACTIVITY_EVENT = "westory:session-activity";

export const emitSessionActivity = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT));
};
