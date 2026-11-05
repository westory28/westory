// Choose the scroll edge before the portal paints, including on direct menu links.
(() => {
  const iosHomeScreen =
    navigator.standalone === true ||
    (matchMedia("(display-mode: standalone)").matches &&
      CSS.supports("-webkit-touch-callout", "none"));

  if (!iosHomeScreen) return;

  document.documentElement.setAttribute("data-ios-home-screen", "");
  const viewport = document.querySelector('meta[name="viewport"]');
  const cover = viewport.content;
  const system = cover.replace(/,\s*viewport-fit=cover$/, "");
  const overlaySelector =
    '.teacher-sidebar.is-mobile-open, .teacher-mobile-drawer-backdrop, dialog:modal, [aria-modal="true"]:not([hidden])';
  const overlayObserver = new MutationObserver(update);
  let watchingDashboard = false;

  function update() {
    const path = location.hash.slice(1).split(/[?#]/, 1)[0];
    const dashboard = /^\/(?:teacher|student)\/dashboard\/*$/i.test(path);
    // Native dialogs and React drawers can open and close without navigation.
    // Only dashboards can change ownership while staying on the same route.
    if (watchingDashboard !== dashboard) {
      watchingDashboard = dashboard;
      if (dashboard) {
        overlayObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["open", "aria-modal", "hidden"],
        });
      } else {
        overlayObserver.disconnect();
      }
    }
    const useSystemEdge =
      dashboard &&
      !document.fullscreenElement &&
      !Array.from(document.querySelectorAll(overlaySelector)).some(
        (overlay) => overlay.getClientRects().length > 0,
      );
    document.documentElement.toggleAttribute(
      "data-system-top-edge",
      useSystemEdge,
    );
    const next = useSystemEdge ? system : cover;
    if (viewport.content !== next) viewport.content = next;
  }

  update();
  // Router links use pushState, which does not fire hashchange.
  window.addEventListener("westory:routechange", update);
  window.addEventListener("hashchange", update);
  window.addEventListener("pageshow", update);
  document.addEventListener("fullscreenchange", update);
})();
