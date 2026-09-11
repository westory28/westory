import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db, getHttpsCallable } from "./firebase";
import { executeWestoryCommand } from "./commandGateway";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";
import type { MapResource } from "./mapResources";

export interface MapSource {
  mapId: string;
  originScope: "semester" | "legacy";
  expectedRevision: number;
  sourceExists: boolean;
  sourceHash: string;
}
export type MapDocument = Omit<
  MapResource,
  "id" | "contentRevision" | "pdfBlanks" | "answerOptions"
>;
export interface MapWrite extends MapSource {
  document: MapDocument;
  assetUploadIds: string[];
}
export interface MapScope {
  semesterId: string;
  expectedSemesterRevision: number;
}
export interface MapUploadInput extends MapSource {
  kind: "PDF" | "IMAGE" | "PAGE";
  sourceUploadId: string;
  page: number;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalName: string;
}
export interface MapSavedSource {
  mapId: string;
  contentRevision: number;
  originScope: "semester" | "legacy";
  sourceHash: string;
  sourceExists: boolean;
}
export interface MapAsset {
  uploadId: string;
  storagePath: string;
  url: string;
  width?: number;
  height?: number;
}
export interface RetainedMapAsset extends MapAsset {
  kind: "PDF" | "IMAGE" | "PAGE";
  sourceUploadId?: string;
}
export const getAttachedMapUploadIds = (
  document: MapDocument,
  assets: RetainedMapAsset[],
): string[] => {
  const main = assets.find(
    (asset) =>
      asset.kind ===
        (document.type === "pdf"
          ? "PDF"
          : document.type === "image"
            ? "IMAGE"
            : "") &&
      asset.storagePath === document.storagePath &&
      asset.url === document.fileUrl &&
      (asset.kind !== "IMAGE" || document.imageUrl === asset.url),
  );
  if (!main) return [];
  return assets
    .filter(
      (asset) =>
        asset.uploadId === main.uploadId ||
        (main.kind === "PDF" &&
          asset.kind === "PAGE" &&
          asset.sourceUploadId === main.uploadId &&
          (document.pdfPageImages || []).some(
            (page) => page.imageUrl === asset.url,
          )),
    )
    .map((asset) => asset.uploadId);
};
type Config = Pick<SystemConfig, "year" | "semester"> | null | undefined;
// Reauthentication can remount the editor. Keep the submitted draft and files
// in tab memory only, scoped to the original account and semester.
export const mapEditorRecovery = new Map<
  string,
  {
    snapshot: unknown;
    pending: boolean;
    succeeded: boolean;
    settled: Promise<void>;
    finish: (succeeded: boolean) => void;
  }
>();
const canonical = (value: any): any =>
  value && typeof value.toMillis === "function"
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((name) => [name, canonical(value[name])]),
          )
        : value;
const hash = async (bytes: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export const fingerprintMapSource = (data: Record<string, unknown>) =>
  hash(new TextEncoder().encode(JSON.stringify(canonical(data))));
export const toMapDocument = (resource: MapResource): MapDocument => {
  const {
    id: _id,
    contentRevision: _revision,
    pdfBlanks: _blanks,
    answerOptions: _answers,
    ...document
  } = resource;
  return document;
};
export const getMapCommandScope = async (config: Config): Promise<MapScope> => {
  const match = getSemesterCollectionPath(config, "map_resources").match(
    /^years\/(\d{4})\/semesters\/([12])\/map_resources$/,
  );
  if (!match) throw new Error("지도의 학기를 확인할 수 없습니다.");
  const semesterId = `${match[1]}-${match[2]}`;
  const data = (
    await getDocFromServer(doc(db, "site_settings/semester_active"))
  ).data();
  if (data?.semesterId !== semesterId || !Number.isSafeInteger(data.revision))
    throw new Error(
      "현재 학기가 변경되었습니다. 편집 내용을 보관한 뒤 다시 열어 주세요.",
    );
  return { semesterId, expectedSemesterRevision: data.revision };
};
const unconfirmedWrites = new Map<
  string,
  MapScope & { resources: MapWrite[] }
>();
export const saveMapResources = async (
  config: Config,
  resources: MapWrite[],
  expectedUid = auth.currentUser?.uid,
) => {
  if (!expectedUid) throw new Error("로그인 상태를 확인해 주세요.");
  const key = `${expectedUid}/${config?.year}/${config?.semester}`;
  const prior = unconfirmedWrites.get(key);
  if (prior && JSON.stringify(prior.resources) !== JSON.stringify(resources))
    throw new Error("직전 지도 저장 결과를 먼저 확인해 주세요.");
  const payload = prior || {
    ...(await getMapCommandScope(config)),
    resources: structuredClone(resources),
  };
  unconfirmedWrites.set(key, payload);
  try {
    const result = (
      await executeWestoryCommand("saveMapResources", payload, { expectedUid })
    ).result;
    unconfirmedWrites.delete(key);
    return result;
  } catch (error) {
    if (
      !(error as { retryable?: boolean })?.retryable &&
      (error as { reason?: string })?.reason !== "COMMAND_OUTCOME_UNCONFIRMED"
    )
      unconfirmedWrites.delete(key);
    throw error;
  }
};
export const deleteMapResource = async (
  config: Config,
  source: MapSource,
  expectedUid = auth.currentUser?.uid,
) => {
  if (!expectedUid) throw new Error("로그인 상태를 확인해 주세요.");
  return (
    await executeWestoryCommand(
      "deleteMapResource",
      { ...(await getMapCommandScope(config)), ...source },
      { expectedUid },
    )
  ).result;
};
export const uploadMapAsset = async (
  config: Config,
  source: MapSource,
  file: Blob,
  kind: "PDF" | "IMAGE" | "PAGE",
  expectedUid: string,
  sourceUploadId = "",
  page = 0,
  originalName = "",
): Promise<MapAsset> => {
  if (auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌어 업로드를 중단했습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { result: ticket } = await executeWestoryCommand(
    "prepareMapAssetUpload",
    {
      ...(await getMapCommandScope(config)),
      ...source,
      kind,
      sourceUploadId,
      page,
      contentType:
        file.type || (kind === "PDF" ? "application/pdf" : "image/png"),
      byteSize: bytes.byteLength,
      sha256: await hash(bytes),
      originalName,
    },
    { expectedUid },
  );
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  const upload = await getHttpsCallable<
    { uploadId: string; contentBase64: string },
    MapAsset
  >("uploadMapAssetContent", { expectedUid });
  const payload = { uploadId: ticket.uploadId, contentBase64: btoa(binary) };
  try {
    return (await upload(payload)).data;
  } catch (error) {
    // Retry only an uncertain transport acknowledgement, with the same ticket.
    const code = String((error as { code?: string })?.code || "");
    if (!/unavailable|deadline-exceeded|internal/.test(code)) throw error;
    return (await upload(payload)).data;
  }
};
