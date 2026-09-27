import * as sdk from "@firebase/storage";
import { assertArchiveWritable } from "./semesterArchive";

export * from "@firebase/storage";

const writable = <T extends (...args: any[]) => any>(operation: T): T =>
  ((...args: Parameters<T>) => {
    assertArchiveWritable();
    return operation(...args);
  }) as T;

export const uploadBytes = writable(sdk.uploadBytes);
export const uploadBytesResumable = writable(sdk.uploadBytesResumable);
export const uploadString = writable(sdk.uploadString);
export const deleteObject = writable(sdk.deleteObject);
export const updateMetadata = writable(sdk.updateMetadata);
