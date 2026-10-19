import type { User } from "firebase/auth";
import type { HttpsCallableResult } from "firebase/functions";
import { auth, getHttpsCallable } from "./firebase";
import { isSemesterArchive } from "./semesterArchive";

const GENERATION = "w1r2-2026-08-09";
const PROTOCOL = 2;
export interface ApplicationSessionProof {
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
}
interface ApplicationSession extends ApplicationSessionProof {
  status: string;
  authTime: number;
}
type SessionOptions = { fresh?: boolean; isCurrent?: () => boolean };
type VerifiedSession = { authTime: number; proof: ApplicationSessionProof };
let proofs = new WeakMap<User, VerifiedSession>();
let versions = new WeakMap<User, object>();
let epochs = new WeakMap<User, number>();
let lifetimes = new WeakMap<User, object>();
const flights = new Map<
  User,
  {
    promise: Promise<VerifiedSession>;
    version: object;
    isCurrent?: () => boolean;
  }
>();
const sessionError = (
  message = "로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
) => Object.assign(new Error(message), { code: "functions/unauthenticated" });

const versionFor = (user: User) => {
  let version = versions.get(user);
  if (!version) {
    version = {};
    versions.set(user, version);
  }
  return version;
};
const lifetimeFor = (user: User) => {
  let lifetime = lifetimes.get(user);
  if (!lifetime) {
    lifetime = {};
    lifetimes.set(user, lifetime);
  }
  return lifetime;
};

// Memory only, scoped to the exact SDK identity and auth_time. A proof is a
// protocol fence, never a local authorization decision: every server command
// still verifies the live session status, expiry, revision and permissions.
export const invalidateApplicationSession = (user?: User | null) => {
  if (user) {
    proofs.delete(user);
    versions.delete(user);
    epochs.delete(user);
    lifetimes.delete(user);
  } else {
    proofs = new WeakMap();
    versions = new WeakMap();
    epochs = new WeakMap();
    lifetimes = new WeakMap();
  }
};

const isAuthenticationFailure = (error: unknown) => {
  const failure = error as { code?: string; details?: { reason?: string } };
  if (failure?.details?.reason === "APP_CHECK_REQUIRED") return false;
  return (
    [
      "functions/unauthenticated",
      "unauthenticated",
      "auth/user-token-expired",
      "auth/invalid-user-token",
      "auth/user-disabled",
    ].includes(String(failure?.code || "")) ||
    String(failure?.details?.reason || "").startsWith("SESSION_")
  );
};

const authTimeFor = async (user: User) => {
  const token = await user.getIdTokenResult();
  const authTime = Number(token.claims.auth_time);
  if (
    auth.currentUser !== user ||
    !Number.isSafeInteger(authTime) ||
    authTime <= 0
  )
    throw sessionError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
  return authTime;
};

const sessionContextFor = async (user: User) => {
  const lifetime = lifetimeFor(user);
  const authTime = await authTimeFor(user);
  if (lifetimes.get(user) !== lifetime) throw sessionError();
  let version = versionFor(user);
  const previousEpoch = epochs.get(user);
  if (previousEpoch !== undefined && previousEpoch > authTime)
    throw sessionError();
  if (previousEpoch !== undefined && previousEpoch !== authTime) {
    proofs.delete(user);
    version = {};
    versions.set(user, version);
  }
  epochs.set(user, authTime);
  return { version, authTime };
};

const invalidateFailedSession = async (
  user: User,
  authTime: number,
  error: unknown,
  current: () => boolean,
) => {
  if (!isAuthenticationFailure(error) || !current()) return;
  // A late response from the previous token epoch cannot invalidate a newly
  // authenticated user, even before its next session handshake has started.
  const currentAuthTime = await authTimeFor(user).catch(() => authTime);
  if (current() && currentAuthTime === authTime)
    invalidateApplicationSession(user);
};

const openVerifiedSession = async (
  user: User,
  options: SessionOptions,
): Promise<VerifiedSession> => {
  const { version, authTime } = await sessionContextFor(user);
  const current = () =>
    auth.currentUser === user &&
    versions.get(user) === version &&
    options.isCurrent?.() !== false;
  if (!current()) throw sessionError();
  const existing = flights.get(user);
  if (existing) {
    if (
      !options.fresh &&
      existing.version === version &&
      existing.isCurrent?.() !== false
    ) {
      const verified = await existing.promise;
      if ((await authTimeFor(user)) !== verified.authTime || !current())
        throw sessionError();
      return verified;
    }
    // A timed-out callable cannot be aborted by the SDK. Drain it before a
    // manual retry, then ask the server again; its result is never reused.
    await existing.promise.catch(() => undefined);
    if (!current()) throw sessionError();
    return openVerifiedSession(user, options);
  }

  const flight = (async () => {
    if (!current()) throw sessionError();
    const open = await getHttpsCallable<
      { authorityGeneration: string; protocolVersion: number },
      ApplicationSession
    >("openApplicationSession");
    if (!current()) throw sessionError();
    const { data } = await open({
      authorityGeneration: GENERATION,
      protocolVersion: PROTOCOL,
    });
    const currentAuthTime = await authTimeFor(user);
    if (
      !current() ||
      currentAuthTime !== authTime ||
      data.status !== "active" ||
      data.authTime !== authTime ||
      data.authorityGeneration !== GENERATION ||
      !Number.isInteger(data.protocolVersion) ||
      data.protocolVersion < PROTOCOL ||
      !/^[a-f0-9]{64}$/.test(data.revision)
    )
      throw sessionError();
    const verified = {
      authTime,
      proof: Object.freeze({
        authorityGeneration: data.authorityGeneration,
        protocolVersion: data.protocolVersion,
        revision: data.revision,
      }),
    };
    proofs.set(user, verified);
    return verified;
  })();
  const entry = { promise: flight, version, isCurrent: options.isCurrent };
  flights.set(user, entry);
  try {
    return await flight;
  } catch (error) {
    await invalidateFailedSession(user, authTime, error, current);
    throw error;
  } finally {
    if (flights.get(user) === entry) flights.delete(user);
  }
};

// Startup always asks the server again; a completed command proof must never
// stand in for the server confirmation required before protected profile reads.
export const prepareApplicationSession = async (
  user: User,
  options: SessionOptions = {},
): Promise<void> => {
  if (isSemesterArchive) return;
  await openVerifiedSession(user, options);
};

export const ensureApplicationSessionProof = async (
  user: User | null = auth.currentUser,
  options: SessionOptions = {},
): Promise<ApplicationSessionProof> => {
  if (!user) throw sessionError();
  const { version, authTime } = await sessionContextFor(user);
  if (options.isCurrent?.() === false || versions.get(user) !== version)
    throw sessionError();
  const cached = proofs.get(user);
  if (!options.fresh && !flights.has(user) && cached?.authTime === authTime)
    return cached.proof;
  const verified = await openVerifiedSession(user, options);
  if (
    (await authTimeFor(user)) !== authTime ||
    versions.get(user) !== version ||
    options.isCurrent?.() === false
  )
    throw sessionError();
  return verified.proof;
};

export const callWithApplicationSession = async <
  RequestData extends object,
  ResponseData,
>(
  name: string,
  input: RequestData,
  user: User | null = auth.currentUser,
): Promise<HttpsCallableResult<ResponseData>> => {
  if (!user) throw sessionError();
  const { version, authTime } = await sessionContextFor(user);
  const assertCurrent = async () => {
    if (
      (await authTimeFor(user)) !== authTime ||
      versions.get(user) !== version
    )
      throw sessionError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
  };
  try {
    const proof = await ensureApplicationSessionProof(user);
    const callable = await getHttpsCallable<
      RequestData & { _session: ApplicationSessionProof },
      ResponseData
    >(name);
    await assertCurrent();
    const response = await callable({ ...input, _session: proof });
    try {
      await assertCurrent();
    } catch (error) {
      // The caller must retain its receipt when a committed response becomes
      // stale; a later explicit retry must not duplicate that write.
      throw Object.assign(error as Error, {
        applicationSessionResponseReceived: true,
      });
    }
    return response;
  } catch (error) {
    await invalidateFailedSession(
      user,
      authTime,
      error,
      () => auth.currentUser === user && versions.get(user) === version,
    );
    // Never replay a mutation automatically, including after a lost response.
    throw error;
  }
};
