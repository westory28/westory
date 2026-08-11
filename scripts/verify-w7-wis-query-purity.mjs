import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const clientPaths = [
  "src/lib/wisEconomy.ts",
  "src/pages/student/WisEconomyStudentView.tsx",
  "src/pages/teacher/WisEconomyManager.tsx",
];
const mutationPattern = /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|deleteObject)\s*\(/u;
for (const path of clientPaths) {
  const source = read(path);
  assert.doesNotMatch(source, mutationPattern, `${path} retains a direct SDK mutation.`);
  assert.doesNotMatch(source, /from\s+["']firebase\/(?:firestore|storage)["']/u, `${path} imports a direct persistence SDK.`);
}
const client = read(clientPaths[0]);
assert.match(client, /getWisEconomyState/u);
for (const command of ["createSemesterEconomy", "createWisAccounts", "grantInitialWis", "grantWis", "deductWis", "adjustWis", "reverseWisEntry", "rebuildWisProjection", "transitionWisEconomy", "upsertWisProduct", "upsertWisInventory", "placeWisOrder", "reviewWisOrder"]) {
  assert.ok(read("functions/wisEconomy.js").includes(command), `Missing W7 command ${command}.`);
}
const analysis = analyzeClientBoundary({ rootDir: process.cwd() });
const owned = new Set(clientPaths);
const forbidden = analysis.observations.filter((entry) => owned.has(entry.file) && ["FIRESTORE", "STORAGE"].includes(entry.boundary));
assert.deepEqual(forbidden, []);
const implicit = analysis.observations.filter((entry) => owned.has(entry.file) && entry.triggers.some((trigger) => ["MOUNT", "LISTENER", "TIMER", "UNMOUNT"].includes(trigger)) && entry.boundary !== "QUERY_CALLABLE");
assert.deepEqual(implicit, []);
const app = read("src/App.tsx");
assert.match(app, /import\("\.\/pages\/student\/WisEconomyStudentView"\)/u);
assert.match(app, /import\("\.\/pages\/teacher\/WisEconomyManager"\)/u);
const studentMenuAccess = read("src/lib/studentMenuAccess.ts");
assert.match(studentMenuAccess, /"\/student\/points": new Set\(\["semesterId", "source"\]\)/u);
assert.match(studentMenuAccess, /targetHasMenuSearchParams/u);
const rules = read("firestore.rules");
for (const name of ["semester_wis_economies", "semester_wis_accounts", "semester_wis_ledger", "semester_wis_balances", "semester_wis_rankings", "wis_product_catalog", "semester_wis_inventory", "semester_wis_orders", "semester_wis_reconciliation_reports", "wis_legacy_issues"]) {
  assert.match(rules, new RegExp(`match /${name}/\\{documentId\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`, "u"));
}
console.log(JSON.stringify({ suite: "w7-wis-query-purity", passed: true, directReads: 0, directWrites: 0, implicitWrites: 0, queryCallable: "getWisEconomyState", productionAccess: 0 }));
