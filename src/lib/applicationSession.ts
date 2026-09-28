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
const flights = new Map<User, Promise<void>>();
const sessionError = () =>
  Object.assign(
    new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요."),
    { code: "functions/unauthenticated" },
  );

// Protected Firestore reads require the same server session as existing
// calendar/dictionary commands. The server alone decides expiry and renewal.
export const prepareApplicationSession = async (user: User): Promise<void> => {
  if (isSemesterArchive) return;
  if (auth.currentUser !== user) throw sessionError();
  const existing = flights.get(user);
  if (existing) return existing;

  const flight = (async () => {
    const token = await user.getIdTokenResult();
    const authTime = Number(token.claims.auth_time);
    if (auth.currentUser !== user || !Number.isFinite(authTime))
      throw sessionError();
    const open = await getHttpsCallable<
      { authorityGeneration: string; protocolVersion: number },
      ApplicationSession
    >("openApplicationSession");
    if (auth.currentUser !== user) throw sessionError();
    const { data } = await open({
      authorityGeneration: GENERATION,
      protocolVersion: PROTOCOL,
    });
    const currentToken = await user.getIdTokenResult();
    if (
      auth.currentUser !== user ||
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
  flights.set(user, flight);
  try {
    await flight;
  } finally {
    if (flights.get(user) === flight) flights.delete(user);
  }
};
