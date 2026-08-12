import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";

const productionProjectId = "history-quiz-yongsin";
const ports = [5001, 8080, 9099, 9150, 9199];
const suites = [
  { script: "verify:w6b-emulator-suite", projectId: "demo-westory-session-w6b" },
  { script: "verify:w7-emulator-suite", projectId: "demo-westory-session-w7" },
];

const exactFirestoreProcesses = (projectId) => {
  assert.notEqual(projectId, productionProjectId);
  if (process.platform === "win32") {
    const command = [
      "$items = Get-CimInstance Win32_Process | Where-Object {",
      "$_.Name -eq 'java.exe' -and",
      "$_.CommandLine -like '*cloud-firestore-emulator*' -and",
      `$_.CommandLine -like '*--project_id ${projectId}*'`,
      "} | Select-Object ProcessId,CommandLine;",
      "$items | ConvertTo-Json -Compress",
    ].join(" ");
    const query = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(query.status, 0, `Could not inspect ${projectId}.`);
    const output = String(query.stdout || "").trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      commandLine: String(item.CommandLine || ""),
    }));
  }
  const query = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  assert.equal(query.status, 0, `Could not inspect ${projectId}.`);
  return String(query.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/u))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), commandLine: match[2] }))
    .filter(
      (item) =>
        item.commandLine.includes("cloud-firestore-emulator") &&
        item.commandLine.includes(`--project_id ${projectId}`),
    );
};

const listening = async (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

let exactOrphansTerminated = 0;
for (const suite of suites) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/s", "/c", `npm run ${suite.script}`],
          { cwd: process.cwd(), env: process.env, stdio: "inherit" },
        )
      : spawnSync("npm", ["run", suite.script], {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
        });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const orphans = exactFirestoreProcesses(suite.projectId);
  for (const orphan of orphans) {
    assert.match(orphan.commandLine, /cloud-firestore-emulator/u);
    assert.ok(orphan.commandLine.includes(`--project_id ${suite.projectId}`));
    process.kill(orphan.pid, "SIGTERM");
    exactOrphansTerminated += 1;
  }
  if (orphans.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const occupiedPorts = (
    await Promise.all(ports.map(async (port) => ((await listening(port)) ? port : null)))
  ).filter(Boolean);
  assert.deepEqual(exactFirestoreProcesses(suite.projectId), []);
  assert.deepEqual(occupiedPorts, [], `${suite.script} left emulator ports occupied.`);
  assert.equal(result.error, undefined, `${suite.script} could not start.`);
  assert.equal(result.status, 0, `${suite.script} failed with ${result.status}.`);
}

console.log(
  JSON.stringify({
    suite: "w8-prior-emulator-regressions",
    passed: true,
    priorSuites: suites.map(({ script }) => script),
    exactOrphansTerminated,
    residualProcesses: 0,
    residualPorts: 0,
    productionAccess: 0,
  }),
);
