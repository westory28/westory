import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const helperSource = read("src/lib/callableRegion.ts");
const helperFile = ts.createSourceFile(
  "callableRegion.ts",
  helperSource,
  ts.ScriptTarget.Latest,
  true,
);
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const { resolveCallableRegion } = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(helperSource)).toString("base64")}`
);
const readNames = [
  "getWisEconomyState",
  "getArchiveEnrollmentState",
  "getW8DomainState",
  "getSemesterCoreState",
];
const projects = ["history-quiz-yongsin", "westory-staging-177587430482"];
const declaration = (file, name) => {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(found, `${name} must exist`);
  return found;
};
for (const [name, expected] of [
  ["DATABASE_LOCAL_READ_CALLABLES", readNames],
  ["DATABASE_LOCAL_READ_PROJECTS", projects],
]) {
  const initializer = declaration(helperFile, name).initializer;
  assert.ok(ts.isNewExpression(initializer));
  assert.deepEqual(
    initializer.arguments[0].elements.map((node) => node.text),
    expected,
    "Only the four approved read replicas and two existing projects may change region",
  );
}
for (const projectId of projects) {
  for (const callableName of readNames) {
    assert.equal(
      resolveCallableRegion({
        projectId,
        callableName,
        defaultRegion: "asia-northeast3",
        emulatorEnabled: false,
      }),
      "us-central1",
    );
    assert.equal(
      resolveCallableRegion({
        projectId,
        callableName,
        defaultRegion: "europe-west1",
        emulatorEnabled: true,
      }),
      "europe-west1",
    );
  }
  for (const callableName of [
    undefined,
    "",
    "executeCommand",
    "openApplicationSession",
    "touchApplicationSession",
    "beginApplicationSessionReauthentication",
    "getAssessmentState",
    "getGradeEvidenceState",
    "getAdminSemesterContent",
    "getTeacherOperationsState",
    "getStudentEnrollmentProfileState",
    "getWisEconomyState-other",
    "getWisEconomyState ",
  ]) {
    assert.equal(
      resolveCallableRegion({
        projectId,
        callableName,
        defaultRegion: "asia-northeast3",
        emulatorEnabled: false,
      }),
      "asia-northeast3",
    );
  }
}
for (const projectId of [
  "demo-westory",
  "",
  "history-quiz-yongsin-other",
  "westory-staging-other",
]) {
  for (const callableName of readNames)
    assert.equal(
      resolveCallableRegion({
        projectId,
        callableName,
        defaultRegion: "asia-northeast3",
        emulatorEnabled: false,
      }),
      "asia-northeast3",
    );
}

const source = read("src/lib/firebase.ts");
const sourceFile = ts.createSourceFile(
  "firebase.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const factory = declaration(sourceFile, "getFirebaseFunctions").initializer;
const factoryCode = transpile(
  `const create = ${factory.getText(sourceFile).replaceAll('import("firebase/functions")', "loadFunctionsSdk()").replaceAll("import.meta.env", "environment")};`,
);
const setup = ({
  emulator = false,
  projectId = projects[0],
  bindingRegion = "asia-northeast3",
  envRegion = "",
} = {}) => {
  const calls = [],
    connections = [],
    cache = new Map(),
    connected = new Set();
  const app = { name: "original-verified-app" };
  let failRegion = "";
  const dependencies = {
    app,
    firebaseConfig: { projectId },
    activeFirebaseBinding:
      bindingRegion === null ? null : { functionsRegion: bindingRegion },
    environment: { VITE_FIREBASE_FUNCTIONS_REGION: envRegion },
    emulatorTargets: { functions: emulator },
    functionsPromises: cache,
    functionsEmulatorConnectedRegions: connected,
    functionsEmulatorHost: "127.0.0.1",
    functionsEmulatorPort: 5001,
    resolveCallableRegion,
    loadFunctionsSdk: async () => ({
      getFunctions: (passedApp, region) => {
        assert.equal(
          passedApp,
          app,
          "Region selection cannot initialize another app/project",
        );
        calls.push(region);
        if (failRegion === region) {
          failRegion = "";
          throw new Error("SDK initialization failed");
        }
        return { region, app };
      },
      connectFunctionsEmulator: (instance, host, port) => {
        connections.push({ region: instance.region, host, port });
      },
    }),
  };
  const get = new Function(
    ...Object.keys(dependencies),
    `${factoryCode}; return create;`,
  )(...Object.values(dependencies));
  return {
    get,
    calls,
    connections,
    dependencies,
    cache,
    failNext: (region) => {
      failRegion = region;
    },
  };
};
const cloud = setup();
const pendingRead = cloud.get(readNames[0]);
const pendingWrite = cloud.get("executeCommand");
for (const name of readNames)
  assert.equal(
    cloud.get(name),
    pendingRead,
    "Same regional SDK initializes once under concurrent reads",
  );
assert.equal(
  cloud.get(),
  pendingWrite,
  "Name-free callers retain the original default region",
);
assert.equal(cloud.get("openApplicationSession"), pendingWrite);
const [readInstance, writeInstance] = await Promise.all([
  pendingRead,
  pendingWrite,
]);
assert.equal(readInstance.region, "us-central1");
assert.equal(writeInstance.region, "asia-northeast3");
assert.deepEqual(cloud.calls.sort(), ["asia-northeast3", "us-central1"]);
assert.equal(cloud.connections.length, 0);

const failed = setup();
const unchangedRegion = failed.get("executeCommand");
await unchangedRegion;
failed.failNext("us-central1");
await assert.rejects(failed.get(readNames[0]), /SDK initialization failed/);
assert.equal(
  failed.get("executeCommand"),
  unchangedRegion,
  "One region failure cannot discard another regional SDK",
);
assert.equal(
  (await failed.get(readNames[1])).region,
  "us-central1",
  "Failed initialization is retryable",
);
assert.equal(
  failed.calls.filter((region) => region === "us-central1").length,
  2,
);

const emulated = setup({ emulator: true });
await Promise.all(
  [...readNames, "executeCommand", undefined].map((name) => emulated.get(name)),
);
assert.deepEqual(emulated.calls, ["asia-northeast3"]);
assert.deepEqual(emulated.connections, [
  { region: "asia-northeast3", host: "127.0.0.1", port: 5001 },
]);
// Exercise the per-region emulator bookkeeping even though the real binding is frozen.
emulated.dependencies.activeFirebaseBinding.functionsRegion = "europe-west1";
await emulated.get();
await emulated.get(readNames[0]);
assert.equal(emulated.connections.length, 2);
assert.equal(emulated.connections[1].region, "europe-west1");
const fallback = setup({ bindingRegion: null, projectId: "demo-westory" });
assert.equal(
  (await fallback.get()).region,
  "asia-northeast3",
  "Empty env values preserve the previous fallback",
);
const custom = setup({
  bindingRegion: null,
  projectId: "demo-westory",
  envRegion: "europe-west1",
});
assert.equal((await custom.get(readNames[0])).region, "europe-west1");

const httpsFactory = declaration(sourceFile, "getHttpsCallable").initializer;
const regionCalls = [];
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(sourceFile) === "getFirebaseFunctions"
  )
    regionCalls.push(node);
  ts.forEachChild(node, visit);
};
visit(httpsFactory);
assert.equal(regionCalls.length, 1);
assert.deepEqual(
  regionCalls[0].arguments.map((argument) => argument.getText(sourceFile)),
  ["name"],
  "The original callable name selects its SDK without rewriting command names or payloads",
);
console.log(
  "Callable region: four reads/two projects, default write/session routing, original app, concurrent SDK reuse, isolated retry, emulator binding PASS",
);
