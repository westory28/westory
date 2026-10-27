/** Local synthetic feedback, bottom status and fullscreen gesture regression. */
process.env.YUT_MOVEMENT_QA_SECTION = "interface-stability";
await import("./verify-yut-movement-browser.mjs");
