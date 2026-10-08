import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";
import { ensureWestoryAppCheck } from "./appCheck";
import {
  ensureHistoryDictionarySession,
  getHistoryDictionaryCallable,
} from "./historyDictionarySession";
import { requestSensitiveReauthentication } from "./sensitiveOperationPrompt";

const flights = new WeakMap<User, Promise<void>>();

// A step-up only prepares credentials. The existing callable still verifies
// actor permissions, a current high-risk session, App Check and revisions.
const prepareSensitiveOperation = async (user: User) => {
  const assertOwner = () => {
    if (auth.currentUser !== user)
      throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
  };
  const readEpoch = async () => {
    const token = await user.getIdTokenResult();
    assertOwner();
    const epoch = Number(token.claims.auth_time);
    if (!Number.isSafeInteger(epoch) || epoch <= 0)
      throw new Error(
        "로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.",
      );
    return epoch;
  };
  const epoch = await readEpoch();
  await ensureWestoryAppCheck();
  if ((await readEpoch()) !== epoch)
    throw new Error("로그인 상태가 바뀌었습니다. 다시 확인해 주세요.");
  const age = Date.now() - epoch * 1000;
  if (!Number.isFinite(age) || age < -60000 || age > 240000) {
    // Keep authenticated listeners authorized while auth_time rolls over.
    // A revoked/expired application session cannot use this transition.
    const begin = await getHistoryDictionaryCallable<
      Record<string, never>,
      { expiresAt: number }
    >("beginApplicationSessionReauthentication");
    const transition = await begin({});
    if ((await readEpoch()) !== epoch)
      throw new Error("로그인 상태가 바뀌었습니다. 다시 확인해 주세요.");
    const expiresAt = transition.data.expiresAt;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error("재인증 준비 시간이 지났습니다. 다시 시도해 주세요.");
    const provider = new GoogleAuthProvider();
    if (user.email) provider.setCustomParameters({ login_hint: user.email });
    await requestSensitiveReauthentication(() => {
      assertOwner();
      if (Date.now() >= expiresAt)
        throw new Error("재인증 준비 시간이 지났습니다. 다시 시도해 주세요.");
      return reauthenticateWithPopup(user, provider).then((result) => {
        assertOwner();
        if (result.user.uid !== user.uid)
          throw new Error("같은 계정으로 인증해 주세요.");
      });
    });
    assertOwner();
    await user.getIdToken(true);
    const renewedEpoch = await readEpoch();
    const renewedAge = Date.now() - renewedEpoch * 1000;
    if (renewedEpoch <= epoch || renewedAge < -60000 || renewedAge > 240000)
      throw new Error("재인증을 확인하지 못했습니다. 다시 로그인해 주세요.");
    await ensureHistoryDictionarySession();
    if ((await readEpoch()) !== renewedEpoch)
      throw new Error("로그인 상태가 바뀌었습니다. 다시 확인해 주세요.");
  }
};

export const ensureSensitiveOperation = (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return Promise.reject(new Error("로그인 후 다시 시도해 주세요."));
  const current = flights.get(user);
  if (current) return current;
  const flight = prepareSensitiveOperation(user).finally(() => {
    if (flights.get(user) === flight) flights.delete(user);
  });
  flights.set(user, flight);
  return flight;
};
