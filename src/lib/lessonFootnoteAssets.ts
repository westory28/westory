import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { storage } from "./firebase";
import { getSemesterCollectionPath } from "./semesterScope";

export const getLessonFootnoteAssetPath = (
  config: { year: string; semester: string } | null | undefined,
  unitId: string,
  footnoteId: string,
  fileName: string,
) => {
  const extension = fileName.split(".").pop()?.trim().toLowerCase() || "png";
  return `${getSemesterCollectionPath(config, "lesson_footnotes")}/${unitId}/${footnoteId}/${Date.now()}.${extension}`;
};

export const uploadLessonFootnoteAsset = async (params: {
  config: { year: string; semester: string } | null | undefined;
  unitId: string;
  footnoteId: string;
  file: File;
}) => {
  const storagePath = getLessonFootnoteAssetPath(
    params.config,
    params.unitId,
    params.footnoteId,
    params.file.name,
  );
  const storageRef = ref(storage, storagePath);
  const extension =
    params.file.name.split(".").pop()?.trim().toLowerCase() || "png";

  await uploadBytes(storageRef, params.file, {
    contentType: params.file.type || `image/${extension}`,
  });

  return {
    imageUrl: await getDownloadURL(storageRef),
    imageStoragePath: storageRef.fullPath,
  };
};

export const tryDeleteLessonFootnoteAsset = async (
  storagePath: string,
  logger: Pick<Console, "error"> = console,
) => {
  if (!storagePath) return false;
  try {
    await deleteObject(ref(storage, storagePath));
    return true;
  } catch (error) {
    logger.error("Failed to delete lesson footnote asset:", error);
    return false;
  }
};
