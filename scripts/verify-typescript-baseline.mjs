import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baseline = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./typescript-baseline-w11.json", import.meta.url)),
    "utf8",
  ),
);

let output = "";
const tscPath = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
try {
  output = execFileSync(
    process.execPath,
    [tscPath, "--noEmit", "--pretty", "false"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  output = `${error.stdout || ""}${error.stderr || ""}`;
}

const normalizeMessage = (message) =>
  message
    .replace(
      /import\("[A-Za-z]:\/[^"\r\n]+?\/src\//gu,
      'import("<workspace>/src/',
    )
    .replace(
      /Pick<PerformanceScoreItem,\s*"[^>]+">/gu,
      "Pick<PerformanceScoreItem, <keys>>",
    );
const diagnostics = output
  .split(/\r?\n/)
  .map((line) =>
    line.match(/^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$/),
  )
  .filter(Boolean)
  .map((match) => ({
    file: match[1].replaceAll("\\", "/"),
    code: match[2],
    message: normalizeMessage(match[3]),
  }));
const files = new Set(
  diagnostics.map((diagnostic) => diagnostic.file),
);
const actualCounts = new Map();
for (const diagnostic of diagnostics) {
  const signature = `${diagnostic.file}|${diagnostic.code}|${diagnostic.message}`;
  actualCounts.set(signature, (actualCounts.get(signature) || 0) + 1);
}
const allowedCounts = new Map(
  baseline.signatures.map((item) => [normalizeMessage(item.signature), item.count]),
);
const newDiagnostics = [...actualCounts]
  .filter(
    ([signature, count]) =>
      !allowedCounts.has(signature) || count > allowedCounts.get(signature),
  )
  .map(([signature, count]) => ({
    signature,
    count,
    allowed: allowedCounts.get(signature) || 0,
  }));
if (
  diagnostics.length > baseline.expectedErrors ||
  files.size > baseline.expectedFiles ||
  newDiagnostics.length > 0
) {
  throw new Error(
    `TypeScript baseline drift: errors=${diagnostics.length}/${baseline.expectedErrors}, files=${files.size}/${baseline.expectedFiles}, new=${JSON.stringify(newDiagnostics)}`,
  );
}

console.log(
  `TypeScript baseline: PASS (${diagnostics.length} errors / ${files.size} files / new 0 / removed ${baseline.expectedErrors - diagnostics.length})`,
);
