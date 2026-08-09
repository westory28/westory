import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const EXPECTED_ERROR_COUNT = 63;
const EXPECTED_FILE_COUNT = 13;
const EXPECTED_HEADER_SHA256 =
  "d12acd9bf8b88cff88da0009e010c42b7b6809ee658e38d8dfaa5351c11afc80";

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

const diagnostics = output
  .split(/\r?\n/)
  .map((line) => line.match(/^(.+?\(\d+,\d+\): error TS\d+:)/)?.[1])
  .filter(Boolean)
  .map((header) => header.replaceAll("\\", "/"))
  .sort();
const files = new Set(
  diagnostics.map((header) => header.replace(/\(\d+,\d+\): error TS\d+:$/, "")),
);
const fingerprint = createHash("sha256")
  .update(`${diagnostics.join("\n")}\n`)
  .digest("hex");

if (
  diagnostics.length !== EXPECTED_ERROR_COUNT ||
  files.size !== EXPECTED_FILE_COUNT ||
  fingerprint !== EXPECTED_HEADER_SHA256
) {
  throw new Error(
    `TypeScript baseline drift: errors=${diagnostics.length}, files=${files.size}, fingerprint=${fingerprint}`,
  );
}

console.log(
  `TypeScript baseline: PASS (${diagnostics.length} errors / ${files.size} files / ${fingerprint})`,
);
