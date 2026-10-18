/** Synthetic localhost UI coverage; never reads or writes production room data. */
process.env.YUT_MOVEMENT_QA_SECTION = "entry-polish";
await import("./verify-yut-movement-browser.mjs");
