import type { User } from "firebase/auth";
import { auth, getHttpsCallable } from "./firebase";
import { isSemesterArchive } from "./semesterArchive";

const GENERATION = "w1r2-2026-08-09";
const PROTOCOL = 2;
interface ApplicationSession {
  status: string;
  authTime: number;
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
}
const flights = new Map<
  User,
  { promise: Promise<void>; isCurrent?: () => boolean }
>();
const sessionError = () =>
  Object.assign(
    new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요."),
    { code: "functions/unauthenticated" },
  );

// Protected Firestore reads require the same server session as existing
// calendar/dictionary commands. The server alone decides expiry and renewal.
export const prepareApplicationSession = async (
  user: User,
  options: { fresh?: boolean; isCurrent?: () => boolean } = {},
): Promise<void> => {
  if (isSemesterArchive) return;
  const current = () =>
    auth.currentUser === user && options.isCurrent?.() !== false;
  if (!current()) throw sessionError();
  const existing = flights.get(user);
  if (existing) {
    if (!options.fresh && existing.isCurrent?.() !== false)
      return existing.promise;
    // A timed-out callable cannot be aborted by the SDK. Drain it before a
    // manual retry, then ask the server again; its result is never reused.
    await existing.promise.catch(() => undefined);
    if (!current()) throw sessionError();
    return prepareApplicationSession(user, options);
  }

  const flight = (async () => {
    const token = await user.getIdTokenResult();
    const authTime = Number(token.claims.auth_time);
    if (!current() || !Number.isFinite(authTime)) throw sessionError();
    const open = await getHttpsCallable<
      { authorityGeneration: string; protocolVersion: number },
      ApplicationSession
    >("openApplicationSession");
    if (!current()) throw sessionError();
    const { data } = await open({
      authorityGeneration: GENERATION,
      protocolVersion: PROTOCOL,
    });
    const currentToken = await user.getIdTokenResult();
    if (
      !current() ||
      Number(currentToken.claims.auth_time) !== authTime ||
      data.status !== "active" ||
      data.authTime !== authTime ||
      data.authorityGeneration !== GENERATION ||
      !Number.isInteger(data.protocolVersion) ||
      data.protocolVersion < PROTOCOL ||
      !/^[a-f0-9]{64}$/.test(data.revision)
    )
      throw sessionError();
  })();
  const entry = { promise: flight, isCurrent: options.isCurrent };
  flights.set(user, entry);
  try {
    await flight;
  } finally {
    if (flights.get(user) === entry) flights.delete(user);
  }
};
