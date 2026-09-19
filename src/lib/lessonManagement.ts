import { onAuthStateChanged } from "firebase/auth";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { app, auth, db, getHttpsCallable } from "./firebase";
import type { SystemConfig } from "../types";
import type { LessonData } from "./lessonData";
import type { LessonPdfProcessingMeta } from "./lessonPdfExtraction";

type Config = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type LessonTreeNode = {
  id: string;
  title: string;
  children?: LessonTreeNode[];
};
export type LessonCommandScope = {
  semesterId: string;
  expectedSemesterRevision: number;
};
type CommandContext = {
  expectedUid?: string;
  commandScope?: LessonCommandScope;
};
type LessonCommand =
  | "saveLessonDocument"
  | "saveLessonTree"
  | "prepareLessonAssetUpload";
type CommandResponse<T> = { status: string; result: T };
type SessionProof = {
  authorityGeneration: string;
  protocolVersion: number;
  revision: string;
};
type Session = SessionProof & { status: string; authTime: number };
type SavedLesson = {
  unitId: string;
  contentRevision: number;
  treeRevision: number | null;
  pdfProcessing: LessonPdfProcessingMeta | null;
};
type UploadedAsset = {
  uploadId: string;
  storagePath: string;
  url: string;
  pdfProcessing?: LessonPdfProcessingMeta;
};
const generation = "w1r2-2026-08-09";
const pendingCommands = new Map<string, string>();
const commandFlights = new Map<string, Promise<unknown>>();
const assetFlights = new Map<string, Promise<UploadedAsset>>();
const preparedAssets = new Map<
  string,
  { asset: UploadedAsset; expiresAtMs: number }
>();
let uploadAppCheck: Promise<void> | null = null;

const ensureUploadAppCheck = () => {
  if (
    import.meta.env.DEV &&
    (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" ||
      import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST)
  )
    return Promise.resolve();
  if (!uploadAppCheck) {
    uploadAppCheck = (async () => {
      const siteKey = String(
        import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || "",
      ).trim();
      if (!siteKey) throw new Error("파일 업로드 인증 설정을 확인해야 합니다.");
      const { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } =
        await import("firebase/app-check");
      const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      await getToken(appCheck);
    })().catch((error) => {
      uploadAppCheck = null;
      throw error;
    });
  }
  return uploadAppCheck;
};

const assertOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error("로그인 사용자가 바뀌었습니다. 다시 로그인해 주세요.");
};
const isAmbiguous = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );

// The deployed backend owns all lesson writes. Keep its session proof and
// revision checks; direct Firestore/Storage writes are deliberately denied.
const withLessonSession = async <T>(
  name: string,
  input: Record<string, unknown>,
  ownerUid: string,
): Promise<T> => {
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
  const call = await getHttpsCallable<Record<string, unknown>, T>(name);
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

const executeLessonCommand = async <T>(
  commandType: LessonCommand,
  payload: Record<string, unknown>,
  ownerUid: string,
): Promise<T> => {
  assertOwner(ownerUid);
  const snapshot = JSON.parse(JSON.stringify(payload));
  const key = JSON.stringify([ownerUid, commandType, snapshot]);
  const existing = commandFlights.get(key);
  if (existing) return existing as Promise<T>;
  const commandId = pendingCommands.get(key) || crypto.randomUUID();
  pendingCommands.set(key, commandId);
  const flight = (async () => {
    try {
      let response: CommandResponse<T>;
      try {
        response = await withLessonSession<CommandResponse<T>>(
          "executeCommand",
          { commandId, commandType, payload: snapshot },
          ownerUid,
        );
      } catch (error) {
        if (!isAmbiguous(error)) throw error;
        // A missing acknowledgement is not a failed commit. Recover its receipt
        // or reuse the same command ID on the next explicit save attempt.
        const status = await withLessonSession<CommandResponse<T>>(
          "getCommandStatus",
          { commandId, commandType },
          ownerUid,
        ).catch(() => null);
        if (status?.status !== "SUCCEEDED") throw error;
        response = status;
      }
      if (response.status !== "SUCCEEDED") {
        const error = new Error(
          "저장 결과를 아직 확인하지 못했습니다. 편집 내용을 유지한 채 다시 저장해 주세요.",
        );
        throw Object.assign(error, { code: "functions/unavailable" });
      }
      assertOwner(ownerUid);
      pendingCommands.delete(key);
      return response.result;
    } catch (error) {
      if (!isAmbiguous(error)) pendingCommands.delete(key);
      throw error;
    } finally {
      commandFlights.delete(key);
    }
  })();
  commandFlights.set(key, flight);
  return flight;
};

export const getLessonCommandScope = async (
  config: Config,
): Promise<LessonCommandScope> => {
  const year = String(config?.year || "");
  const semester = String(config?.semester || "");
  if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester))
    throw new Error("수업자료의 학기를 확인할 수 없습니다.");
  const semesterId = `${year}-${semester}`;
  const pointer = await getDocFromServer(
    doc(db, "site_settings/semester_active"),
  );
  const data = pointer.data();
  if (
    !data ||
    data.semesterId !== semesterId ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  )
    throw new Error("현재 학기가 변경되었습니다. 화면을 다시 열어 주세요.");
  return { semesterId, expectedSemesterRevision: data.revision };
};

export const saveLessonDocument = async (
  config: Config,
  input: {
    unitId: string;
    expectedRevision: number;
    document: Partial<Omit<LessonData, "unitId" | "updatedAt">>;
    assetUploadIds: string[];
    tree?: LessonTreeNode[];
    expectedTreeRevision?: number;
  },
  context: CommandContext = {},
): Promise<SavedLesson> => {
  const ownerUid = context.expectedUid || auth.currentUser?.uid || "";
  assertOwner(ownerUid);
  const scope = context.commandScope || (await getLessonCommandScope(config));
  return executeLessonCommand(
    "saveLessonDocument",
    { ...input, ...scope },
    ownerUid,
  );
};

export const saveLessonTree = async (
  config: Config,
  input: { expectedRevision: number; tree: LessonTreeNode[] },
  context: CommandContext = {},
): Promise<{ contentRevision: number }> => {
  const ownerUid = context.expectedUid || auth.currentUser?.uid || "";
  assertOwner(ownerUid);
  const scope = context.commandScope || (await getLessonCommandScope(config));
  return executeLessonCommand(
    "saveLessonTree",
    { ...input, ...scope },
    ownerUid,
  );
};

const waitForAsset = (uploadId: string, ownerUid: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let stopTicket = () => {};
    let stopAuth = () => {};
    let settled = false;
    const finish = (error?: unknown, result?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopTicket();
      stopAuth();
      if (result) resolve(result);
      else reject(error);
    };
    const timeout = setTimeout(
      () =>
        finish(new Error("파일 검증이 지연되고 있습니다. 다시 저장해 주세요.")),
      90000,
    );
    stopTicket = onSnapshot(
      doc(db, "lesson_asset_uploads", uploadId),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (auth.currentUser?.uid !== ownerUid) {
          finish(new Error("로그인 사용자가 바뀌었습니다."));
          return;
        }
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
          return;
        const data = snapshot.data();
        if (data?.status === "VERIFIED") finish(undefined, data);
        else if (
          !snapshot.exists() ||
          ["FAILED", "ATTACHED"].includes(data?.status)
        )
          finish(new Error("업로드 요청을 다시 시작해 주세요."));
      },
      (error) => finish(error),
    );
    stopAuth = onAuthStateChanged(auth, (user) => {
      if (user?.uid !== ownerUid)
        finish(new Error("로그인 사용자가 바뀌었습니다."));
    });
    if (settled) {
      stopTicket();
      stopAuth();
    }
  });

export const uploadLessonAsset = async (
  config: Config,
  input: {
    unitId: string;
    expectedRevision: number;
    kind: "PDF" | "PAGE" | "FOOTNOTE";
    file: Blob;
    originalName?: string;
  } & CommandContext,
): Promise<UploadedAsset> => {
  const ownerUid = input.expectedUid || auth.currentUser?.uid || "";
  assertOwner(ownerUid);
  await ensureUploadAppCheck();
  assertOwner(ownerUid);
  const scope = input.commandScope || (await getLessonCommandScope(config));
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const payload = {
    ...scope,
    unitId: input.unitId,
    expectedRevision: input.expectedRevision,
    kind: input.kind,
    contentType:
      input.file.type ||
      (input.kind === "PDF" ? "application/pdf" : "image/png"),
    byteSize: input.file.size,
    sha256,
    originalName: input.originalName || "",
  };
  const key = JSON.stringify([ownerUid, payload]);
  assertOwner(ownerUid);
  for (const [cacheKey, item] of preparedAssets)
    if (item.expiresAtMs <= Date.now()) preparedAssets.delete(cacheKey);
  const cached = preparedAssets.get(key);
  if (cached) return cached.asset;
  const existing = assetFlights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    const ticket = await executeLessonCommand<{
      uploadId: string;
      storagePath: string;
      expiresAtMs: number;
    }>("prepareLessonAssetUpload", payload, ownerUid);
    const ticketRef = doc(db, "lesson_asset_uploads", ticket.uploadId);
    let verified = (await getDocFromServer(ticketRef)).data();
    assertOwner(ownerUid);
    if (verified?.status === "PENDING") {
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 16384)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 16384),
        );
      try {
        const response = await withLessonSession<{
          verifiedAsset?: Record<string, unknown>;
        }>(
          "uploadLessonAssetContent",
          {
            uploadId: ticket.uploadId,
            contentBase64: btoa(binary),
          },
          ownerUid,
        );
        verified = response.verifiedAsset;
      } catch (error) {
        verified = (await getDocFromServer(ticketRef)).data();
        assertOwner(ownerUid);
        if (verified?.status !== "VERIFIED") throw error;
      }
    }
    if (verified?.status !== "VERIFIED")
      verified = await waitForAsset(ticket.uploadId, ownerUid);
    assertOwner(ownerUid);
    if (typeof verified.url !== "string" || !verified.url)
      throw new Error("업로드한 파일 주소를 확인할 수 없습니다.");
    const asset = {
      uploadId: ticket.uploadId,
      storagePath: ticket.storagePath,
      url: verified.url,
      pdfProcessing: verified.pdfProcessing as
        | LessonPdfProcessingMeta
        | undefined,
    };
    preparedAssets.set(key, { asset, expiresAtMs: ticket.expiresAtMs });
    return asset;
  })();
  assetFlights.set(key, flight);
  try {
    return await flight;
  } finally {
    assetFlights.delete(key);
  }
};
