import { auth, getHttpsCallable } from "./firebase";
import { ensureWestoryAppCheck } from "./appCheck";
import {
  getLessonCommandScope,
  type LessonCommandScope,
} from "./lessonManagement";
import type { MapResource } from "./mapResources";
import type { SystemConfig } from "../types";

type Config = Pick<SystemConfig, "year" | "semester"> | null | undefined;
export type MapStorageScope = "semester" | "legacy";
export type MapSourceRef = {
  mapId: string;
  originScope: MapStorageScope;
  expectedRevision: number;
  sourceExists: boolean;
  sourceHash: string;
};
type MapCommand =
  | "saveMapResources"
  | "deleteMapResource"
  | "prepareMapAssetUpload";
type CommandResponse<T> = { status: string; result: T };
type UploadedMapAsset = {
  uploadId: string;
  storagePath: string;
  url: string;
  width?: number;
  height?: number;
};
type SavedMapSource = Omit<MapSourceRef, "expectedRevision"> & {
  contentRevision: number;
};
const generation = "w1r2-2026-08-09";
const commandIds = new Map<string, string>();
const commandFlights = new Map<string, Promise<unknown>>();
const assetFlights = new Map<string, Promise<UploadedMapAsset>>();
const uploadTickets = new Map<
  string,
  { uploadId: string; storagePath: string; expiresAtMs: number }
>();
const preparedAssets = new Map<
  string,
  { asset: UploadedMapAsset; expiresAtMs: number }
>();

const assertOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error("로그인 사용자가 바뀌었습니다. 다시 로그인해 주세요.");
};
const isAmbiguous = (error: unknown) =>
  /(?:unavailable|deadline-exceeded|internal|network-request-failed)$/.test(
    String((error as { code?: string })?.code || ""),
  );

// Match the server's raw-document fingerprint, including unknown legacy fields
// and Firestore timestamps. Normalized display data must never be hashed here.
const canonical = (value: unknown): unknown => {
  if (
    value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    const timestamp = value as { seconds: number; nanoseconds: number };
    return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  return value;
};
const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export const createMapSourceRef = async (
  mapId: string,
  originScope: MapStorageScope,
  raw?: Record<string, unknown>,
): Promise<MapSourceRef> => ({
  mapId,
  originScope,
  expectedRevision: Number(raw?.contentRevision || 0),
  sourceExists: raw !== undefined,
  sourceHash:
    raw === undefined
      ? ""
      : await sha256(new TextEncoder().encode(JSON.stringify(canonical(raw)))),
});

const withMapSession = async <T>(
  name: string,
  input: Record<string, unknown>,
  ownerUid: string,
): Promise<T> => {
  assertOwner(ownerUid);
  const user = auth.currentUser!;
  const token = await user.getIdTokenResult();
  const open = await getHttpsCallable<
    Record<string, unknown>,
    {
      status: string;
      authTime: number;
      authorityGeneration: string;
      protocolVersion: number;
      revision: string;
    }
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
  const { data } = await call({
    ...input,
    _session: {
      authorityGeneration: session.authorityGeneration,
      protocolVersion: session.protocolVersion,
      revision: session.revision,
    },
  });
  assertOwner(ownerUid);
  return data;
};

const executeMapCommand = async <T>(
  commandType: MapCommand,
  payload: Record<string, unknown>,
  ownerUid: string,
): Promise<T> => {
  assertOwner(ownerUid);
  const snapshot = JSON.parse(JSON.stringify(payload));
  const key = JSON.stringify([ownerUid, commandType, snapshot]);
  const existing = commandFlights.get(key);
  if (existing) return existing as Promise<T>;
  const commandId = commandIds.get(key) || crypto.randomUUID();
  commandIds.set(key, commandId);
  const flight = (async () => {
    try {
      let response: CommandResponse<T>;
      try {
        response = await withMapSession<CommandResponse<T>>(
          "executeCommand",
          { commandId, commandType, payload: snapshot },
          ownerUid,
        );
      } catch (error) {
        if (!isAmbiguous(error)) throw error;
        const status = await withMapSession<CommandResponse<T>>(
          "getCommandStatus",
          { commandId, commandType },
          ownerUid,
        ).catch(() => null);
        if (status?.status !== "SUCCEEDED") throw error;
        response = status;
      }
      if (response.status !== "SUCCEEDED")
        throw Object.assign(
          new Error(
            "저장 결과를 확인하지 못했습니다. 편집 내용을 유지한 채 다시 저장해 주세요.",
          ),
          { code: "functions/unavailable" },
        );
      assertOwner(ownerUid);
      commandIds.delete(key);
      return response.result;
    } catch (error) {
      if (!isAmbiguous(error)) commandIds.delete(key);
      throw error;
    } finally {
      commandFlights.delete(key);
    }
  })();
  commandFlights.set(key, flight);
  return flight;
};

const documentKeys = [
  "title",
  "category",
  "tabGroup",
  "description",
  "type",
  "imageUrl",
  "fileUrl",
  "storagePath",
  "fileName",
  "mimeType",
  "embedUrl",
  "googleQuery",
  "externalUrl",
  "pdfPageImages",
  "pdfRegions",
  "pdfTagSections",
  "sortOrder",
] as const;
export const saveMapResources = async (
  config: Config,
  resources: {
    source: MapSourceRef;
    document: MapResource;
    assetUploadIds?: string[];
  }[],
): Promise<MapSourceRef[]> => {
  if (!resources.length) return [];
  const ownerUid = auth.currentUser?.uid || "";
  const scope = await getLessonCommandScope(config);
  const result = await executeMapCommand<{ resources: SavedMapSource[] }>(
    "saveMapResources",
    {
      ...scope,
      resources: resources.map(({ source, document, assetUploadIds = [] }) => ({
        ...source,
        // pdfBlanks and answerOptions belong exclusively to assessment commands.
        document: Object.fromEntries(
          documentKeys
            .filter((key) => document[key] !== undefined)
            .map((key) => [key, document[key]]),
        ),
        assetUploadIds,
      })),
    },
    ownerUid,
  );
  return result.resources.map(({ contentRevision, ...source }) => ({
    ...source,
    expectedRevision: contentRevision,
  }));
};

export const deleteMapResource = async (
  config: Config,
  source: MapSourceRef,
) => {
  const ownerUid = auth.currentUser?.uid || "";
  return executeMapCommand(
    "deleteMapResource",
    { ...(await getLessonCommandScope(config)), ...source },
    ownerUid,
  );
};

export const validateMapUploadFile = (
  file: Blob,
  kind: "PDF" | "IMAGE" | "PAGE",
) => {
  const contentType = file.type || (kind === "PDF" ? "application/pdf" : "");
  const allowed =
    kind === "PDF"
      ? ["application/pdf"]
      : ["image/png", "image/jpeg", "image/webp"];
  const maxMb = kind === "PDF" ? 20 : 6;
  if (!allowed.includes(contentType))
    throw new Error(
      kind === "PDF"
        ? "PDF 파일을 선택해 주세요."
        : "PNG, JPG 또는 WebP 이미지를 선택해 주세요.",
    );
  if (!file.size || file.size > maxMb * 1024 * 1024)
    throw new Error(`파일 크기는 ${maxMb}MB 이하여야 합니다.`);
  return contentType;
};

export const uploadMapAsset = async (
  config: Config,
  input: {
    source: MapSourceRef;
    kind: "PDF" | "IMAGE" | "PAGE";
    file: Blob;
    originalName: string;
    sourceUploadId?: string;
    page?: number;
    commandScope?: LessonCommandScope;
  },
): Promise<UploadedMapAsset> => {
  const ownerUid = auth.currentUser?.uid || "";
  assertOwner(ownerUid);
  const contentType = validateMapUploadFile(input.file, input.kind);
  await ensureWestoryAppCheck();
  assertOwner(ownerUid);
  const scope = input.commandScope || (await getLessonCommandScope(config));
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const payload = {
    ...scope,
    ...input.source,
    kind: input.kind,
    contentType,
    byteSize: input.file.size,
    sha256: await sha256(bytes),
    originalName: input.originalName,
    sourceUploadId: input.sourceUploadId || "",
    page: input.page || 0,
  };
  const key = JSON.stringify([ownerUid, payload]);
  assertOwner(ownerUid);
  for (const [cacheKey, entry] of preparedAssets)
    if (entry.expiresAtMs <= Date.now()) preparedAssets.delete(cacheKey);
  for (const [cacheKey, entry] of uploadTickets)
    if (entry.expiresAtMs <= Date.now()) uploadTickets.delete(cacheKey);
  const cached = preparedAssets.get(key);
  if (cached) return cached.asset;
  const existing = assetFlights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    const ticket =
      uploadTickets.get(key) ||
      (await executeMapCommand<{
        uploadId: string;
        storagePath: string;
        expiresAtMs: number;
      }>("prepareMapAssetUpload", payload, ownerUid));
    uploadTickets.set(key, ticket);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 16384)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    const request = { uploadId: ticket.uploadId, contentBase64: btoa(binary) };
    let asset: UploadedMapAsset;
    try {
      asset = await withMapSession<UploadedMapAsset>(
        "uploadMapAssetContent",
        request,
        ownerUid,
      );
    } catch (error) {
      if (!isAmbiguous(error)) throw error;
      // Same immutable object and ticket: retrying recovers a lost response.
      asset = await withMapSession<UploadedMapAsset>(
        "uploadMapAssetContent",
        request,
        ownerUid,
      );
    }
    if (
      asset.uploadId !== ticket.uploadId ||
      asset.storagePath !== ticket.storagePath ||
      !asset.url
    )
      throw new Error("업로드한 파일 주소를 확인할 수 없습니다.");
    assertOwner(ownerUid);
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
