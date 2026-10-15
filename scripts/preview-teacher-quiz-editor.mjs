/** Local, synthetic-only preview of the production teacher question composer.
 * Run: node scripts/preview-teacher-quiz-editor.mjs
 * Uses ASSESSMENT_QA_TAILWIND or the existing local QA Tailwind copy.
 * Open http://127.0.0.1:4345/#/?tab=manage, choose a unit, then 문제 등록.
 * /?editor opens the independent formatting / safe-paste round-trip fixture.
 */
process.env.ASSESSMENT_QA_PORT ||= "4345";
await import("./verify-assessment-teacher-browser.mjs");
