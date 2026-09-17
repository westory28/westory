// Keep upload pressure bounded while allowing independent files to transfer
// and verify together. Drain started work before allowing a failed save retry.
export const runLessonAssetBatch = async <T>(
  uploads: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> => {
  const results: T[] = new Array(uploads.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && nextIndex < uploads.length) {
      const index = nextIndex++;
      try {
        results[index] = await uploads[index]();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, uploads.length) }, worker),
  );
  if (failed) throw failure;
  return results;
};
