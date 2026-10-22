// Network startup time counts only while the app can make progress in the
// foreground. Installed mobile apps may suspend both requests and timers while
// the Google chooser is open. This does not extend any authentication token,
// server session, device inactivity deadline, or authorization decision.
const deadlines = new Map<number, () => void>();
let nextDeadline = 0;

export const clearAuthDeadline = (id: number) => deadlines.get(id)?.();

export const setAuthDeadline = (
  callback: () => void,
  delay: number,
): number => {
  const id = ++nextDeadline;
  let remaining = delay;
  let startedAt: number | null = null;
  let timer: number | null = null;
  let suspended = false;

  const pause = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (startedAt !== null)
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
    startedAt = null;
  };
  const cancel = () => {
    pause();
    deadlines.delete(id);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  };
  const resume = () => {
    if (timer !== null || document.hidden || suspended) return;
    startedAt = performance.now();
    timer = window.setTimeout(() => {
      if (document.hidden || suspended) {
        // Mobile browsers can deliver a delayed timer before visibilitychange.
        // Its elapsed time then includes an unknown suspension interval.
        startedAt = null;
        pause();
        return;
      }
      cancel();
      callback();
    }, remaining);
  };
  const onVisibility = () => (document.hidden ? pause() : resume());
  const onPageHide = () => {
    suspended = true;
    pause();
  };
  const onPageShow = () => {
    suspended = false;
    resume();
  };

  deadlines.set(id, cancel);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  resume();
  return id;
};
