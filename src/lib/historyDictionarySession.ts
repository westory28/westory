import type { HttpsCallableResult } from "firebase/functions";
import {
  callWithApplicationSession,
  ensureApplicationSessionProof,
} from "./applicationSession";

export const ensureHistoryDictionarySession = ensureApplicationSessionProof;

export const getHistoryDictionaryCallable = async <
  RequestData = Record<string, unknown>,
  ResponseData = unknown,
>(
  name: string,
  _options: { reuseSessionProof?: boolean } = {},
) => {
  return async (
    data?: RequestData,
  ): Promise<HttpsCallableResult<ResponseData>> =>
    callWithApplicationSession<Record<string, unknown>, ResponseData>(
      name,
      (data || {}) as Record<string, unknown>,
    );
};

export const getHistoryDictionaryErrorMessage = (error: unknown) => {
  const failure = error as { code?: string; details?: { reason?: string } };
  if (failure?.details?.reason === "APP_CHECK_REQUIRED") {
    return "요청을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  }
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
