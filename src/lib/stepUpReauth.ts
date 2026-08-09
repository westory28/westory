export interface StepUpRequestOptions {
  force?: boolean;
}

export type StepUpReauthErrorCode =
  | "UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "IN_PROGRESS"
  | "CANCELLED"
  | "IDENTITY_CHANGED"
  | "TOKEN_REFRESH_FAILED"
  | "SESSION_REFRESH_FAILED";

export class StepUpReauthError extends Error {
  readonly code: StepUpReauthErrorCode;
  readonly originalError?: unknown;

  constructor(
    code: StepUpReauthErrorCode,
    message: string,
    originalError?: unknown,
  ) {
    super(message);
    this.name = "StepUpReauthError";
    this.code = code;
    this.originalError = originalError;
  }
}

export type StepUpReauthMethod = "password" | "google";

export const getStepUpReauthFailureMessage = (
  error: unknown,
  method: StepUpReauthMethod,
) => {
  const code = String((error as { code?: unknown })?.code || "");
  if (
    method === "password" &&
    (code === "auth/wrong-password" || code === "auth/invalid-credential")
  ) {
    return "비밀번호가 올바르지 않습니다.";
  }
  if (
    method === "google" &&
    (code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request")
  ) {
    return "본인 확인이 취소되었습니다. 작업은 실행되지 않았습니다.";
  }
  if (code === "auth/network-request-failed") {
    return method === "google"
      ? "네트워크 문제로 Google 본인 확인을 마치지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."
      : "네트워크 문제로 본인 확인을 마치지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  if (error instanceof StepUpReauthError) {
    return `${error.message} 작업은 실행되지 않았습니다.`;
  }
  return method === "google"
    ? "Google 본인 확인을 마치지 못했습니다. 다시 시도해 주세요."
    : "본인 확인을 마치지 못했습니다. 다시 시도해 주세요.";
};

type StepUpHandler = (
  commandName: string,
  options?: StepUpRequestOptions,
) => Promise<void>;

let activeHandler: StepUpHandler | null = null;

export interface CrossTabLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true; mode: "exclusive" },
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T>;
}

const canonicalizeRequestData = (
  value: unknown,
  ancestors = new Set<object>(),
): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (value === Infinity) return "number:Infinity";
    if (value === -Infinity) return "number:-Infinity";
    if (Object.is(value, -0)) return "number:-0";
    return `number:${String(value)}`;
  }
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value !== "object") return `${typeof value}:${String(value)}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (ancestors.has(value)) {
    throw new TypeError("High-risk command data must not contain a cycle.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item) => canonicalizeRequestData(item, ancestors))
        .join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeRequestData(record[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

export const createHighRiskCommandFlightKey = (
  commandName: string,
  data: unknown,
  ownerScope = "",
) =>
  `${String(ownerScope || "").trim()}\u0000${String(commandName || "").trim()}\u0000${canonicalizeRequestData(data)}`;

export const createHighRiskCommandLockName = (flightKey: string) => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < flightKey.length; index += 1) {
    hash ^= BigInt(flightKey.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `westory:high-risk:${hash.toString(16).padStart(16, "0")}`;
};

const getBrowserLockManager = (): CrossTabLockManager | null => {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  return navigator.locks as CrossTabLockManager;
};

export const createHighRiskCommandSingleFlightCoordinator = (
  resolveLockManager: () => CrossTabLockManager | null = getBrowserLockManager,
) => {
  const localFlights = new Map<string, Promise<unknown>>();

  return <T>(
    commandName: string,
    data: unknown,
    execute: () => Promise<T>,
    ownerScope = "",
  ): Promise<T> => {
    const flightKey = createHighRiskCommandFlightKey(
      commandName,
      data,
      ownerScope,
    );
    const existing = localFlights.get(flightKey);
    if (existing) return existing as Promise<T>;

    const executeWithCrossTabLock = async () => {
      const lockManager = resolveLockManager();
      if (!lockManager) return execute();

      return lockManager.request(
        createHighRiskCommandLockName(flightKey),
        { ifAvailable: true, mode: "exclusive" },
        async (lock) => {
          if (!lock) {
            throw new StepUpReauthError(
              "IN_PROGRESS",
              "다른 탭에서 같은 작업을 처리하고 있습니다.",
            );
          }
          return execute();
        },
      );
    };

    let flight: Promise<T>;
    flight = Promise.resolve()
      .then(executeWithCrossTabLock)
      .finally(() => {
        if (localFlights.get(flightKey) === flight) {
          localFlights.delete(flightKey);
        }
      });
    localFlights.set(flightKey, flight);
    return flight;
  };
};

const runDefaultHighRiskCommandSingleFlight =
  createHighRiskCommandSingleFlightCoordinator();

/**
 * Coalesces identical requests only while this browser tab is awaiting them.
 * Web Locks reject a simultaneous same-origin tab when supported. Server-side
 * idempotency remains required across devices and after ambiguous responses.
 */
export const runHighRiskCommandSingleFlight = <T>(
  commandName: string,
  data: unknown,
  execute: () => Promise<T>,
  ownerScope = "",
): Promise<T> =>
  runDefaultHighRiskCommandSingleFlight(commandName, data, execute, ownerScope);

export const registerStepUpReauthHandler = (handler: StepUpHandler) => {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
};

export const requestStepUpReauthentication = async (
  commandName: string,
  options?: StepUpRequestOptions,
) => {
  if (!activeHandler) {
    throw new StepUpReauthError(
      "UNAVAILABLE",
      "재인증 기능을 사용할 수 없습니다.",
    );
  }
  await activeHandler(commandName, options);
};
