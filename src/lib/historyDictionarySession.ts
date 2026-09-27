import { getIdTokenResult, type User } from "firebase/auth";
import type { HttpsCallableResult } from "firebase/functions";
import { auth, getHttpsCallable } from "./firebase";

const GENERATION = "w1r2-2026-08-09";
const PROTOCOL = 2;
interface SessionProof {
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
}
interface SessionSnapshot extends SessionProof {
  status: string;
  authTime: number;
}
const flights = new Map<string, Promise<SessionProof>>();
const sessionError = (message: string) =>
  Object.assign(new Error(message), { code: "functions/unauthenticated" });

const authEpoch = async (user: User) => {
  const token = await getIdTokenResult(user);
  const epoch = Math.floor(Date.parse(token.authTime) / 1000);
  if (auth.currentUser !== user || !Number.isFinite(epoch)) {
    throw sessionError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
  }
  return epoch;
};

// Use the server's existing session handshake. A closed or expired session is
// never reopened here; openApplicationSession enforces reauthentication.
export const ensureHistoryDictionarySession =
  async (): Promise<SessionProof> => {
    const user = auth.currentUser;
    if (!user) throw sessionError("다시 로그인한 뒤 사전을 열어 주세요.");
    const epoch = await authEpoch(user);
    const key = `${user.uid}:${epoch}`;
    const existing = flights.get(key);
    if (existing) return existing;
    const flight = (async () => {
      const open = await getHttpsCallable<
        Record<string, unknown>,
        SessionSnapshot
      >("openApplicationSession");
      const { data } = await open({
        authorityGeneration: GENERATION,
        protocolVersion: PROTOCOL,
      });
      if ((await authEpoch(user)) !== epoch) {
        throw sessionError(
          "로그인 상태가 변경되었습니다. 다시 로그인해 주세요.",
        );
      }
      if (
        data.status !== "active" ||
        data.authTime !== epoch ||
        data.authorityGeneration !== GENERATION ||
        !Number.isInteger(data.protocolVersion) ||
        data.protocolVersion < PROTOCOL ||
        !/^[a-f0-9]{64}$/.test(data.revision)
      ) {
        throw sessionError(
          "사전 이용 세션을 확인하지 못했습니다. 다시 로그인해 주세요.",
        );
      }
      return {
        authorityGeneration: data.authorityGeneration,
        protocolVersion: data.protocolVersion,
        revision: data.revision,
      };
    })();
    flights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (flights.get(key) === flight) flights.delete(key);
    }
  };

export const getHistoryDictionaryCallable = async <
  RequestData = Record<string, unknown>,
  ResponseData = unknown,
>(
  name: string,
) => {
  const callable = await getHttpsCallable<
    Record<string, unknown>,
    ResponseData
  >(name);
  return async (
    data?: RequestData,
  ): Promise<HttpsCallableResult<ResponseData>> => {
    const user = auth.currentUser;
    if (!user) throw sessionError("다시 로그인한 뒤 사전을 열어 주세요.");
    const epoch = await authEpoch(user);
    const proof = await ensureHistoryDictionarySession();
    if ((await authEpoch(user)) !== epoch) {
      throw sessionError("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
    }
    // Attach only to this dictionary invocation; do not replay mutations.
    return callable({
      ...((data || {}) as Record<string, unknown>),
      _session: proof,
    });
  };
};

export const getHistoryDictionaryErrorMessage = (error: unknown) => {
  const failure = error as { code?: string; details?: { reason?: string } };
  if (failure?.code === "history-dictionary/version-conflict") {
    return "다른 작업에서 자료가 변경되었습니다. 입력 내용을 보관한 뒤 화면을 새로고침해 주세요.";
  }
  if (
    failure?.code === "functions/unauthenticated" ||
    failure?.details?.reason?.startsWith("SESSION_")
  ) {
    return "로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 사전을 열어 주세요.";
  }
  if (
    failure?.code === "permission-denied" ||
    failure?.code === "functions/permission-denied"
  ) {
    return "현재 학기와 사전 이용 권한을 확인해 주세요.";
  }
  return "사전 작업을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
};
