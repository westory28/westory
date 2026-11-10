// A timed-out read must release its UI/cache slot. The underlying SDK request
// may finish later; callers must apply values only from this bounded promise.
export const withRequestDeadline = <T>(
  request: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(message), {
            code: "functions/deadline-exceeded",
          }),
        ),
      timeoutMs,
    );
    request.then(resolve, reject).finally(() => clearTimeout(timer));
  });
