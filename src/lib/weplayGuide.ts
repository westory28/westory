import { auth, getHttpsCallable } from "./firebase";

export interface WeplayGuideCompletion {
  uid: string;
  guideCompleted: true;
}

interface GuideProfile {
  uid: string;
  weplayGuideCompleted?: unknown;
}

// AuthContext already subscribes to this profile. null means unknown, not unseen.
export function getWeplayGuideStatus(
  uid: string | null | undefined,
  profile: GuideProfile | null | undefined,
): boolean | null {
  if (!uid || !profile || profile.uid !== uid) return null;
  return profile.weplayGuideCompleted === true;
}

const pending = new Map<string, Promise<WeplayGuideCompletion>>();
const assertCurrentAccount = (expectedUid: string) => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 계정이 변경되었습니다. 다시 확인해 주세요.");
};

// Only an acknowledged server write counts as completed. Failures stay retryable.
export function completeWeplayGuide(
  expectedUid: string,
): Promise<WeplayGuideCompletion> {
  try {
    assertCurrentAccount(expectedUid);
  } catch (error) {
    return Promise.reject(error);
  }
  const existing = pending.get(expectedUid);
  if (existing) return existing;
  const request = (async () => {
    const call = await getHttpsCallable<
      { accountUid: string },
      WeplayGuideCompletion
    >("completeWeplayGuide");
    assertCurrentAccount(expectedUid);
    const result = (await call({ accountUid: expectedUid })).data;
    assertCurrentAccount(expectedUid);
    if (result.uid !== expectedUid || result.guideCompleted !== true)
      throw new Error(
        "안내 완료 기록을 확인하지 못했습니다. 다시 시도해 주세요.",
      );
    return result;
  })();
  const tracked = request.finally(() => {
    if (pending.get(expectedUid) === tracked) pending.delete(expectedUid);
  });
  pending.set(expectedUid, tracked);
  return tracked;
}
