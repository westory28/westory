import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db, readWrittenExamAssetChunk } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import { assertArchiveWritable, isSemesterArchive } from "./semesterArchive";

// Keep each authenticated request below the callable JSON payload limit,
// including base64 expansion, while retaining the existing 30 MB PDF limit.
const CHUNK_BYTES = 4 * 1024 * 1024;
const limits: Record<string, number> = {
  "application/pdf": 30 * 1024 * 1024,
  "image/png": 12 * 1024 * 1024,
  "image/webp": 12 * 1024 * 1024,
};
const digest = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
const decode = (value: string) => {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
    !value.length ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("분석 파일을 온전히 받지 못했습니다. 다시 시도해 주세요.");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const createTransport = () => {
  const user = auth.currentUser;
  const assertOwner = () => {
    if (!user || auth.currentUser !== user)
      throw new Error("로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.");
  };
  assertOwner();
  return {
    assertOwner,
    async call<Response>(input: Record<string, unknown>): Promise<Response> {
      assertOwner();
      if (isSemesterArchive) {
        if (input.action !== "read") assertArchiveWritable();
        // Archive windows must not open/touch sessions. Read the current login's
        // existing proof and use only this server-validated, read-only operation.
        const token = await user!.getIdTokenResult();
        const authTime = Number(token.claims.auth_time);
        if (!Number.isSafeInteger(authTime) || authTime <= 0)
          throw new Error("로그인 세션을 확인하지 못했습니다.");
        const session = await getDocFromServer(
          doc(db, `application_sessions/${user!.uid}/sessions/${authTime}`),
        );
        const proof = session.data();
        if (!proof || proof.status !== "active")
          throw new Error("다시 로그인한 뒤 이전 학기 자료를 열어 주세요.");
        assertOwner();
        if (
          Number((await user!.getIdTokenResult()).claims.auth_time) !== authTime
        )
          throw new Error("로그인 상태가 변경되었습니다.");
        assertOwner();
        const result = await readWrittenExamAssetChunk<Response>(
          {
            storagePath: String(input.storagePath),
            chunkIndex: Number(input.chunkIndex),
            _session: {
              authorityGeneration: proof.authorityGeneration,
              protocolVersion: proof.protocolVersion,
              revision: proof.sessionRevision,
            },
          },
          assertOwner,
        );
        assertOwner();
        if (
          Number((await user!.getIdTokenResult()).claims.auth_time) !== authTime
        )
          throw new Error("로그인 상태가 변경되었습니다.");
        return result.data;
      }
      const response = await callWithApplicationSession<
        Record<string, unknown>,
        Response
      >("manageWrittenExamAsset", input, user, { beforeDispatch: assertOwner });
      assertOwner();
      return response.data;
    },
  };
};

export async function uploadWrittenExamAsset(storagePath: string, blob: Blob) {
  assertArchiveWritable();
  const transport = createTransport();
  if (!limits[blob.type] || blob.size < 1 || blob.size > limits[blob.type])
    throw new Error(
      "PDF는 30MB 이하, 페이지 이미지는 12MB 이하로 올려 주세요.",
    );
  const bytes = await blob.arrayBuffer();
  const sha256 = await digest(bytes);
  transport.assertOwner();
  const chunks = Math.ceil(blob.size / CHUNK_BYTES);
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex += 1) {
    const result = await transport.call<{
      accepted: boolean;
      complete: boolean;
    }>({
      action: "upload",
      storagePath,
      contentType: blob.type,
      totalSize: blob.size,
      sha256,
      chunkIndex,
      contentBase64: encode(
        new Uint8Array(
          bytes.slice(chunkIndex * CHUNK_BYTES, (chunkIndex + 1) * CHUNK_BYTES),
        ),
      ),
    });
    if (!result.accepted || (chunkIndex === chunks - 1 && !result.complete))
      throw new Error("파일 저장을 확인하지 못했습니다. 다시 등록해 주세요.");
  }
}

export async function readWrittenExamAsset(storagePath: string): Promise<Blob> {
  const transport = createTransport();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let totalSize = 0;
  let contentType = "";
  let sha256: string | undefined;
  for (
    let chunkIndex = 0;
    chunkIndex === 0 || chunkIndex * CHUNK_BYTES < totalSize;
    chunkIndex += 1
  ) {
    const result = await transport.call<{
      chunkIndex: number;
      contentBase64: string;
      contentType: string;
      totalSize: number;
      sha256?: string;
    }>({ action: "read", storagePath, chunkIndex });
    if (
      result.chunkIndex !== chunkIndex ||
      !Number.isSafeInteger(result.totalSize) ||
      result.totalSize < 1 ||
      !limits[result.contentType] ||
      result.totalSize > limits[result.contentType] ||
      (chunkIndex > 0 &&
        (result.totalSize !== totalSize ||
          result.contentType !== contentType ||
          result.sha256 !== sha256))
    )
      throw new Error(
        "분석 파일 정보가 일치하지 않습니다. 다시 불러와 주세요.",
      );
    totalSize = result.totalSize;
    contentType = result.contentType;
    sha256 = result.sha256;
    const bytes = decode(result.contentBase64);
    if (
      bytes.length !==
      Math.min(CHUNK_BYTES, totalSize - chunkIndex * CHUNK_BYTES)
    )
      throw new Error("분석 파일 일부가 누락되었습니다. 다시 불러와 주세요.");
    parts.push(bytes);
  }
  const blob = new Blob(parts, { type: contentType });
  if (sha256 && (await digest(await blob.arrayBuffer())) !== sha256)
    throw new Error("분석 파일 내용이 일치하지 않습니다. 다시 불러와 주세요.");
  transport.assertOwner();
  return blob;
}

export async function removeWrittenExamAsset(storagePath: string) {
  assertArchiveWritable();
  const transport = createTransport();
  const result = await transport.call<{ deleted: boolean }>({
    action: "remove",
    storagePath,
  });
  if (!result.deleted) throw new Error("임시 파일 정리를 완료하지 못했습니다.");
}
