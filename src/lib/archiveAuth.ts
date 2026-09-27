import * as sdk from "@firebase/auth";
import { assertArchiveWritable, isSemesterArchive } from "./semesterArchive";

export * from "@firebase/auth";

const writable = <T extends (...args: any[]) => any>(operation: T): T =>
  ((...args: Parameters<T>) => {
    assertArchiveWritable();
    return operation(...args);
  }) as T;

// The archive shares the signed-in user's existing read access. It must not
// change the account or the persisted session used by the operating window.
export const signOut = writable(sdk.signOut);
export const signInAnonymously = writable(sdk.signInAnonymously);
export const signInWithCredential = writable(sdk.signInWithCredential);
export const signInWithCustomToken = writable(sdk.signInWithCustomToken);
export const signInWithEmailAndPassword = writable(
  sdk.signInWithEmailAndPassword,
);
export const signInWithEmailLink = writable(sdk.signInWithEmailLink);
export const signInWithPhoneNumber = writable(sdk.signInWithPhoneNumber);
export const signInWithPopup = writable(sdk.signInWithPopup);
export const signInWithRedirect = writable(sdk.signInWithRedirect);
export const getRedirectResult = writable(sdk.getRedirectResult);
export const createUserWithEmailAndPassword = writable(
  sdk.createUserWithEmailAndPassword,
);
export const deleteUser = writable(sdk.deleteUser);
export const updateCurrentUser = writable(sdk.updateCurrentUser);
export const updateEmail = writable(sdk.updateEmail);
export const updatePassword = writable(sdk.updatePassword);
export const updatePhoneNumber = writable(sdk.updatePhoneNumber);
export const updateProfile = writable(sdk.updateProfile);
export const verifyBeforeUpdateEmail = writable(sdk.verifyBeforeUpdateEmail);
export const applyActionCode = writable(sdk.applyActionCode);
export const confirmPasswordReset = writable(sdk.confirmPasswordReset);
export const sendEmailVerification = writable(sdk.sendEmailVerification);
export const sendPasswordResetEmail = writable(sdk.sendPasswordResetEmail);
export const sendSignInLinkToEmail = writable(sdk.sendSignInLinkToEmail);
export const revokeAccessToken = writable(sdk.revokeAccessToken);
export const linkWithCredential = writable(sdk.linkWithCredential);
export const linkWithPhoneNumber = writable(sdk.linkWithPhoneNumber);
export const linkWithPopup = writable(sdk.linkWithPopup);
export const linkWithRedirect = writable(sdk.linkWithRedirect);
export const unlink = writable(sdk.unlink);
export const reauthenticateWithCredential = writable(
  sdk.reauthenticateWithCredential,
);
export const reauthenticateWithPhoneNumber = writable(
  sdk.reauthenticateWithPhoneNumber,
);
export const reauthenticateWithPopup = writable(sdk.reauthenticateWithPopup);
export const reauthenticateWithRedirect = writable(
  sdk.reauthenticateWithRedirect,
);

export const multiFactor: typeof sdk.multiFactor = (user) => {
  const factors = sdk.multiFactor(user);
  if (!isSemesterArchive) return factors;
  return new Proxy(factors, {
    get(target, key) {
      if (key === "enroll" || key === "unenroll") {
        return writable(target[key].bind(target));
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

export const getMultiFactorResolver: typeof sdk.getMultiFactorResolver = (
  auth,
  error,
) => {
  const resolver = sdk.getMultiFactorResolver(auth, error);
  if (!isSemesterArchive) return resolver;
  return new Proxy(resolver, {
    get(target, key) {
      if (key === "resolveSignIn") {
        return writable(target.resolveSignIn.bind(target));
      }
      return Reflect.get(target, key, target);
    },
  });
};
