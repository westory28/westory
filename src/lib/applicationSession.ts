import { getIdToken, getIdTokenResult, type User } from "firebase/auth";
import { auth, getHttpsCallable } from "./firebase";

export type ApplicationSessionScope = "GENERAL" | "HIGH_RISK";
export type ApplicationSessionAuthorityMode =
  | "ENFORCE"
  | "OBSERVE_ONLY"
  | "DISABLED";

export const APPLICATION_SESSION_AUTHORITY_GENERATION = "w1r2-2026-08-09";
export const APPLICATION_SESSION_PROTOCOL_VERSION = 2;

export interface ApplicationSessionProof {
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
}

export interface ApplicationSessionSnapshot {
  authTime: number;
  generalExpiresAt: number;
  highRiskExpiresAt: number;
  status: "active" | "closed" | string;
  authorityMode: ApplicationSessionAuthorityMode;
  authorityGeneration?: string;
  protocolVersion?: number;
  revision?: string;
  resumed?: boolean;
  throttled?: boolean;
}

interface StoredApplicationSessionProof extends ApplicationSessionProof {
  uid: string;
  authTime: number;
}

export interface SynchronizeApplicationSessionOptions {
  expectedUid?: string;
  forceTokenRefresh?: boolean;
}

const openSessionFlights = new Map<
  string,
  Promise<ApplicationSessionSnapshot>
>();
let activeSessionProof: StoredApplicationSessionProof | null = null;
let activeSessionAuthorityMode: ApplicationSessionAuthorityMode | null = null;
const authorityModeListeners = new Set<
  (mode: ApplicationSessionAuthorityMode | null) => void
>();

const setActiveSessionAuthorityMode = (
  mode: ApplicationSessionAuthorityMode | null,
) => {
  if (activeSessionAuthorityMode === mode) return;
  activeSessionAuthorityMode = mode;
  authorityModeListeners.forEach((listener) => listener(mode));
};

const getTokenAuthTimeSeconds = (authTime: string) => {
  const authTimeMs = Date.parse(authTime);
  if (!Number.isFinite(authTimeMs)) {
    throw new Error("Firebase authentication time is invalid.");
  }
  return Math.floor(authTimeMs / 1000);
};

const sessionHandshake = () => ({
  authorityGeneration: APPLICATION_SESSION_AUTHORITY_GENERATION,
  protocolVersion: APPLICATION_SESSION_PROTOCOL_VERSION,
});

const validateAndStoreSessionProof = (
  uid: string,
  expectedAuthTime: number,
  session: ApplicationSessionSnapshot,
) => {
  if (
    session.status !== "active" ||
    session.authTime !== expectedAuthTime ||
    session.authorityGeneration !== APPLICATION_SESSION_AUTHORITY_GENERATION ||
    Number(session.protocolVersion) < APPLICATION_SESSION_PROTOCOL_VERSION ||
    typeof session.revision !== "string" ||
    session.revision.length < 64 ||
    !["ENFORCE", "OBSERVE_ONLY", "DISABLED"].includes(session.authorityMode)
  ) {
    throw new Error("Application session proof is invalid or outdated.");
  }
  activeSessionProof = {
    uid,
    authTime: expectedAuthTime,
    authorityGeneration: session.authorityGeneration,
    protocolVersion: Number(session.protocolVersion),
    revision: session.revision,
  };
  setActiveSessionAuthorityMode(session.authorityMode);
};

const assertCurrentAuthEpoch = async (
  user: User,
  expectedUid: string,
  expectedAuthTime: number,
) => {
  const token = await getIdTokenResult(user);
  if (
    auth.currentUser?.uid !== expectedUid ||
    getTokenAuthTimeSeconds(token.authTime) !== expectedAuthTime
  ) {
    throw new Error("Authenticated user changed during session refresh.");
  }
};

export const getApplicationSessionAuthorityMode = () =>
  activeSessionAuthorityMode;

export const subscribeApplicationSessionAuthorityMode = (
  listener: (mode: ApplicationSessionAuthorityMode | null) => void,
) => {
  authorityModeListeners.add(listener);
  listener(activeSessionAuthorityMode);
  return () => {
    authorityModeListeners.delete(listener);
  };
};

const invokeSessionCommand = async <TResponse>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<TResponse> => {
  const callable = await getHttpsCallable<Record<string, unknown>, TResponse>(
    name,
  );
  const response = await callable(data);
  return response.data;
};

export const openApplicationSession = () =>
  auth.currentUser
    ? synchronizeApplicationSession(auth.currentUser)
    : invokeSessionCommand<ApplicationSessionSnapshot>(
        "openApplicationSession",
        sessionHandshake(),
      );

export const beginApplicationSessionReauthentication = () =>
  invokeSessionCommand<{ expiresAt: number }>(
    "beginApplicationSessionReauthentication",
  );

export const synchronizeApplicationSession = async (
  user: User,
  options: SynchronizeApplicationSessionOptions = {},
) => {
  const expectedUid = options.expectedUid || user.uid;
  if (user.uid !== expectedUid || auth.currentUser?.uid !== expectedUid) {
    throw new Error("Authenticated user changed before session refresh.");
  }
  if (options.forceTokenRefresh) {
    await getIdToken(user, true);
  }

  const token = await getIdTokenResult(user);
  if (auth.currentUser?.uid !== expectedUid) {
    throw new Error("Authenticated user changed during session refresh.");
  }
  const authTime = getTokenAuthTimeSeconds(token.authTime);
  if (
    activeSessionProof &&
    (activeSessionProof.uid !== expectedUid ||
      activeSessionProof.authTime !== authTime)
  ) {
    if (activeSessionProof.uid !== expectedUid) {
      setActiveSessionAuthorityMode(null);
    }
    activeSessionProof = null;
  }

  const flightKey = `${expectedUid}:${authTime}`;
  const existing = openSessionFlights.get(flightKey);
  if (existing) return existing;

  let flight: Promise<ApplicationSessionSnapshot>;
  flight = invokeSessionCommand<ApplicationSessionSnapshot>(
    "openApplicationSession",
    sessionHandshake(),
  )
    .then(async (session) => {
      await assertCurrentAuthEpoch(user, expectedUid, authTime);
      validateAndStoreSessionProof(expectedUid, authTime, session);
      return session;
    })
    .finally(() => {
      if (openSessionFlights.get(flightKey) === flight) {
        openSessionFlights.delete(flightKey);
      }
    });
  openSessionFlights.set(flightKey, flight);
  return flight;
};

export const prepareCallableDataWithApplicationSession = <T>(
  commandName: string,
  data: T | undefined,
): T | Record<string, unknown> | undefined => {
  if (commandName === "openApplicationSession" || !activeSessionProof) {
    return data;
  }
  if (auth.currentUser?.uid !== activeSessionProof.uid) {
    activeSessionProof = null;
    return data;
  }
  if (data !== undefined && (data === null || typeof data !== "object")) {
    throw new TypeError(
      "Callable data must be an object when application session proof is required.",
    );
  }
  return {
    ...((data || {}) as Record<string, unknown>),
    _session: {
      authorityGeneration: activeSessionProof.authorityGeneration,
      protocolVersion: activeSessionProof.protocolVersion,
      revision: activeSessionProof.revision,
    },
  };
};

export const touchApplicationSession = async (
  scope: ApplicationSessionScope,
) => {
  const session = await invokeSessionCommand<ApplicationSessionSnapshot>(
    "touchApplicationSession",
    { scope },
  );
  const user = auth.currentUser;
  if (user) {
    await assertCurrentAuthEpoch(user, user.uid, session.authTime);
    validateAndStoreSessionProof(user.uid, session.authTime, session);
  }
  return session;
};

export const closeApplicationSession = async () => {
  try {
    return await invokeSessionCommand<{ closed: boolean; reason?: string }>(
      "closeApplicationSession",
    );
  } finally {
    activeSessionProof = null;
    setActiveSessionAuthorityMode(null);
  }
};
