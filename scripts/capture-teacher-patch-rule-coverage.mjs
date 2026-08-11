import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectId = "demo-westory-teacher-patch-notes";
const outputPath = resolve(
  process.env.WESTORY_RULE_COVERAGE_OUTPUT ||
    "docs/evidence/w1r4-rules-budget/rule-coverage.json",
);

const testResult = spawnSync(
  process.execPath,
  [resolve("scripts/verify-teacher-patch-notes-rules.mjs")],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);

if (testResult.stdout) process.stdout.write(testResult.stdout);
if (testResult.stderr) process.stderr.write(testResult.stderr);

const coverageResponse = await fetch(
  `http://127.0.0.1:8080/emulator/v1/projects/${projectId}:ruleCoverage`,
);

if (!coverageResponse.ok) {
  throw new Error(
    `Firestore Rules coverage request failed with ${coverageResponse.status}.`,
  );
}

const coverage = await coverageResponse.json();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

if (testResult.error) throw testResult.error;
process.exitCode = Number.isInteger(testResult.status) ? testResult.status : 1;
