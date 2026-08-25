type ActiveFirebaseEnvironment = "production" | "staging";

type ActiveFirebaseProjectRole = "production" | "staging";

type ActiveFirebaseConfig = Readonly<{
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}>;

type ActiveFirebaseEmulators = Readonly<{
  auth: boolean;
  firestore: boolean;
  functions: boolean;
  storage: boolean;
}>;

type ActiveFirebaseBinding = Readonly<{
  config: ActiveFirebaseConfig;
  appCheckSiteKey: string;
  functionsRegion: string;
  environment: ActiveFirebaseEnvironment;
  projectRole: ActiveFirebaseProjectRole;
  emulators: ActiveFirebaseEmulators;
}>;

type ActiveFirebaseBindingInput = {
  config: {
    apiKey: unknown;
    authDomain: unknown;
    projectId: unknown;
    storageBucket: unknown;
    messagingSenderId: unknown;
    appId: unknown;
  };
  appCheckSiteKey: unknown;
  functionsRegion: unknown;
  environment: unknown;
  projectRole: unknown;
  emulators: {
    auth: unknown;
    firestore: unknown;
    functions: unknown;
    storage: unknown;
  };
};

type ActiveFirebaseBindingParseOptions = Readonly<{
  productionAuthDomainOverride?: string;
}>;

declare const __W10P_ACTIVE_FIREBASE_CONFIG__: string;

const MARKER_PREFIX_CHARACTER_CODES = Object.freeze([
  119, 49, 48, 112, 45, 97, 99, 116, 105, 118, 101, 45, 102, 105, 114, 101, 98,
  97, 115, 101, 45, 99, 111, 110, 102, 105, 103, 45, 118, 49, 58,
]);

const CONFIG_KEYS = Object.freeze([
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
] as const);

const EMULATOR_KEYS = Object.freeze([
  "auth",
  "firestore",
  "functions",
  "storage",
] as const);

const BINDING_KEYS = Object.freeze([
  "config",
  "appCheckSiteKey",
  "functionsRegion",
  "environment",
  "projectRole",
  "emulators",
] as const);

const FIREBASE_IDENTITIES = Object.freeze({
  production: Object.freeze({
    authDomain: "history-quiz-yongsin.firebaseapp.com",
    projectId: "history-quiz-yongsin",
    storageBucket: "history-quiz-yongsin.firebasestorage.app",
    messagingSenderId: "177587430482",
    appId: "1:177587430482:web:d79cc145c11e335cc3ab8b",
  }),
  staging: Object.freeze({
    authDomain: "westory-staging-177587430482.firebaseapp.com",
    projectId: "westory-staging-177587430482",
    storageBucket: "westory-staging-177587430482.firebasestorage.app",
    messagingSenderId: "894916304910",
    appId: "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f",
  }),
});

const getActiveFirebaseBindingMarkerPrefix = () =>
  String.fromCharCode(...MARKER_PREFIX_CHARACTER_CODES);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertExactOwnKeys: (
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
) => asserts value is Record<string, unknown> = (
  value,
  expectedKeys,
  label,
) => {
  if (!isPlainRecord(value)) {
    throw new Error(`[Active Firebase] ${label} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        !expectedKeys.includes(key) ||
        !Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    throw new Error(
      `[Active Firebase] ${label} must have exactly these own keys: ${expectedKeys.join(", ")}.`,
    );
  }
};

const assertTrimmedString = (
  value: unknown,
  label: string,
  pattern?: RegExp,
): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`[Active Firebase] ${label} has an invalid value.`);
  }
  return value;
};

const assertEnvironment = (value: unknown): ActiveFirebaseEnvironment => {
  if (value !== "production" && value !== "staging") {
    throw new Error(
      "[Active Firebase] environment must be production or staging.",
    );
  }
  return value;
};

const assertProjectRole = (value: unknown): ActiveFirebaseProjectRole => {
  if (value !== "production" && value !== "staging") {
    throw new Error(
      "[Active Firebase] projectRole must be production or staging.",
    );
  }
  return value;
};

const encodeUtf8Base64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
};

const decodeUtf8Base64Url = (payload: string): string => {
  if (!payload || !/^[A-Za-z0-9_-]+$/u.test(payload)) {
    throw new Error(
      "[Active Firebase] marker payload must be unpadded base64url.",
    );
  }
  if (payload.length % 4 === 1) {
    throw new Error("[Active Firebase] marker payload length is invalid.");
  }
  const base64 = payload.replace(/-/gu, "+").replace(/_/gu, "/");
  const paddedBase64 = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  let binary: string;
  try {
    binary = atob(paddedBase64);
  } catch {
    throw new Error("[Active Firebase] marker payload is malformed.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("[Active Firebase] marker payload is not valid UTF-8.");
  }
};

const canonicalizeActiveFirebaseBinding = (
  input: unknown,
): ActiveFirebaseBinding => {
  assertExactOwnKeys(input, BINDING_KEYS, "binding");
  assertExactOwnKeys(input.config, CONFIG_KEYS, "config");
  assertExactOwnKeys(input.emulators, EMULATOR_KEYS, "emulators");

  const environment = assertEnvironment(input.environment);
  const projectRole = assertProjectRole(input.projectRole);
  if (environment !== projectRole) {
    throw new Error(
      "[Active Firebase] environment and projectRole must identify the same isolated project role.",
    );
  }

  const config: ActiveFirebaseConfig = Object.freeze({
    apiKey: assertTrimmedString(
      input.config.apiKey,
      "config.apiKey",
      /^AIza[0-9A-Za-z_-]{20,}$/u,
    ),
    authDomain: assertTrimmedString(
      input.config.authDomain,
      "config.authDomain",
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u,
    ),
    projectId: assertTrimmedString(
      input.config.projectId,
      "config.projectId",
      /^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/u,
    ),
    storageBucket: assertTrimmedString(
      input.config.storageBucket,
      "config.storageBucket",
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:appspot\.com|firebasestorage\.app)$/u,
    ),
    messagingSenderId: assertTrimmedString(
      input.config.messagingSenderId,
      "config.messagingSenderId",
      /^\d{6,20}$/u,
    ),
    appId: assertTrimmedString(
      input.config.appId,
      "config.appId",
      /^1:\d{6,20}:web:[0-9a-f]{16,64}$/u,
    ),
  });

  const expectedIdentity = FIREBASE_IDENTITIES[environment];
  for (const identityKey of [
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ] as const) {
    if (config[identityKey] !== expectedIdentity[identityKey]) {
      throw new Error(
        `[Active Firebase] ${environment} config.${identityKey} does not match the approved Firebase app identity.`,
      );
    }
  }

  const appCheckSiteKey = assertTrimmedString(
    input.appCheckSiteKey,
    "appCheckSiteKey",
    /^[0-9A-Za-z_-]{20,}$/u,
  );
  const functionsRegion = assertTrimmedString(
    input.functionsRegion,
    "functionsRegion",
    /^[a-z]+(?:-[a-z0-9]+)+\d$/u,
  );
  if (functionsRegion !== "asia-northeast3") {
    throw new Error(
      "[Active Firebase] functionsRegion must match the approved Westory Functions region.",
    );
  }

  const emulators: ActiveFirebaseEmulators = Object.freeze({
    auth: input.emulators.auth as boolean,
    firestore: input.emulators.firestore as boolean,
    functions: input.emulators.functions as boolean,
    storage: input.emulators.storage as boolean,
  });
  for (const emulator of EMULATOR_KEYS) {
    if (typeof emulators[emulator] !== "boolean") {
      throw new Error(
        `[Active Firebase] emulators.${emulator} must be a boolean.`,
      );
    }
    if (emulators[emulator]) {
      throw new Error(
        `[Active Firebase] managed ${environment} cannot enable the ${emulator} emulator.`,
      );
    }
  }

  return Object.freeze({
    config,
    appCheckSiteKey,
    functionsRegion,
    environment,
    projectRole,
    emulators,
  });
};

const activeFirebaseBindingJson = (binding: ActiveFirebaseBinding) =>
  JSON.stringify({
    config: {
      apiKey: binding.config.apiKey,
      authDomain: binding.config.authDomain,
      projectId: binding.config.projectId,
      storageBucket: binding.config.storageBucket,
      messagingSenderId: binding.config.messagingSenderId,
      appId: binding.config.appId,
    },
    appCheckSiteKey: binding.appCheckSiteKey,
    functionsRegion: binding.functionsRegion,
    environment: binding.environment,
    projectRole: binding.projectRole,
    emulators: {
      auth: binding.emulators.auth,
      firestore: binding.emulators.firestore,
      functions: binding.emulators.functions,
      storage: binding.emulators.storage,
    },
  });

const createActiveFirebaseBindingMarker = (
  input: ActiveFirebaseBindingInput,
): string => {
  const binding = canonicalizeActiveFirebaseBinding(input);
  return `${getActiveFirebaseBindingMarkerPrefix()}${encodeUtf8Base64Url(
    activeFirebaseBindingJson(binding),
  )}`;
};

const parseActiveFirebaseBindingMarker = (
  marker: unknown,
  options: ActiveFirebaseBindingParseOptions = {},
): ActiveFirebaseBinding => {
  if (
    typeof marker !== "string" ||
    !marker ||
    /[^\u0020-\u007e]/u.test(marker)
  ) {
    throw new Error(
      "[Active Firebase] injected marker must be nonempty ASCII text.",
    );
  }
  const prefix = getActiveFirebaseBindingMarkerPrefix();
  if (
    !marker.startsWith(prefix) ||
    marker.indexOf(prefix, prefix.length) >= 0
  ) {
    throw new Error("[Active Firebase] injected marker prefix is invalid.");
  }
  const payload = marker.slice(prefix.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8Base64Url(payload));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("[Active Firebase] marker payload is not valid JSON.");
    }
    throw error;
  }
  const canonicalBinding = canonicalizeActiveFirebaseBinding(parsed);
  const canonicalPayload = encodeUtf8Base64Url(
    activeFirebaseBindingJson(canonicalBinding),
  );
  if (payload !== canonicalPayload) {
    throw new Error(
      "[Active Firebase] marker payload is not in canonical key order or encoding.",
    );
  }

  const productionAuthDomainOverride = options.productionAuthDomainOverride;
  if (productionAuthDomainOverride === undefined) return canonicalBinding;
  if (
    canonicalBinding.environment !== "production" ||
    !/^(?:www\.)?westory\.kr$/u.test(productionAuthDomainOverride)
  ) {
    throw new Error(
      "[Active Firebase] Production authDomain override is allowed only for the Westory HTTPS custom host.",
    );
  }
  return Object.freeze({
    ...canonicalBinding,
    config: Object.freeze({
      ...canonicalBinding.config,
      authDomain: productionAuthDomainOverride,
    }),
  });
};

const readInjectedActiveFirebaseBindingMarker = () =>
  __W10P_ACTIVE_FIREBASE_CONFIG__;

export {
  createActiveFirebaseBindingMarker,
  getActiveFirebaseBindingMarkerPrefix,
  parseActiveFirebaseBindingMarker,
  readInjectedActiveFirebaseBindingMarker,
};
export type {
  ActiveFirebaseBinding,
  ActiveFirebaseBindingInput,
  ActiveFirebaseConfig,
  ActiveFirebaseEmulators,
  ActiveFirebaseEnvironment,
  ActiveFirebaseProjectRole,
};
