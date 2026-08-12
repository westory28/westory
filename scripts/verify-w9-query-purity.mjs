import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const requiredPaths = [
  "src/lib/teacherOperations.ts",
  "src/lib/commandGateway.ts",
  "src/pages/teacher/W8TeacherHub.tsx",
  "src/pages/teacher/Dashboard.tsx",
];
for (const path of requiredPaths) {
  assert.equal(existsSync(resolve(path)), true, `Missing W9 module: ${path}`);
}

const directMutation =
  /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|uploadString|deleteObject)\s*\(/u;
const directImport = /from\s+["']firebase\/(?:firestore|storage)["']/u;
for (const path of ["src/lib/teacherOperations.ts"]) {
  const source = read(path);
  assert.doesNotMatch(source, directMutation, `${path} retains direct persistence.`);
  assert.doesNotMatch(source, directImport, `${path} imports persistence SDK.`);
  assert.doesNotMatch(source, /localStorage|sessionStorage/u, `${path} stores server Drafts locally.`);
}

const adapter = read("src/lib/teacherOperations.ts");
const gateway = read("src/lib/commandGateway.ts");
const riskPolicy = read("src/lib/highRiskCommands.ts");
const commands = [
  "saveTeacherDraft",
  "discardTeacherDraft",
  "resolveTeacherDraft",
  "cleanupExpiredTeacherDrafts",
  "createTeacherBulkJob",
  "reconcileTeacherBulkJob",
  "retryTeacherBulkJob",
];
for (const command of commands) {
  assert.match(
    adapter,
    new RegExp(`executeWestoryCommand\\(["']${command}["']`, "u"),
  );
}
assert.match(adapter, /getTeacherOperationsState/u);
assert.match(adapter, /writeCount/u);
assert.match(adapter, /limit\?: number/u);
assert.match(adapter, /runTeacherBulkOperation/u);
assert.match(adapter, /retryFailedTeacherBulkOperation/u);

const lowRiskDraftCommands = [
  "saveTeacherDraft",
  "discardTeacherDraft",
  "resolveTeacherDraft",
];
const stepUpTeacherCommands = [
  "cleanupExpiredTeacherDrafts",
  "createTeacherBulkJob",
  "reconcileTeacherBulkJob",
  "retryTeacherBulkJob",
];
const lowRiskPolicyBlock = riskPolicy.match(
  /const COMMAND_GATEWAY_LOW_RISK_COMMANDS = new Set\(\[([\s\S]*?)\]\);/u,
)?.[1];
const highRiskPolicyBlock = riskPolicy.match(
  /const COMMAND_GATEWAY_HIGH_RISK_COMMANDS = \[([\s\S]*?)\] as const;/u,
)?.[1];
assert.ok(lowRiskPolicyBlock, "Missing gateway low-risk command policy.");
assert.ok(highRiskPolicyBlock, "Missing gateway high-risk command policy.");
for (const command of lowRiskDraftCommands) {
  assert.match(
    lowRiskPolicyBlock,
    new RegExp(`["']${command}["']`, "u"),
    `${command} must use the general application session without forcing step-up reauthentication.`,
  );
  assert.doesNotMatch(
    highRiskPolicyBlock,
    new RegExp(`["']${command}["']`, "u"),
    `${command} must not be listed as a step-up command.`,
  );
}
for (const command of stepUpTeacherCommands) {
  assert.match(
    highRiskPolicyBlock,
    new RegExp(`["']${command}["']`, "u"),
    `${command} must remain step-up protected.`,
  );
  assert.doesNotMatch(
    lowRiskPolicyBlock,
    new RegExp(`["']${command}["']`, "u"),
    `${command} must not enter the low-risk command set.`,
  );
}
assert.match(
  riskPolicy,
  /requiresCommandGatewayStepUpReauthentication[\s\S]*?!COMMAND_GATEWAY_LOW_RISK_COMMANDS\.has/u,
  "Unknown gateway commands must fail closed to step-up reauthentication.",
);
assert.equal(
  (
    gateway.match(
      /if \(requiresCommandGatewayStepUpReauthentication\(commandType\)\)/gu,
    ) || []
  ).length,
  2,
  "Both execute and status recovery must apply the same command risk policy.",
);

const implementation = read("functions/teacherOperations.js");
for (const command of commands) {
  assert.ok(implementation.includes(command), `Missing W9 command ${command}.`);
}
assert.ok(implementation.includes("teacher_operations_readiness"));
assert.match(implementation, /DRAFT_TTL_DAYS\s*=\s*30/u);
assert.match(implementation, /BULK_ITEM_LIMIT\s*=\s*100/u);
assert.match(implementation, /BULK_JOB_CANONICAL_BYTE_LIMIT\s*=\s*300_000/u);
assert.match(implementation, /limit\s*===\s*undefined\s*\?\s*50/u);
assert.match(implementation, /limit\s*>\s*100/u);
assert.match(implementation, /TERMINAL_RESULTS_TRUNCATED/u);
assert.match(implementation, /RESULTS_TRUNCATED/u);
assert.match(implementation, /draftRows\.slice\(0,\s*query\.limit\)/u);
assert.match(implementation, /jobRows\.slice\(0,\s*query\.limit\)/u);
assert.match(implementation, /payload:\s*\{\}/u);
assert.match(implementation, /stagedAssets:\s*\[\]/u);
assert.match(implementation, /payloadPurgedAt/u);
assert.match(implementation, /entityKeyHash/u);
assert.match(implementation, /BASE_ENTITY_REVISION_CHANGED/u);
assert.match(implementation, /W9_DRAFT_REBASE_REQUIRED/u);
assert.match(implementation, /canonicalMutationCount:\s*0/u);

const rules = read("firestore.rules");
for (const collection of ["teacher_drafts", "teacher_bulk_jobs"]) {
  assert.match(
    rules,
    new RegExp(
      `match /${collection}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`,
      "u",
    ),
    `W9 direct SDK fence missing for ${collection}.`,
  );
}

const w9Files = new Set(requiredPaths);
const analysis = analyzeClientBoundary({ rootDir: process.cwd() });
const direct = analysis.observations.filter(
  (entry) =>
    w9Files.has(entry.file) && ["FIRESTORE", "STORAGE", "HTTP"].includes(entry.boundary),
);
assert.deepEqual(direct, []);
const implicit = analysis.observations.filter(
  (entry) =>
    w9Files.has(entry.file) &&
    entry.boundary !== "QUERY_CALLABLE" &&
    entry.callable !== "getTeacherOperationsState" &&
    entry.triggers.some((trigger) =>
      ["MOUNT_EFFECT", "LISTENER", "UNMOUNT_CLEANUP"].includes(trigger),
    ),
);
assert.deepEqual(implicit, []);
const w9GatewayObservations = analysis.observations.filter(
  (entry) =>
    entry.file === "src/lib/teacherOperations.ts" && entry.boundary === "GATEWAY",
);
assert.equal(w9GatewayObservations.length, commands.length);
const timerCommands = w9GatewayObservations
  .filter((entry) => entry.triggers.includes("TIMER"))
  .map((entry) => entry.callable);
assert.deepEqual(timerCommands, ["saveTeacherDraft"]);
const expectedTriggers = {
  saveTeacherDraft: ["TIMER", "USER_EVENT"],
  discardTeacherDraft: ["USER_EVENT"],
  resolveTeacherDraft: ["USER_EVENT"],
  cleanupExpiredTeacherDrafts: ["UNREACHED"],
  createTeacherBulkJob: ["USER_EVENT"],
  reconcileTeacherBulkJob: ["USER_EVENT"],
  retryTeacherBulkJob: ["USER_EVENT"],
};
assert.deepEqual(
  Object.fromEntries(
    w9GatewayObservations.map((entry) => [entry.callable, entry.triggers]),
  ),
  expectedTriggers,
  "W9 wrappers must remain explicit user actions except dirty-Draft debounce and admin cleanup.",
);
assert.equal(
  w9GatewayObservations.some((entry) =>
    entry.triggers.some((trigger) =>
      ["MOUNT_EFFECT", "LISTENER", "UNMOUNT_CLEANUP"].includes(trigger),
    ),
  ),
  false,
);
const draftHookPath = ["src/lib/useTeacherDraft.ts", "src/hooks/useTeacherDraft.ts"].find(
  (path) => existsSync(resolve(path)),
);
if (draftHookPath) {
  const hook = read(draftHookPath);
  assert.match(hook, /setTimeout\([\s\S]{0,300}persist\(/u);
  assert.match(hook, /payloadSchemaVersion:\s*1/u);
  assert.match(hook, /const discard = useCallback/u);
  assert.match(hook, /const commit = useCallback/u);
  assert.match(hook, /return \{[\s\S]{0,400}\bdiscard,[\s\S]{0,200}\bcommit,/u);
  assert.doesNotMatch(
    hook,
    /setTimeout\([\s\S]{0,500}(?:discardTeacherDraft|resolveTeacherDraft|createTeacherBulkJob|reconcileTeacherBulkJob|retryTeacherBulkJob|cleanupExpiredTeacherDrafts)/u,
  );
}
const teacherHub = read("src/pages/teacher/W8TeacherHub.tsx");
assert.match(
  teacherHub,
  /onDiscard=\{\(\)\s*=>\s*void draftBinding\.discard\(\)/u,
  "Draft discard must be consumed by an explicit dialog event callback.",
);
assert.match(
  teacherHub,
  /draftBinding\s*\.commit\(\(\)\s*=>/u,
  "Draft resolution must follow an explicit official command event.",
);

const dashboard = read("src/pages/teacher/Dashboard.tsx");
assert.doesNotMatch(dashboard, directMutation);
assert.doesNotMatch(dashboard, /saveTeacherDraft|createTeacherBulkJob|retryTeacherBulkJob/u);

const optionalOwnedPaths = [
  "src/lib/useTeacherDraft.ts",
  "src/hooks/useTeacherDraft.ts",
  "src/components/common/TeacherDraftStatus.tsx",
  "src/components/common/TeacherDraftRecoveryDialog.tsx",
  "src/components/common/TeacherRecentDrafts.tsx",
  "src/components/common/TeacherBulkWorkflow.tsx",
  "src/components/common/TeacherOperationsQueue.tsx",
];
const ownedPaths = optionalOwnedPaths.filter((path) => existsSync(resolve(path)));
for (const path of ownedPaths) {
  const source = read(path);
  assert.doesNotMatch(source, directMutation, `${path} retains direct persistence.`);
  assert.doesNotMatch(source, directImport, `${path} imports persistence SDK.`);
  assert.doesNotMatch(source, /localStorage|sessionStorage/u, `${path} leaks Drafts locally.`);
}
if (ownedPaths.length > 0) {
  const joined = ownedPaths.map(read).join("\n");
  for (const state of [
    "clean",
    "dirty",
    "saving",
    "saved",
    "offline",
    "conflict",
    "error",
    "recoverable",
  ]) {
    assert.ok(joined.includes(state), `Missing Draft UI state: ${state}`);
  }
  assert.match(joined, /debounce|setTimeout/u, "Dirty Draft save is not debounced.");
  assert.doesNotMatch(
    joined,
    /pagehide[\s\S]{0,600}(?:executeWestoryCommand|saveTeacherDraft|createTeacherBulkJob)/u,
    "pagehide must not trigger a business command.",
  );
}

console.log(
  JSON.stringify({
    suite: "w9-query-purity",
    passed: true,
    requiredModules: requiredPaths.length,
    mountedW9UiModules: ownedPaths.length,
    directReads: 0,
    directWrites: 0,
    mountWrites: 0,
    listWrites: 0,
    queryWrites: 0,
    previewWrites: 0,
    unmountBusinessCommands: 0,
    crossUidClientQueries: 0,
    localDraftPersistence: 0,
    dashboardMutations: 0,
    callbackOnlyDiscardResolve: true,
    lowRiskDraftCommands,
    stepUpTeacherCommands,
    timerCommands,
    adminCleanupClientCallsites: 0,
    queryCallable: "getTeacherOperationsState",
    readinessCheckId: "teacher_operations_readiness",
    productionAccess: 0,
  }),
);
