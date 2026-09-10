import { doc, getDoc, getDocFromServer } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { auth, db, getFirebaseStorage } from "./firebase";
import {
  executeWestoryCommand,
  type W2CommandPayloads,
} from "./commandGateway";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";
import type { LessonPdfProcessingMeta } from "./lessonPdfExtraction";

type Config = Pick<SystemConfig, "year" | "semester"> | null | undefined;
export const getLessonCommandScope = async (config: Config) => {
  const match = getSemesterCollectionPath(config, "lessons").match(
    /^years\/(\d{4})\/semesters\/([12])\/lessons$/,
  );
  if (!match) throw new Error("수업자료의 학기를 확인할 수 없습니다.");
  const semesterId = `${match[1]}-${match[2]}`;
  const pointer = await getDoc(doc(db, "site_settings/semester_active"));
  const data = pointer.data();
  if (
    !data ||
    data.semesterId !== semesterId ||
    !Number.isSafeInteger(data.revision)
  )
    throw new Error("현재 학기가 변경되었습니다. 화면을 다시 열어 주세요.");
  return { semesterId, expectedSemesterRevision: data.revision as number };
};
export const saveLessonTree = async (
  config: Config,
  input: Omit<
    W2CommandPayloads["saveLessonTree"],
    "semesterId" | "expectedSemesterRevision"
  >,
) =>
  (
    await executeWestoryCommand("saveLessonTree", {
      ...(await getLessonCommandScope(config)),
      ...input,
    })
  ).result;
export const saveLessonDocument = async (
  config: Config,
  input: Omit<
    W2CommandPayloads["saveLessonDocument"],
    "semesterId" | "expectedSemesterRevision"
  >,
) =>
  (
    await executeWestoryCommand("saveLessonDocument", {
      ...(await getLessonCommandScope(config)),
      ...input,
    })
  ).result;

export const uploadLessonAsset = async (
  config: Config,
  input: {
    unitId: string;
    expectedRevision: number;
    kind: "PDF" | "PAGE" | "FOOTNOTE";
    file: Blob;
    originalName?: string;
  },
) => {
  const ownerUid = auth.currentUser?.uid;
  if (!ownerUid) throw new Error("로그인 상태를 확인해 주세요.");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    await input.file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const { result: ticket } = await executeWestoryCommand(
    "prepareLessonAssetUpload",
    {
      ...(await getLessonCommandScope(config)),
      unitId: input.unitId,
      expectedRevision: input.expectedRevision,
      kind: input.kind,
      contentType:
        input.file.type ||
        (input.kind === "PDF" ? "application/pdf" : "image/png"),
      byteSize: input.file.size,
      sha256,
      originalName: input.originalName || "",
    },
  );
  if (auth.currentUser?.uid !== ownerUid)
    throw new Error("로그인 사용자가 바뀌어 업로드를 중단했습니다.");
  const ticketRef = doc(db, "lesson_asset_uploads", ticket.uploadId);
  const prior = (await getDocFromServer(ticketRef)).data();
  if (prior?.status === "PENDING") {
    try {
      await uploadBytes(
        ref(await getFirebaseStorage(), ticket.storagePath),
        input.file,
        {
          contentType:
            input.file.type ||
            (input.kind === "PDF" ? "application/pdf" : "image/png"),
        },
      );
    } catch (error) {
      // A lost upload acknowledgement may race the finalizer. Poll the ticket
      // once before surfacing the error; never overwrite an existing object.
      const latest = (await getDocFromServer(ticketRef)).data();
      if (!["VERIFIED", "ATTACHED"].includes(latest?.status)) throw error;
    }
  }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (auth.currentUser?.uid !== ownerUid)
      throw new Error("로그인 사용자가 바뀌었습니다.");
    const result = (await getDocFromServer(ticketRef)).data();
    if (result?.status === "VERIFIED")
      return {
        uploadId: ticket.uploadId,
        storagePath: ticket.storagePath,
        url: String(result.url),
        pdfProcessing: result.pdfProcessing as
          | LessonPdfProcessingMeta
          | undefined,
      };
    if (result?.status === "FAILED" || result?.status === "ATTACHED")
      throw new Error(result.error || "업로드 요청을 다시 시작해 주세요.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "파일 검증 시간이 길어지고 있습니다. 현재 편집 내용을 유지한 채 다시 저장해 주세요.",
  );
};
