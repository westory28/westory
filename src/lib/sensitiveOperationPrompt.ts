type StartReauthentication = () => Promise<void>;
type ReauthenticationPrompt = (start: StartReauthentication) => Promise<void>;

let prompt: ReauthenticationPrompt | null = null;
const pending = new Set<(reason: Error) => void>();

export const cancelledReauthentication = () =>
  Object.assign(new Error("재인증을 취소했습니다."), {
    code: "auth/reauthentication-cancelled",
  });

export const registerSensitiveOperationPrompt = (
  next: ReauthenticationPrompt,
) => {
  prompt = next;
  return () => {
    if (prompt !== next) return;
    prompt = null;
    for (const reject of pending) reject(cancelledReauthentication());
    pending.clear();
  };
};

export const requestSensitiveReauthentication = (
  start: StartReauthentication,
): Promise<void> => {
  if (!prompt)
    return Promise.reject(
      new Error("화면을 새로고침한 뒤 다시 시도해 주세요."),
    );
  const present = prompt;
  return new Promise<void>((resolve, reject) => {
    let active = true;
    const cancel = (error: Error) => {
      active = false;
      reject(error);
    };
    pending.add(cancel);
    void present(() => {
      if (!active) return Promise.reject(cancelledReauthentication());
      return start();
    })
      .then(resolve, reject)
      .finally(() => {
        active = false;
        pending.delete(cancel);
      });
  });
};
