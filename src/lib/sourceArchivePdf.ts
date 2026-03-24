export interface PreparedSourceArchivePdfUpload {
  kind: "pdf";
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  extension: string;
  originalName: string;
  originalMimeType: string;
  originalByteSize: number;
  originalWidth: number;
  originalHeight: number;
}

export const isSourceArchivePdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export const buildSourceArchivePdfUpload = async (
  file: File,
): Promise<PreparedSourceArchivePdfUpload> => {
  if (!isSourceArchivePdfFile(file)) {
    throw new Error("PDF 파일을 선택해 주세요.");
  }

  return {
    kind: "pdf",
    blob: file,
    mimeType: "application/pdf",
    width: 0,
    height: 0,
    byteSize: file.size || 0,
    extension: "pdf",
    originalName: file.name,
    originalMimeType: file.type || "application/pdf",
    originalByteSize: file.size || 0,
    originalWidth: 0,
    originalHeight: 0,
  };
};
