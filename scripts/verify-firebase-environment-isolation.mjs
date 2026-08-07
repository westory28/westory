import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/firebaseEnvironment.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const environmentModule = await import(moduleUrl);

const {
  assertFirebaseBuildBoundary,
  assertFirebaseEnvironmentBoundary,
  getLocalFirebaseConfig,
  resolveRuntimeEnvironment,
} = environmentModule;

const noEmulators = {
  auth: false,
  firestore: false,
  functions: false,
  storage: false,
};
const everyEmulator = {
  auth: true,
  firestore: true,
  functions: true,
  storage: true,
};
const stagingConfig = {
  apiKey: "staging-api-key",
  authDomain: "westory-staging.firebaseapp.com",
  projectId: "westory-staging",
  storageBucket: "westory-staging.firebasestorage.app",
  messagingSenderId: "111111111111",
  appId: "1:111111111111:web:westory-staging",
};
const productionConfig = {
  apiKey: "production-api-key-for-boundary-test",
  authDomain: "history-quiz-yongsin.firebaseapp.com",
  projectId: "history-quiz-yongsin",
  storageBucket: "history-quiz-yongsin.firebasestorage.app",
  messagingSenderId: "177587430482",
  appId: "1:177587430482:web:boundary-test",
};

const expectThrow = (label, fn, pattern) => {
  assert.throws(fn, pattern, label);
};

assert.equal(
  resolveRuntimeEnvironment({
    explicitEnvironment: undefined,
    hostname: "www.westory.kr",
    isDev: false,
  }),
  "production",
);
assert.equal(
  resolveRuntimeEnvironment({
    explicitEnvironment: "staging",
    hostname: "westory-staging.vercel.app",
    isDev: false,
  }),
  "staging",
);

assertFirebaseEnvironmentBoundary({
  config: productionConfig,
  environment: "production",
  hostname: "www.westory.kr",
  emulators: noEmulators,
});
assertFirebaseEnvironmentBoundary({
  config: getLocalFirebaseConfig(),
  environment: "local",
  hostname: "127.0.0.1",
  emulators: everyEmulator,
});
assertFirebaseEnvironmentBoundary({
  config: stagingConfig,
  environment: "staging",
  hostname: "westory-staging.vercel.app",
  emulators: noEmulators,
});

expectThrow(
  "Staging must reject the Production Firebase project",
  () =>
    assertFirebaseEnvironmentBoundary({
      config: productionConfig,
      environment: "staging",
      hostname: "westory-staging.vercel.app",
      emulators: noEmulators,
    }),
  /Production Firebase identifier/,
);
expectThrow(
  "Local must require every emulator",
  () =>
    assertFirebaseEnvironmentBoundary({
      config: getLocalFirebaseConfig(),
      environment: "local",
      hostname: "127.0.0.1",
      emulators: { ...everyEmulator, storage: false },
    }),
  /every Firebase emulator/,
);
expectThrow(
  "Unknown hosts must fail closed without an explicit environment",
  () =>
    assertFirebaseEnvironmentBoundary({
      config: stagingConfig,
      environment: "unconfigured",
      hostname: "branch-preview.vercel.app",
      emulators: noEmulators,
    }),
  /VITE_APP_ENV is required/,
);
expectThrow(
  "Vercel Preview must declare Staging",
  () =>
    assertFirebaseBuildBoundary({
      config: stagingConfig,
      explicitEnvironment: "production",
      githubActions: false,
      vercelEnvironment: "preview",
    }),
  /Vercel Preview requires/,
);
expectThrow(
  "GitHub Actions must not build against Production",
  () =>
    assertFirebaseBuildBoundary({
      config: productionConfig,
      explicitEnvironment: "production",
      githubActions: true,
    }),
  /GitHub Actions public builds/,
);
expectThrow(
  "The isolated Vercel Staging project must declare Staging",
  () =>
    assertFirebaseBuildBoundary({
      config: stagingConfig,
      explicitEnvironment: "production",
      githubActions: false,
      vercelEnvironment: "production",
      vercelProjectRole: "staging",
    }),
  /isolated Vercel Staging project requires/,
);
assertFirebaseBuildBoundary({
  config: stagingConfig,
  explicitEnvironment: "staging",
  githubActions: false,
  vercelEnvironment: "preview",
});
assertFirebaseBuildBoundary({
  config: stagingConfig,
  explicitEnvironment: "staging",
  githubActions: false,
  vercelEnvironment: "production",
  vercelProjectRole: "staging",
});

console.log("Firebase environment isolation matrix: PASS (12 cases)");
