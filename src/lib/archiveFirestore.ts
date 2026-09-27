import * as sdk from "@firebase/firestore";
import {
  assertArchiveWritable,
  getArchiveReadPath,
  isSemesterArchive,
} from "./semesterArchive";

// Vite routes every application Firestore import through this module, including
// dynamic imports. Import the underlying SDK here to avoid alias recursion.
export * from "@firebase/firestore";

const writable = <T extends (...args: any[]) => any>(operation: T): T =>
  ((...args: Parameters<T>) => {
    assertArchiveWritable();
    return operation(...args);
  }) as T;

export const addDoc = writable(sdk.addDoc);
export const setDoc = writable(sdk.setDoc);
export const updateDoc = writable(sdk.updateDoc);
export const deleteDoc = writable(sdk.deleteDoc);
export const writeBatch = writable(sdk.writeBatch);
export const runTransaction = writable(sdk.runTransaction);
// The runtime also exposes this internal write entry point without a public
// declaration. Keep it guarded if code imports it through the SDK namespace.
export const executeWrite = writable(
  (sdk as unknown as { executeWrite: (...args: unknown[]) => Promise<void> })
    .executeWrite,
);

// Also guard direct constructor use, so a batch cannot bypass writeBatch().
export type WriteBatch = sdk.WriteBatch;
export const WriteBatch = isSemesterArchive
  ? new Proxy(sdk.WriteBatch, {
      construct(target, args) {
        assertArchiveWritable();
        return Reflect.construct(target, args);
      },
    })
  : sdk.WriteBatch;
export type Transaction = sdk.Transaction;
export const Transaction = isSemesterArchive
  ? new Proxy(sdk.Transaction, {
      construct(target, args) {
        assertArchiveWritable();
        return Reflect.construct(target, args);
      },
    })
  : sdk.Transaction;

export const doc: typeof sdk.doc = ((...args: Parameters<typeof sdk.doc>) => {
  const reference = sdk.doc(...args);
  if (!isSemesterArchive) return reference;
  const archivePath = getArchiveReadPath(reference.path);
  if (archivePath === reference.path) return reference;
  const archived = sdk.doc(reference.firestore, archivePath);
  return reference.converter
    ? archived.withConverter(reference.converter)
    : archived;
}) as typeof sdk.doc;

export const collection: typeof sdk.collection = ((
  ...args: Parameters<typeof sdk.collection>
) => {
  const reference = sdk.collection(...args);
  if (!isSemesterArchive) return reference;
  const archivePath = getArchiveReadPath(reference.path);
  if (archivePath === reference.path) return reference;
  const archived = sdk.collection(reference.firestore, archivePath);
  return reference.converter
    ? archived.withConverter(reference.converter)
    : archived;
}) as typeof sdk.collection;

// A collection-group query can cross semester boundaries; no archive screen
// needs this API. Fail closed instead of accidentally mixing current records.
export const collectionGroup: typeof sdk.collectionGroup = (firestore, id) => {
  if (isSemesterArchive) {
    throw new Error(
      "이전 학기 조회에서는 전체 학기를 통합 조회할 수 없습니다.",
    );
  }
  return sdk.collectionGroup(firestore, id);
};
