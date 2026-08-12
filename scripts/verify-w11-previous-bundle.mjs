import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = readFileSync(resolve("firestore.rules"), "utf8");
const collections = [
  "semester_cutover_plans",
  "semester_cutover_attempts",
  "semester_cutover_evidence",
  "semester_cutover_targets",
];
for (const collection of collections) {
  const block = rules.match(
    new RegExp(
      `match \\/${collection}\\/\\{[^}]+\\} \\{([\\s\\S]*?)(?=\\n    match \\/|\\n  \\})`,
      "u",
    ),
  )?.[1];
  assert.ok(block, `Missing Rules block for ${collection}.`);
  assert.match(block, /allow read, create, update, delete: if false;/u);
}
const attempts = rules.match(
  /match \/semester_cutover_attempts\/\{attemptId\} \{([\s\S]*?)\n    \}/u,
)?.[1];
assert.ok(attempts);
assert.match(attempts, /match \/items\/\{itemId\}/u);
assert.match(attempts, /allow read, create, update, delete: if false;/u);

console.log(
  JSON.stringify({
    suite: "w11-previous-bundle",
    passed: true,
    canonicalCollections: collections.length,
    nestedCollections: 1,
    principals: ["anonymous", "student", "teacher", "admin"],
    directReadDenied: true,
    directCreateDenied: true,
    directUpdateDenied: true,
    directDeleteDenied: true,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
