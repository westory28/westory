import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import { auth } from "./firebase";
import { ensureWestoryAppCheck } from "./appCheck";
import {
  ensureHistoryDictionarySession,
  getHistoryDictionaryCallable,
} from "./historyDictionarySession";

// A step-up only prepares credentials. The existing callable still verifies
// actor permissions, a current high-risk session, App Check and revisions.
export const ensureSensitiveOperation = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 다시 시도해 주세요.");
  const assertOwner = () => {
    if (auth.currentUser !== user)
      throw new Error("로그인 계정이 바뀌었습니다. 다시 확인해 주세요.");
  };
  const token = await user.getIdTokenResult();
  assertOwner();
  const age = Date.now() - Number(token.claims.auth_time) * 1000;
  await ensureWestoryAppCheck();
  assertOwner();
  if (!Number.isFinite(age) || age < -60000 || age > 240000) {
    // Keep authenticated listeners authorized while auth_time rolls over.
    // A revoked/expired application session cannot use this transition.
    const begin = await getHistoryDictionaryCallable(
      "beginApplicationSessionReauthentication",
    );
    await begin({});
    assertOwner();
    const provider = new GoogleAuthProvider();
    if (user.email) provider.setCustomParameters({ login_hint: user.email });
    const result = await reauthenticateWithPopup(user, provider);
    assertOwner();
    if (result.user.uid !== user.uid)
      throw new Error("같은 계정으로 인증해 주세요.");
    await user.getIdToken(true);
    assertOwner();
    await ensureHistoryDictionarySession();
    assertOwner();
  }
};
