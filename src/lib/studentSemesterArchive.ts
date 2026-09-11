import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export interface StudentSemesterArchiveNotice {
  semesterId: string;
  provenance: "ARCHIVE" | "LEGACY" | "EXPLICIT";
  status: "CLOSED" | "ARCHIVED";
}

// semester_manifests permits authenticated application reads. Historical
// enrollment/archive documents remain outside this metadata-only notice list.
export const loadStudentSemesterArchive = async ({
  studentUid,
  currentSemesterId,
  semesterId,
}: {
  studentUid: string;
  currentSemesterId: string;
  semesterId?: string;
}): Promise<StudentSemesterArchiveNotice[]> => {
  const assertOwner = () => {
    if (!studentUid || auth.currentUser?.uid !== studentUid)
      throw new Error(
        "로그인 사용자가 바뀌었습니다. 지난 학기 안내를 다시 열어 주세요.",
      );
  };
  assertOwner();
  const valid = (value: string) => /^\d{4}-[12]$/.test(value);
  if (
    !valid(currentSemesterId) ||
    (semesterId !== undefined && !valid(semesterId))
  )
    throw new Error("조회할 학기를 확인해 주세요.");
  if (semesterId === currentSemesterId) return [];
  const documents = semesterId
    ? [await getDoc(doc(db, "semester_manifests", semesterId))]
    : (
        await getDocs(
          query(
            collection(db, "semester_manifests"),
            where("status", "in", ["CLOSED", "ARCHIVED"]),
            limit(101),
          ),
        )
      ).docs;
  assertOwner();
  if (documents.length > 100)
    throw new Error("지난 학기 안내의 조회 범위를 확인해 주세요.");
  return documents
    .flatMap((document): StudentSemesterArchiveNotice[] => {
      if (!document.exists()) return [];
      const data = document.data(),
        id = String(data.semesterId || document.id);
      if (
        !valid(id) ||
        id !== document.id ||
        id === currentSemesterId ||
        (semesterId && id !== semesterId) ||
        !["CLOSED", "ARCHIVED"].includes(data.status)
      )
        return [];
      return [
        {
          semesterId: id,
          status: data.status,
          provenance:
            data.provenance === "LEGACY"
              ? "LEGACY"
              : data.provenance === "ARCHIVE"
                ? "ARCHIVE"
                : "EXPLICIT",
        },
      ];
    })
    .sort((left, right) => right.semesterId.localeCompare(left.semesterId));
};
