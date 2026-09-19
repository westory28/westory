import { auth, getHttpsCallable } from "./firebase";

type PatchNoteCommand =
  | "createTeacherPatchNote"
  | "updateTeacherPatchNote"
  | "updateTeacherPatchNoteStatus"
  | "deleteTeacherPatchNote";
type CommandResult = {
  noteId: string;
  noteRevision: number;
  status: "open" | "done";
  deleted: boolean;
};
type CommandResponse = { status: string; result: CommandResult };
type Session = {
  status: string;
  authTime: number;
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
};

const generation = "w1r2-2026-08-09";
const pendingCommands = new Map<string, string>();
const commandFlights = new Map<string, Promise<CommandResult>>();
const assertOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error(
      "로그인 사용자가 바뀌었습니다. 메모 화면을 다시 열어 주세요.",
    );
};
const isAmbiguous = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );

// Production denies direct memo writes. Use its existing owner-scoped Gateway
// with the same general-session proof used by other routine teacher saves.
const withPatchNoteSession = async (
  name: string,
  input: Record<string, unknown>,
  ownerUid: string,
): Promise<CommandResponse> => {
  assertOwner(ownerUid);
  const user = auth.currentUser!;
  const token = await user.getIdTokenResult();
  assertOwner(ownerUid);
  const open = await getHttpsCallable<
    { authorityGeneration: string; protocolVersion: number },
    Session
  >("openApplicationSession");
  assertOwner(ownerUid);
  const { data: session } = await open({
    authorityGeneration: generation,
    protocolVersion: 2,
  });
  assertOwner(ownerUid);
  if (
    session.status !== "active" ||
    session.authTime !== Number(token.claims.auth_time) ||
    session.authorityGeneration !== generation ||
    !Number.isInteger(session.protocolVersion) ||
    session.protocolVersion < 2 ||
    !/^[a-f0-9]{64}$/.test(session.revision)
  )
    throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
  const call = await getHttpsCallable<Record<string, unknown>, CommandResponse>(
    name,
  );
  const currentToken = await user.getIdTokenResult();
  assertOwner(ownerUid);
  if (currentToken.claims.auth_time !== token.claims.auth_time)
    throw new Error("로그인 상태가 바뀌었습니다. 다시 저장해 주세요.");
  const response = await call({
    ...input,
    _session: {
      authorityGeneration: session.authorityGeneration,
      protocolVersion: session.protocolVersion,
      revision: session.revision,
    },
  });
  assertOwner(ownerUid);
  return response.data;
};

export const executeTeacherPatchNoteCommand = async (
  commandType: PatchNoteCommand,
  payload: Record<string, unknown>,
  ownerUid: string,
): Promise<CommandResult> => {
  assertOwner(ownerUid);
  const snapshot = JSON.parse(JSON.stringify(payload));
  const key = JSON.stringify([ownerUid, commandType, snapshot]);
  const existing = commandFlights.get(key);
  if (existing) return existing;
  const commandId = pendingCommands.get(key) || crypto.randomUUID();
  pendingCommands.set(key, commandId);
  const flight = (async () => {
    try {
      let response: CommandResponse;
      try {
        response = await withPatchNoteSession(
          "executeCommand",
          { commandId, commandType, payload: snapshot },
          ownerUid,
        );
      } catch (error) {
        if (!isAmbiguous(error)) throw error;
        // Lost acknowledgements must not create a second note on retry.
        const receipt = await withPatchNoteSession(
          "getCommandStatus",
          { commandId, commandType },
          ownerUid,
        ).catch(() => null);
        if (receipt?.status !== "SUCCEEDED") throw error;
        response = receipt;
      }
      if (response.status !== "SUCCEEDED")
        throw Object.assign(
          new Error("패치 메모의 저장 결과를 확인 중입니다."),
          {
            code: "functions/unavailable",
          },
        );
      assertOwner(ownerUid);
      pendingCommands.delete(key);
      return response.result;
    } finally {
      // Keep the intent ID until success, even if a retry hits an expired
      // session: that failure cannot disprove an earlier ambiguous commit.
      commandFlights.delete(key);
    }
  })();
  commandFlights.set(key, flight);
  return flight;
};

export const getTeacherPatchNoteErrorMessage = (error: unknown) => {
  const code = String((error as { code?: string })?.code || "");
  if (isAmbiguous(error))
    return "저장 결과를 확인하지 못했습니다. 작성 내용을 유지한 채 다시 시도해 주세요.";
  if (/unauthenticated/.test(code))
    return "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 저장해 주세요.";
  if (/permission-denied/.test(code))
    return "메모 저장 권한을 확인하지 못했습니다. 로그인 계정을 확인해 주세요.";
  const message = String((error as { message?: string })?.message || "");
  if (/[가-힣]/.test(message)) return message.replace(/^Firebase:\s*/, "");
  return "패치 메모를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};
