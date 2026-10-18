/** Actual game/global styles with synthetic transport; never writes production data. */
process.env.YUT_MOVEMENT_QA_SECTION = "motion-audit";
await import("./verify-yut-movement-browser.mjs");
