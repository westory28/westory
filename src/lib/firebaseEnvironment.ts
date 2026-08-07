type WestoryRuntimeEnvironment =
  | "production"
  | "staging"
  | "recovery"
  | "local"
  | "test"
  | "unconfigured";

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

type RuntimeEnvironmentInput = {
  explicitEnvironment?: string;
  hostname?: string;
  isDev: boolean;
};

type FirebaseBoundaryInput = {
  config: FirebaseClientConfig;
  environment: WestoryRuntimeEnvironment;
  hostname?: string;
  emulators: FirebaseEmulatorTargets;
};

type FirebaseEmulatorTargets = {
  auth: boolean;
  firestore: boolean;
  functions: boolean;
  storage: boolean;
};

type FirebaseBuildBoundaryInput = {
  config: FirebaseClientConfig;
  explicitEnvironment?: string;
  githubActions: boolean;
  vercelEnvironment?: string;
  vercelProjectRole?: string;
};

const PRODUCTION_FIREBASE_IDENTIFIERS = {
  authDomain: "history-quiz-yongsin.firebaseapp.com",
  projectId: "history-quiz-yongsin",
  storageBucket: "history-quiz-yongsin.firebasestorage.app",
} as const;

const LOCAL_FIREBASE: FirebaseClientConfig = {
  apiKey: "demo-westory-api-key",
  authDomain: "127.0.0.1",
  projectId: "demo-westory",
  storageBucket: "demo-westory.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo-westory",
};

const VALID_ENVIRONMENTS = new Set<WestoryRuntimeEnvironment>([
  "production",
  "staging",
  "recovery",
  "local",
  "test",
]);

const isLocalQaHost = (host: string) =>
  /^(localhost|127\.0\.0\.1)$/i.test(host);

const isKnownProductionHost = (host: string) =>
  /^(?:www\.)?westory\.kr$/i.test(host) ||
  /^(?:westory-ecru|westory-bbbs-projects-44f9da30|westory-git-main-bbbs-projects-44f9da30)\.vercel\.app$/i.test(
    host,
  ) ||
  /^westory28\.github\.io$/i.test(host);

const resolveRuntimeEnvironment = ({
  explicitEnvironment,
  hostname = "",
  isDev,
}: RuntimeEnvironmentInput): WestoryRuntimeEnvironment => {
  const normalized = explicitEnvironment?.trim().toLowerCase();
  if (normalized) {
    if (!VALID_ENVIRONMENTS.has(normalized as WestoryRuntimeEnvironment)) {
      throw new Error(
        `[Environment] Unsupported VITE_APP_ENV value: ${normalized}`,
      );
    }
    return normalized as WestoryRuntimeEnvironment;
  }

  if (isDev && isLocalQaHost(hostname)) return "local";
  if (isKnownProductionHost(hostname)) return "production";
  return "unconfigured";
};

const isProductionFingerprint = (
  field: keyof typeof PRODUCTION_FIREBASE_IDENTIFIERS,
  value?: string,
) => Boolean(value && value === PRODUCTION_FIREBASE_IDENTIFIERS[field]);

const hasProductionFirebaseFingerprint = (config: FirebaseClientConfig) =>
  isProductionFingerprint("authDomain", config.authDomain) ||
  isProductionFingerprint("projectId", config.projectId) ||
  isProductionFingerprint("storageBucket", config.storageBucket);

const assertRequiredFirebaseConfig = (config: FirebaseClientConfig) => {
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "measurementId" && !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `[Environment] Missing Firebase configuration: ${missing.join(", ")}`,
    );
  }
};

const assertFirebaseEnvironmentBoundary = ({
  config,
  environment,
  hostname = "",
  emulators,
}: FirebaseBoundaryInput) => {
  assertRequiredFirebaseConfig(config);

  const enabledEmulators = Object.values(emulators).filter(Boolean).length;
  const anyEmulatorEnabled = enabledEmulators > 0;
  const everyEmulatorEnabled =
    enabledEmulators === Object.keys(emulators).length;

  if (environment === "unconfigured") {
    throw new Error(
      "[Environment] VITE_APP_ENV is required on non-production deployments.",
    );
  }

  if (environment === "production") {
    if (config.projectId !== PRODUCTION_FIREBASE_IDENTIFIERS.projectId) {
      throw new Error(
        "[Environment] Production must use the approved Production Firebase project.",
      );
    }
    if (anyEmulatorEnabled) {
      throw new Error(
        "[Environment] Firebase emulators cannot be enabled in Production.",
      );
    }
    return;
  }

  if (hasProductionFirebaseFingerprint(config)) {
    throw new Error(
      `[Environment] ${environment} cannot use any Production Firebase identifier.`,
    );
  }

  if (environment === "local" || environment === "test") {
    if (!everyEmulatorEnabled || !config.projectId.startsWith("demo-")) {
      throw new Error(
        `[Environment] ${environment} must use every Firebase emulator with a demo-* project.`,
      );
    }
    return;
  }

  if (anyEmulatorEnabled) {
    throw new Error(
      `[Environment] ${environment} must use its isolated cloud project, not local emulators.`,
    );
  }

  if (hostname && isKnownProductionHost(hostname)) {
    throw new Error(
      `[Environment] ${environment} Firebase cannot run on a Production hostname.`,
    );
  }
};

const assertFirebaseBuildBoundary = ({
  config,
  explicitEnvironment,
  githubActions,
  vercelEnvironment,
  vercelProjectRole,
}: FirebaseBuildBoundaryInput) => {
  const normalizedEnvironment = explicitEnvironment?.trim().toLowerCase();
  const normalizedVercelEnvironment = vercelEnvironment?.trim().toLowerCase();
  const normalizedVercelProjectRole = vercelProjectRole?.trim().toLowerCase();
  const isManagedBuild = githubActions || Boolean(normalizedVercelEnvironment);

  if (!isManagedBuild) return;

  if (!normalizedEnvironment) {
    throw new Error(
      "[Environment] Managed builds require an explicit VITE_APP_ENV.",
    );
  }
  if (
    !VALID_ENVIRONMENTS.has(normalizedEnvironment as WestoryRuntimeEnvironment)
  ) {
    throw new Error(
      `[Environment] Unsupported VITE_APP_ENV value: ${normalizedEnvironment}`,
    );
  }

  if (githubActions && normalizedEnvironment !== "staging") {
    throw new Error(
      "[Environment] GitHub Actions public builds are allowed only for isolated Staging.",
    );
  }
  if (
    normalizedVercelProjectRole &&
    !["production", "staging"].includes(normalizedVercelProjectRole)
  ) {
    throw new Error(
      `[Environment] Unsupported VITE_VERCEL_PROJECT_ROLE value: ${normalizedVercelProjectRole}`,
    );
  }
  if (
    normalizedVercelEnvironment === "production" &&
    normalizedVercelProjectRole === "staging" &&
    normalizedEnvironment !== "staging"
  ) {
    throw new Error(
      "[Environment] The isolated Vercel Staging project requires VITE_APP_ENV=staging.",
    );
  }
  if (
    normalizedVercelEnvironment === "production" &&
    normalizedVercelProjectRole !== "staging" &&
    normalizedEnvironment !== "production"
  ) {
    throw new Error(
      "[Environment] Vercel Production requires VITE_APP_ENV=production.",
    );
  }
  if (
    normalizedVercelEnvironment === "preview" &&
    normalizedEnvironment !== "staging"
  ) {
    throw new Error(
      "[Environment] Vercel Preview requires VITE_APP_ENV=staging.",
    );
  }
  if (
    normalizedEnvironment !== "production" &&
    hasProductionFirebaseFingerprint(config)
  ) {
    throw new Error(
      `[Environment] ${normalizedEnvironment} build contains a Production Firebase identifier.`,
    );
  }
  assertRequiredFirebaseConfig(config);
};

const getLocalFirebaseConfig = (): FirebaseClientConfig => ({
  ...LOCAL_FIREBASE,
});

export {
  assertFirebaseBuildBoundary,
  assertFirebaseEnvironmentBoundary,
  getLocalFirebaseConfig,
  hasProductionFirebaseFingerprint,
  isKnownProductionHost,
  isLocalQaHost,
  resolveRuntimeEnvironment,
};
export type {
  FirebaseClientConfig,
  FirebaseEmulatorTargets,
  WestoryRuntimeEnvironment,
};
