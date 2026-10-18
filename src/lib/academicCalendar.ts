import { auth, getHttpsCallable } from "./firebase";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import type { CalendarEvent } from "../types";
import type { ScheduleCategory } from "./scheduleCategories";

type Scope = { year: string | number; semester: string | number };
type EventInput = Pick<
  CalendarEvent,
  "title" | "start" | "eventType" | "targetType"
> &
  Partial<
    Pick<
      CalendarEvent,
      | "end"
      | "description"
      | "startPeriod"
      | "endPeriod"
      | "period"
      | "labelColor"
    >
  > & { allDay?: boolean; targetClass?: string | null };
type CalendarOperation = Scope &
  (
    | {
        action: "SAVE_EVENT";
        event: EventInput;
        eventId?: string;
        expectedRevision?: number;
      }
    | { action: "DELETE_EVENT"; eventId: string; expectedRevision: number }
    | {
        action: "SAVE_CATEGORIES";
        items: Array<
          | ScheduleCategory
          | (Omit<ScheduleCategory, "locked"> & { hidden?: boolean })
        >;
      }
    | {
        action: "SYNC_HOLIDAYS";
        holidays: Array<{
          title: string;
          start: string;
          source: "kasi" | "generated";
        }>;
      }
  );

const generation = "w1r2-2026-08-09";
const pendingRequestIds = new Map<string, string>();
const isRetryable = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );

// Calendar-only adapter for the deployed session protocol. Never reopen an
// expired session locally or fall back to direct Firestore writes.
export const mutateAcademicCalendar = async <
  Result = { eventId: string; revision: number },
>(
  operation: CalendarOperation,
): Promise<Result> => {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 다시 저장해 주세요.");
  const assertSameUser = () => {
    if (auth.currentUser !== user)
      throw new Error(
        "로그인 사용자가 바뀌었습니다. 화면을 새로고침해 주세요.",
      );
  };
  // Routine calendar edits use the active application session. Only permanent
  // deletion needs step-up authentication, through the shared user-click flow.
  if (operation.action === "DELETE_EVENT") {
    await ensureSensitiveOperation();
    assertSameUser();
  }
  const token = await user.getIdTokenResult();
  assertSameUser();
  const authTime = Number(token.claims.auth_time);
  if (!Number.isSafeInteger(authTime) || authTime <= 0)
    throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
  const assertSameSession = async () => {
    assertSameUser();
    const currentToken = await user.getIdTokenResult();
    assertSameUser();
    if (Number(currentToken.claims.auth_time) !== authTime)
      throw new Error(
        "로그인 상태가 바뀌었습니다. 입력을 확인한 뒤 다시 저장해 주세요.",
      );
  };
  const open = await getHttpsCallable<
    { authorityGeneration: string; protocolVersion: number },
    {
      authorityGeneration: string;
      protocolVersion: number;
      revision: string;
      authTime: number;
      status: string;
    }
  >("openApplicationSession");
  assertSameUser();
  const handshake = {
    authorityGeneration: generation,
    protocolVersion: 2,
  };
  const { data: session } = await open(handshake);
  await assertSameSession();
  if (
    session.status !== "active" ||
    session.authTime !== authTime ||
    session.authorityGeneration !== generation ||
    !Number.isInteger(session.protocolVersion) ||
    session.protocolVersion < 2 ||
    !/^[a-f0-9]{64}$/.test(session.revision)
  ) {
    throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
  }
  // Removing undefined also keeps optional legacy fields unchanged in a merge.
  const body = JSON.parse(
    JSON.stringify({
      ...operation,
      year: String(operation.year),
      semester: String(operation.semester),
    }),
  );
  const key = `${user.uid}:${JSON.stringify(body)}`;
  const requestId = pendingRequestIds.get(key) || crypto.randomUUID();
  pendingRequestIds.set(key, requestId);
  const payload = {
    ...body,
    requestId,
    _session: {
      authorityGeneration: session.authorityGeneration,
      protocolVersion: session.protocolVersion,
      revision: session.revision,
    },
  };
  const call = await getHttpsCallable<typeof payload, Result>(
    "manageAcademicCalendar",
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assertSameSession();
    let response;
    try {
      response = await call(payload);
    } catch (error) {
      if (!isRetryable(error)) {
        pendingRequestIds.delete(key);
        throw error;
      }
      if (attempt === 1) throw error;
      continue;
    }
    // A committed write may outlive its auth epoch. Keep its receipt ID until
    // the result can be accepted so an explicit retry cannot create a duplicate.
    await assertSameSession();
    pendingRequestIds.delete(key);
    return response.data;
  }
  throw new Error("저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
};

export const academicCalendarErrorMessage = (error: unknown) => {
  const code = String((error as { code?: string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  if (/popup-blocked/.test(code))
    return "인증 팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 저장해 주세요. 입력 내용은 유지됩니다.";
  if (/popup-closed-by-user|cancelled-popup-request/.test(code))
    return "인증이 완료되지 않았습니다. 다시 저장하여 인증을 마쳐 주세요. 입력 내용은 유지됩니다.";
  if (/reauthentication-cancelled/.test(code))
    return "재인증을 취소했습니다. 일정은 변경되지 않았습니다.";
  if (/user-mismatch/.test(code))
    return "현재 로그인한 관리자 계정으로 인증해 주세요. 입력 내용은 유지됩니다.";
  const reason = (error as { details?: { reason?: string } })?.details?.reason;
  if (reason === "RECENT_AUTH_REQUIRED")
    return "일정을 삭제하려면 현재 계정으로 다시 인증해 주세요.";
  if (/unauthenticated/.test(code))
    return "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 저장해 주세요.";
  if (/permission-denied/.test(code))
    return "학사 일정을 저장할 관리자 권한이 필요합니다.";
  if (/not-found/.test(code))
    return "일정을 찾을 수 없습니다. 화면을 새로고침해 주세요.";
  if (/aborted/.test(code))
    return "다른 화면에서 일정이 변경되었습니다. 새로고침 후 다시 편집해 주세요.";
  if (/[가-힣]/.test(message)) return message.replace(/^Firebase:\s*/, "");
  if (isRetryable(error))
    return "서버 응답을 확인하지 못했습니다. 입력을 유지한 채 다시 저장해 주세요.";
  return "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};
