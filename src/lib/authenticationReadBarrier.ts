// A reauthentication attempt temporarily pauses Firestore. Auth token events
// must not start server reads until that attempt has restored the transport.
const pending = new Set<Promise<void>>();

export const holdAuthenticationReads = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  pending.add(promise);
  return () => {
    pending.delete(promise);
    release();
  };
};

export const waitForAuthenticationReads = async () => {
  while (pending.size > 0) await Promise.all([...pending]);
};
