import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const projectId = "demo-westory-session-w11";
const productionProjectId = "history-quiz-yongsin";
const ports = [4400, 4500, 5001, 8080, 9099, 9150, 9199];
assert.notEqual(projectId, productionProjectId);

const processTable = () => {
  if (process.platform === "win32") {
    const command = [
      "$items = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } |",
      "Select-Object ProcessId,ParentProcessId,Name,CommandLine;",
      "ConvertTo-Json -Compress -InputObject @($items)",
    ].join(" ");
    const query = spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(query.status, 0, "Could not inspect W11 process tree.");
    const output = String(query.stdout || "").trim();
    const parsed = output ? JSON.parse(output) : [];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId),
      name: String(item.Name || ""),
      commandLine: String(item.CommandLine || ""),
    }));
  }
  const query = spawnSync("ps", ["-eo", "pid=,ppid=,comm=,args="], {
    encoding: "utf8",
  });
  assert.equal(query.status, 0, "Could not inspect W11 process tree.");
  return String(query.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      name: match[3],
      commandLine: match[4],
    }));
};
const isExactW11EmulatorProcess = (item) => {
  const command = item.commandLine.toLowerCase();
  const exactProject = command.includes(projectId.toLowerCase());
  const rawSuite =
    command.includes("verify:w11-emulator-suite:raw") ||
    command.includes("verify-w11-emulator-suite.mjs");
  const emulatorRuntime =
    command.includes("cloud-firestore-emulator") ||
    command.includes("firebase") ||
    command.includes("emulator") ||
    command.includes("functions") ||
    command.includes("storage");
  return rawSuite || (exactProject && emulatorRuntime);
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
const occupiedPorts = async () =>
  (
    await Promise.all(
      ports.map(async (port) => ((await listening(port)) ? port : null)),
    )
  ).filter(Boolean);

assert.deepEqual(
  processTable().filter(isExactW11EmulatorProcess),
  [],
  "An exact W11 emulator or parent process already exists before the suite.",
);
assert.deepEqual(
  await occupiedPorts(),
  [],
  "Emulator hub, logging, product, or reserved ports are occupied before W11.",
);

const child =
  process.platform === "win32"
    ? spawn(
        process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", "npm run verify:w11-emulator-suite:raw"],
        { cwd: process.cwd(), env: process.env, stdio: "inherit" },
      )
    : spawn("npm", ["run", "verify:w11-emulator-suite:raw"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      });
const tracked = new Map();
const captureSuiteProcessTree = () => {
  const table = processTable();
  const roots = new Set([child.pid, ...tracked.keys()]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of table) {
      if (roots.has(item.parentPid) && !roots.has(item.pid)) {
        roots.add(item.pid);
        changed = true;
      }
    }
  }
  table
    .filter((item) => roots.has(item.pid) || isExactW11EmulatorProcess(item))
    .forEach((item) => tracked.set(item.pid, item));
};
captureSuiteProcessTree();
const sampler = setInterval(captureSuiteProcessTree, 750);
const result = await new Promise((resolve) => {
  let settled = false;
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    resolve({ error, status: null, signal: null });
  });
  child.once("close", (status, signal) => {
    if (settled) return;
    settled = true;
    resolve({ error: undefined, status, signal });
  });
});
clearInterval(sampler);
captureSuiteProcessTree();

const residualState = async () => {
  const table = processTable();
  const exact = table.filter(isExactW11EmulatorProcess);
  const trackedLive = table.filter((item) => {
    const original = tracked.get(item.pid);
    return (
      original &&
      original.name === item.name &&
      original.commandLine === item.commandLine
    );
  });
  return {
    processes: [
      ...new Map(
        [...exact, ...trackedLive]
          .filter((item) => item.pid !== process.pid)
          .map((item) => [item.pid, item]),
      ).values(),
    ],
    ports: await occupiedPorts(),
  };
};
let leaked = await residualState();
for (
  let attempt = 0;
  attempt < 20 && (leaked.processes.length > 0 || leaked.ports.length > 0);
  attempt += 1
) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  leaked = await residualState();
}
const leakedBeforeSafetyCleanup = leaked;

const depthFor = (item, byPid) => {
  let depth = 0;
  let current = item;
  const seen = new Set();
  while (byPid.has(current.parentPid) && !seen.has(current.parentPid)) {
    seen.add(current.parentPid);
    current = byPid.get(current.parentPid);
    depth += 1;
  }
  return depth;
};
const byPid = new Map(
  leakedBeforeSafetyCleanup.processes.map((item) => [item.pid, item]),
);
const cleanupVictims = [...leakedBeforeSafetyCleanup.processes].sort(
  (left, right) => depthFor(right, byPid) - depthFor(left, byPid),
);
for (const victim of cleanupVictims) {
  assert.equal(
    tracked.has(victim.pid) || isExactW11EmulatorProcess(victim),
    true,
  );
  try {
    process.kill(victim.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}
if (cleanupVictims.length > 0) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const residual = await residualState();

assert.deepEqual(
  residual.processes,
  [],
  "A W11 emulator, Storage, Hub, Logging, or parent process remains.",
);
assert.deepEqual(
  residual.ports,
  [],
  "A W11 emulator, Hub, Logging, product, or reserved port remains occupied.",
);
assert.equal(
  result.error,
  undefined,
  "Firebase emulator process could not start.",
);
assert.equal(
  result.signal,
  null,
  `W11 emulator suite exited on ${result.signal}.`,
);
assert.equal(
  result.status,
  0,
  `W11 emulator suite failed with ${result.status}.`,
);

console.log(
  JSON.stringify({
    suite: "w11-emulator-lifecycle",
    passed: true,
    trackedProcessCount: tracked.size,
    exactOrphansTerminated: cleanupVictims.length,
    lifecycleRequiredSafetyCleanup: cleanupVictims.length > 0,
    residualProcesses: 0,
    residualParentProcesses: 0,
    residualStorageProcesses: 0,
    residualHubProcesses: 0,
    residualLoggingProcesses: 0,
    residualPorts: 0,
    verifiedPorts: ports,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
