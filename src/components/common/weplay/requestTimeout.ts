/** Stop waiting without replaying a possibly successful server mutation. */
export async function withWeplayRequestTimeout<T>(
  request: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(
                new Error(
                  "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
                ),
                { code: "deadline-exceeded" },
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
