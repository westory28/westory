// Choose the scroll edge before the portal paints, including on direct menu links.
(() => {
  const iosHomeScreen =
    navigator.standalone === true ||
    (matchMedia("(display-mode: standalone)").matches &&
      CSS.supports("-webkit-touch-callout", "none"));

  if (!iosHomeScreen) return;

  const viewport = document.querySelector('meta[name="viewport"]');
  const cover = viewport.content;
  const system = cover.replace(/,\s*viewport-fit=cover$/, "");
  const update = () => {
    const path = location.hash.slice(1).split(/[?#]/, 1)[0];
    const dashboard = /^\/(?:teacher|student)\/dashboard\/*$/i.test(path);
    document.documentElement.toggleAttribute("data-system-top-edge", dashboard);
    const next = dashboard ? system : cover;
    if (viewport.content !== next) viewport.content = next;
  };

  update();
  // Router links use pushState, which does not fire hashchange.
  window.addEventListener("westory:routechange", update);
  window.addEventListener("hashchange", update);
  window.addEventListener("pageshow", update);
})();
