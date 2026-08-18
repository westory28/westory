import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const intentSource = readFileSync(
  resolve("src/lib/legacyWisMutationIntent.ts"),
  "utf8",
);
const adapterSource = readFileSync(
  resolve("src/lib/legacyThinkCloudAdapter.ts"),
  "utf8",
);
const studentScreenSource = readFileSync(
  resolve("src/pages/student/lesson/ThinkCloud.tsx"),
  "utf8",
);
const compiledIntent = ts.transpileModule(intentSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const intentDataUrl = `data:text/javascript;base64,${Buffer.from(
  compiledIntent,
).toString("base64")}`;
const intentModule = await import(`${intentDataUrl}#initial`);

assert.match(adapterSource, /getOrCreateLegacyWisMutationIntent/u);
assert.match(adapterSource, /commandId:\s*intent\.commandId/u);
assert.match(adapterSource, /shouldForgetLegacyWisIntentAfterError/u);
assert.match(studentScreenSource, /\(item\)\s*=>\s*item\.isOwn/u);
assert.doesNotMatch(studentScreenSource, /item\.uid/u);
assert.match(
  studentScreenSource,
  /error instanceof W8DomainError && error\.kind === "PERMISSION"[\s\S]*?setResponseLoadState\([\s\S]*?"permission"/u,
);
assert.match(
  studentScreenSource,
  /responseLoadState === "error"[\s\S]*?setResponseLoadAttempt\(\(value\) => value \+ 1\)[\s\S]*?다시 시도/u,
);
assert.match(
  studentScreenSource,
  /responseLoadState === "ready" &&[\s\S]*?cloudEntries\.length === 0/u,
);

const logicalCreateAction = {
  actorUid: "teacher-a",
  description: "수업 핵심어를 적어 주세요.",
  operation: "create",
  options: { anonymous: true, inputMode: "word" },
  semester: "2",
  targetClass: "1",
  targetGrade: "3",
  title: "조선의 통치 체제",
  year: "2026",
};
const beforeReloadKey = intentModule.createStableLegacyMutationActionKey(
  "think-cloud",
  logicalCreateAction,
);
const afterReloadKey = intentModule.createStableLegacyMutationActionKey(
  "think-cloud",
  {
    ...logicalCreateAction,
    options: { inputMode: "word", anonymous: true },
  },
);
assert.equal(afterReloadKey, beforeReloadKey);
assert.notEqual(
  intentModule.createStableLegacyMutationActionKey("think-cloud", {
    ...logicalCreateAction,
    title: "서로 다른 새 주제",
  }),
  beforeReloadKey,
);

const verifyAmbiguousReplay = (kind) => {
  const logicalAction = {
    actorUid: kind === "create" ? "teacher-a" : "student-a",
    kind,
    semester: "2",
    subject: kind === "create" ? "3-1:조선" : "session-a:붕당",
    year: "2026",
  };
  const actionKey = intentModule.createStableLegacyMutationActionKey(
    "think-cloud",
    logicalAction,
  );
  const key = `think-cloud:${kind}:${actionKey}`;
  let builderCalls = 0;
  let effectCount = 0;
  let stateRevision = 1;
  const committed = new Map();
  const first = intentModule.getOrCreateLegacyWisMutationIntent(
    key,
    () => {
      builderCalls += 1;
      return { kind, expectedStateRevision: stateRevision, value: "처음 요청" };
    },
    { storage: null },
  );

  const execute = (intent, loseResponse) => {
    if (!committed.has(intent.commandId)) {
      effectCount += 1;
      stateRevision += 1;
      committed.set(intent.commandId, structuredClone(intent.payload));
    } else {
      assert.deepEqual(committed.get(intent.commandId), intent.payload);
    }
    if (loseResponse) throw { kind: "NETWORK" };
    return { replayed: true };
  };

  try {
    execute(first, true);
  } catch (error) {
    assert.equal(
      intentModule.shouldForgetLegacyWisIntentAfterError(error),
      false,
    );
  }

  const retry = intentModule.getOrCreateLegacyWisMutationIntent(
    `think-cloud:${kind}:${intentModule.createStableLegacyMutationActionKey(
      "think-cloud",
      { ...logicalAction },
    )}`,
    () => {
      builderCalls += 1;
      return { kind, expectedStateRevision: stateRevision, value: "재시도" };
    },
    { storage: null },
  );
  assert.equal(retry.commandId, first.commandId);
  assert.deepEqual(retry.payload, first.payload);
  assert.equal(builderCalls, 1);
  execute(retry, false);
  assert.equal(effectCount, 1);
  intentModule.forgetLegacyWisMutationIntent(key, null);
  return { kind, effectCount, builderCalls };
};

const scenarios = [
  verifyAmbiguousReplay("create"),
  verifyAmbiguousReplay("submit"),
];

const storageValues = new Map();
const reloadStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => storageValues.delete(key),
};
const reloadIntentKey = `think-cloud:create:${beforeReloadKey}`;
let reloadBuilderCalls = 0;
const beforeReloadIntent = intentModule.getOrCreateLegacyWisMutationIntent(
  reloadIntentKey,
  () => {
    reloadBuilderCalls += 1;
    return { expectedStateRevision: 1, title: logicalCreateAction.title };
  },
  { storage: reloadStorage },
);
const reloadedIntentModule = await import(`${intentDataUrl}#after-reload`);
const afterReloadIntent =
  reloadedIntentModule.getOrCreateLegacyWisMutationIntent(
    reloadIntentKey,
    () => {
      reloadBuilderCalls += 1;
      return { expectedStateRevision: 2, title: "재작성된 값" };
    },
    { storage: reloadStorage },
  );
assert.equal(afterReloadIntent.commandId, beforeReloadIntent.commandId);
assert.deepEqual(afterReloadIntent.payload, beforeReloadIntent.payload);
assert.equal(reloadBuilderCalls, 1);
reloadedIntentModule.forgetLegacyWisMutationIntent(
  reloadIntentKey,
  reloadStorage,
);
assert.equal(storageValues.size, 0);

console.log(
  JSON.stringify({
    suite: "w10p-thinkcloud-intent",
    status: "PASS",
    scenarios,
    duplicateEffects: 0,
    responseDetailPermissionSeparated: true,
    responseDetailRetryAction: true,
    responseEmptyOnlyWhenReady: true,
    studentOwnDetectionField: "isOwn",
    reloadStableKeys: 2,
    persistedReloadReplays: 1,
    productionAccess: 0,
  }),
);
