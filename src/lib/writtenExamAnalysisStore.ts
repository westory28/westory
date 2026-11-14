import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getBlob, ref, uploadBytes } from "firebase/storage";
import { auth, db, getFirebaseStorage } from "./firebase";
import { assertArchiveWritable } from "./semesterArchive";
import { getSemesterCollectionPath, getYearSemester } from "./semesterScope";
import type {
  WrittenExamImportedStudent,
  WrittenExamQuestionInfo,
} from "./writtenExamAnalysisImport";
import type { WrittenExamPaperCrop } from "./writtenExamPaperCrop";

type Config = Parameters<typeof getYearSemester>[0];
export const WRITTEN_EXAM_ANALYSES_COLLECTION = "written_exam_analyses";
export interface WrittenExamAnalysisFile {
  fileName: string;
  kind: "pdf" | "page";
  page?: number;
  size: number;
  contentType: string;
}
export interface WrittenExamAnalysisMetadata {
  id: string;
  schemaVersion: 1;
  year: string;
  semester: string;
  title: string;
  examDate: string;
  grade: string;
  revision: string;
  classIds: string[];
  studentCount: number;
  questions: WrittenExamQuestionInfo[];
  crops: WrittenExamPaperCrop[];
  files: WrittenExamAnalysisFile[];
  updatedBy: string;
  updatedAt: unknown;
}
export interface WrittenExamAnalysisSaveInput {
  examId?: string;
  expectedRevision: string | null;
  title: string;
  examDate: string;
  grade: string;
  questions: WrittenExamQuestionInfo[];
  students: WrittenExamImportedStudent[];
  crops: WrittenExamPaperCrop[];
  files: Array<{
    fileName: string;
    kind: "pdf" | "page";
    page?: number;
    blob: Blob;
  }>;
}

const segment = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new Error("분석 자료 경로가 올바르지 않습니다.");
  return value;
};
const scopePath = (config: Config) => {
  const { year, semester } = getYearSemester(config);
  if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester))
    throw new Error("학기를 확인해 주세요.");
  return getSemesterCollectionPath(config, WRITTEN_EXAM_ANALYSES_COLLECTION);
};
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const byteSize = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const assetPath = (
  config: Config,
  examId: string,
  revision: string,
  fileName: string,
) => {
  if (!/^[A-Za-z0-9_-]{1,80}\.(pdf|png|webp)$/.test(fileName))
    throw new Error("분석 파일 이름이 올바르지 않습니다.");
  return `${scopePath(config)}/${segment(examId)}/${segment(revision)}/${fileName}`;
};

/** Metadata only; no roster, response, legacy collection, or inactive tab reads. */
export async function listWrittenExamAnalyses(
  config: Config,
  options: { grade?: string } = {},
) {
  const base = collection(db, scopePath(config));
  const snapshot = await getDocsFromServer(
    options.grade ? query(base, where("grade", "==", options.grade)) : base,
  );
  return snapshot.docs
    .map(
      (item) =>
        ({ ...item.data(), id: item.id }) as WrittenExamAnalysisMetadata,
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

/** Every invocation bypasses the SDK cache and reads only the selected exam/revision. */
export async function loadWrittenExamAnalysis(
  config: Config,
  examId: string,
  options: { classId?: string } = {},
) {
  const base = `${scopePath(config)}/${segment(examId)}`;
  const manifest = await getDocFromServer(doc(db, base));
  if (!manifest.exists())
    throw new Error(
      "평가 분석 자료를 찾지 못했습니다. 목록을 새로고침해 주세요.",
    );
  const metadata = {
    ...manifest.data(),
    id: manifest.id,
  } as WrittenExamAnalysisMetadata;
  segment(metadata.revision);
  const classPath = `${base}/revisions/${metadata.revision}/classes`;
  if (options.classId && !metadata.classIds.includes(options.classId))
    throw new Error("선택한 학급의 분석 자료가 없습니다.");
  const snapshots = options.classId
    ? [await getDocFromServer(doc(db, classPath, segment(options.classId)))]
    : (await getDocsFromServer(collection(db, classPath))).docs;
  const expected = options.classId ? [options.classId] : metadata.classIds;
  if (
    snapshots.length !== expected.length ||
    snapshots.some((item) => !item.exists() || !expected.includes(item.id))
  ) {
    throw new Error(
      "분석 자료가 완전하지 않습니다. 새로고침한 뒤 다시 확인해 주세요.",
    );
  }
  const students = snapshots.flatMap((item) => {
    const data = item.data();
    if (
      !data ||
      data.revision !== metadata.revision ||
      data.year !== metadata.year ||
      data.semester !== metadata.semester ||
      !Array.isArray(data.students)
    ) {
      throw new Error("분석 자료의 학기와 버전을 확인하지 못했습니다.");
    }
    return data.students as WrittenExamImportedStudent[];
  });
  if (!options.classId && students.length !== metadata.studentCount)
    throw new Error("분석 학생 수가 일치하지 않습니다. 다시 불러와 주세요.");
  return {
    metadata,
    students,
    readCounts: { metadata: 1, classes: snapshots.length },
  };
}

export async function loadWrittenExamAnalysisAsset(
  config: Config,
  examId: string,
  revision: string,
  fileName: string,
) {
  const storage = await getFirebaseStorage();
  // Authenticated bytes only: never produce or persist a bearer download URL.
  return getBlob(
    ref(storage, assetPath(config, examId, revision, fileName)),
    30 * 1024 * 1024,
  );
}

/** Upload immutable revision data first, then atomically publish one manifest. */
export async function saveWrittenExamAnalysis(
  config: Config,
  input: WrittenExamAnalysisSaveInput,
): Promise<WrittenExamAnalysisMetadata> {
  assertArchiveWritable();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("로그인 상태를 확인한 뒤 다시 저장해 주세요.");
  const root = scopePath(config);
  const { year, semester } = getYearSemester(config);
  const examId = input.examId
    ? segment(input.examId)
    : doc(collection(db, root)).id;
  if (input.expectedRevision !== null) segment(input.expectedRevision);
  const title = input.title.trim();
  if (!title || title.length > 160 || !/^[1-3]$/.test(input.grade))
    throw new Error("평가명과 학년을 확인해 주세요.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.examDate) ||
    !Number.isFinite(Date.parse(input.examDate)) ||
    new Date(input.examDate).toISOString().slice(0, 10) !== input.examDate
  )
    throw new Error("시험일을 확인해 주세요.");
  if (
    !input.questions.length ||
    input.questions.length > 200 ||
    !input.students.length
  )
    throw new Error("문항정보와 학생답 자료를 확인해 주세요.");
  const questionNumbers = new Set(
    input.questions.map((question) => question.number),
  );
  if (
    questionNumbers.size !== input.questions.length ||
    input.questions.some(
      (question) =>
        !Number.isInteger(question.number) ||
        question.number < 1 ||
        !Number.isFinite(question.points) ||
        question.points <= 0,
    )
  )
    throw new Error("문항번호와 배점을 확인해 주세요.");
  const groups = new Map<string, WrittenExamImportedStudent[]>();
  const keys = new Set<string>();
  for (const student of input.students) {
    if (
      student.grade !== input.grade ||
      !/^[1-9]\d?$/.test(student.class) ||
      !student.key ||
      keys.has(student.key)
    )
      throw new Error("학년·학급 또는 중복 학생을 확인해 주세요.");
    if (
      student.responses.some(
        (response) => !questionNumbers.has(response.questionNumber),
      )
    )
      throw new Error("문항정보표와 학생답의 문항번호가 일치하지 않습니다.");
    keys.add(student.key);
    const classId = `${student.grade}-${student.class}`;
    groups.set(classId, [...(groups.get(classId) || []), student]);
  }
  const classIds = [...groups.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (
    classIds.length > 99 ||
    [...groups.values()].some(
      (students) => students.length > 150 || byteSize(students) > 800_000,
    )
  )
    throw new Error(
      "학급별 분석 자료가 너무 큽니다. 학생답 파일을 확인해 주세요.",
    );
  const fileNames = new Set<string>();
  const pages = new Set<number>();
  let pdfCount = 0;
  const files: WrittenExamAnalysisFile[] = input.files.map((file) => {
    assetPath(config, examId, "validation", file.fileName);
    if (fileNames.has(file.fileName))
      throw new Error("분석 파일 이름이 중복됩니다.");
    fileNames.add(file.fileName);
    const pdf = file.kind === "pdf";
    if (pdf) pdfCount += 1;
    if (
      file.blob.size <= 0 ||
      file.blob.size > (pdf ? 30 : 12) * 1024 * 1024 ||
      !(pdf
        ? file.blob.type === "application/pdf" && file.fileName.endsWith(".pdf")
        : ["image/png", "image/webp"].includes(file.blob.type) &&
          file.fileName.endsWith(
            file.blob.type === "image/png" ? ".png" : ".webp",
          ))
    )
      throw new Error(
        "PDF는 30MB 이하, 페이지 이미지는 PNG·WebP 12MB 이하로 올려 주세요.",
      );
    if (!pdf) {
      if (
        !Number.isInteger(file.page) ||
        (file.page || 0) < 1 ||
        (file.page || 0) > 80 ||
        pages.has(file.page!)
      )
        throw new Error("페이지 이미지 번호를 확인해 주세요.");
      pages.add(file.page!);
    }
    return plain({
      fileName: file.fileName,
      kind: file.kind,
      page: file.page,
      size: file.blob.size,
      contentType: file.blob.type,
    });
  });
  if (
    pdfCount > 1 ||
    pages.size > 80 ||
    files.reduce((total, file) => total + file.size, 0) > 128 * 1024 * 1024
  )
    throw new Error(
      "원안지 한 개와 전체 128MB 이하의 페이지 이미지를 올려 주세요.",
    );
  if (
    input.crops.some(
      (crop) =>
        !questionNumbers.has(crop.questionNumber) || !pages.has(crop.page),
    )
  )
    throw new Error("문항 크롭에 연결된 페이지 이미지가 없습니다.");
  const manifestRef = doc(db, root, examId);
  const revision = doc(collection(manifestRef, "revisions")).id;
  const revisionRef = doc(manifestRef, "revisions", revision);
  const metadata = plain({
    id: examId,
    schemaVersion: 1 as const,
    year,
    semester,
    title,
    examDate: input.examDate,
    grade: input.grade,
    revision,
    classIds,
    studentCount: input.students.length,
    questions: input.questions,
    crops: input.crops,
    files,
    updatedBy: uid,
    updatedAt: null,
  }) as WrittenExamAnalysisMetadata;
  if (byteSize(metadata) > 800_000)
    throw new Error("문항정보와 크롭 자료가 너무 큽니다.");
  const uploaded: string[] = [];
  const writtenClasses: string[] = [];
  try {
    await setDoc(revisionRef, {
      schemaVersion: 1,
      year,
      semester,
      examId,
      revision,
      state: "staging",
      uploadedBy: uid,
      classIds,
      studentCount: metadata.studentCount,
      createdAt: serverTimestamp(),
    });
    for (const file of input.files) {
      const path = assetPath(config, examId, revision, file.fileName);
      // Track before sending so an acknowledged-on-server / failed-on-client upload is cleaned up too.
      uploaded.push(path);
      await uploadBytes(ref(await getFirebaseStorage(), path), file.blob, {
        contentType: file.blob.type,
        cacheControl: "private, no-store",
        customMetadata: { ownerUid: uid, year, semester, examId, revision },
      });
    }
    const batch = writeBatch(db);
    for (const [classId, students] of groups) {
      writtenClasses.push(classId);
      batch.set(
        doc(revisionRef, "classes", classId),
        plain({
          schemaVersion: 1,
          year,
          semester,
          examId,
          revision,
          classId,
          grade: input.grade,
          students,
        }),
      );
    }
    await batch.commit();
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(manifestRef);
      const currentRevision = current.exists() ? current.data().revision : null;
      if (currentRevision !== input.expectedRevision)
        throw new Error(
          "다른 작업에서 분석 자료가 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.",
        );
      transaction.update(revisionRef, { state: "ready" });
      transaction.set(manifestRef, {
        ...metadata,
        updatedAt: serverTimestamp(),
      });
    });
    return { ...metadata, updatedAt: new Date() };
  } catch (error) {
    // A lost commit acknowledgement must never delete a published revision.
    try {
      const savedRevision = await getDocFromServer(revisionRef);
      if (savedRevision.data()?.state === "ready") {
        const savedManifest = await getDocFromServer(manifestRef);
        if (savedManifest.data()?.revision === revision)
          return {
            ...savedManifest.data(),
            id: examId,
          } as WrittenExamAnalysisMetadata;
      } else if (
        savedRevision.exists() &&
        savedRevision.data().uploadedBy === uid
      ) {
        const cleanup = await Promise.allSettled([
          ...uploaded.map(async (path) =>
            deleteObject(ref(await getFirebaseStorage(), path)),
          ),
          ...writtenClasses.map((classId) =>
            deleteDoc(doc(revisionRef, "classes", classId)),
          ),
        ]);
        // Keep the staging marker when cleanup cannot finish; it remains invisible to readers.
        if (
          cleanup.every(
            (result) =>
              result.status === "fulfilled" ||
              (result.reason as { code?: string })?.code ===
                "storage/object-not-found",
          )
        )
          await deleteDoc(revisionRef);
      }
    } catch {
      /* Unknown commit state: retain staged data, never mutate the visible manifest. */
    }
    throw error;
  }
}
