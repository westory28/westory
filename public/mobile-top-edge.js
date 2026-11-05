// Run before the first paint in both the portal and standalone documents.
(() => {
  const iosHomeScreen =
    navigator.standalone === true ||
    (matchMedia("(display-mode: standalone)").matches &&
      CSS.supports("-webkit-touch-callout", "none"));

  if (iosHomeScreen) {
    // A fixed element at the top can suppress WebKit's own scroll-edge effect.
    document.documentElement.setAttribute("data-system-top-edge", "");
    return;
  }

  // Browsers using the web blur can draw into the hardware safe area.
  document.querySelector('meta[name="viewport"]').content += ", viewport-fit=cover";
})();
