import { spawnSync } from "node:child_process";
import { join, delimiter } from "node:path";

const env = { ...process.env };
if (process.platform === "win32") {
  // The Oracle javapath launcher can leave its child holding the emulator port
  // after Firebase exits. Let Firebase own the JVM process it needs to stop.
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

const run = spawnSync(
  'firebase emulators:exec --only firestore --config firebase.student-access-test.json --project demo-westory-score-requests "node scripts/verify-score-request-rules.mjs"',
  { shell: true, env, stdio: "inherit" },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
