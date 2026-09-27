import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/constants/historyDictionaryPanels.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const { getHistoryDictionaryPanel, HISTORY_DICTIONARY_PANELS } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const resolve = (query, canWrite = true) =>
  getHistoryDictionaryPanel(new URLSearchParams(query), canWrite);

assert.equal(resolve(""), "terms");
assert.equal(resolve("panel=unknown"), "terms");
for (const { id } of HISTORY_DICTIONARY_PANELS) {
  assert.equal(resolve(`panel=${id}`), id);
}
assert.equal(resolve("requestId=request-1"), "requests");
assert.equal(resolve("panel=terms&requestId=request-1"), "requests");
assert.equal(resolve("panel=upload", false), "terms");
assert.equal(resolve("panel=studentWords", false), "studentWords");
assert.equal(resolve("panel=requests", false), "requests");
// Returning to the base URL must restore registered terms after another panel.
assert.deepEqual(
  ["", "panel=studentWords", "panel=requests", "panel=upload", ""].map(
    (query) => resolve(query),
  ),
  ["terms", "studentWords", "requests", "upload", "terms"],
);
console.log("Dictionary panel navigation checks passed.");
