/** Local synthetic gameplay geometry and input regression; no production reads/writes. */
process.env.YUT_MOVEMENT_QA_SECTION = "board-layout";
await import("./verify-yut-movement-browser.mjs");
