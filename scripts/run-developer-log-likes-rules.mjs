import { spawnSync } from "node:child_process";
import { join, delimiter } from "node:path";

const env = { ...process.env };
if (process.platform === "win32") {
  // Match the score-request runner: use the real JVM instead of javapath.
  const java = spawnSync("java", ["-XshowSettings:properties", "-version"], {
    encoding: "utf8",
  });
  const javaHome = /^\s*java\.home\s*=\s*(.+)$/m
    .exec(java.stderr || "")?.[1]
    .trim();
  if (!javaHome || java.status !== 0)
    throw new Error("Cannot locate the Firestore emulator JDK.");
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  env[pathKey] = join(javaHome, "bin") + delimiter + env[pathKey];
}

const baseline = process.argv.includes("--reproduce-baseline")
  ? " --reproduce-baseline"
  : "";
const run = spawnSync(
  'firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-developer-log-likes "node scripts/verify-developer-log-likes-rules.mjs' +
    baseline +
    '"',
  { shell: true, env, stdio: "inherit" },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
