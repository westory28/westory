/** Read-only retries: never wrap stock transfers, orders or reward commands. */
export function isStudentWisStockTransient(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  return /(?:^|\/)(unavailable|deadline-exceeded|aborted|network-request-failed)$/.test(
    code,
  );
}

export async function withStudentWisStockReadRetry<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    if (!isCurrent())
      throw new DOMException("화면이 변경되었습니다.", "AbortError");
    try {
      return await read();
    } catch (error) {
      if (
        attempt >= 2 ||
        !isStudentWisStockTransient(error) ||
        navigator.onLine === false
      )
        throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(
          () => {
            signal?.removeEventListener("abort", abort);
            resolve();
          },
          750 * 2 ** attempt,
        );
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
