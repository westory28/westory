import { auth } from "../../lib/firebase";
import { getHistoryDictionaryCallable } from "../../lib/historyDictionarySession";
import { notifyPointsUpdated } from "../../lib/appEvents";
import { getStudentWisState } from "../../lib/studentWis";
import { getYearSemester } from "../../lib/semesterScope";
import type { SystemConfig } from "../../types";
import type { AvatarLook, AvatarState } from "./catalog";
import { notifyAvatarUpdated } from "./events";

type Scope = Pick<SystemConfig, "year" | "semester">;
export interface AvatarPurchaseResult {
  itemId: string;
  charged: number;
  alreadyOwned: boolean;
  duplicate: boolean;
  avatar: AvatarState;
  wallet: {
    balance: number;
    earnedTotal: number;
    rankEarnedTotal: number;
    spentTotal: number;
    revision: number;
  };
}
const inFlight = new Map<string, Promise<AvatarState>>();
const requestIds = new Map<string, string>();
const requestIdFor = (key: string) => {
  if (requestIds.has(key)) return requestIds.get(key)!;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(`westory:avatar-request:${key}`);
  } catch {
    /* Memory fallback. */
  }
  const id =
    stored && /^[a-zA-Z0-9-]{16,80}$/.test(stored)
      ? stored
      : crypto.randomUUID();
  requestIds.set(key, id);
  try {
    sessionStorage.setItem(`westory:avatar-request:${key}`, id);
  } catch {
    /* Memory fallback. */
  }
  return id;
};
const clearRequest = (key: string) => {
  requestIds.delete(key);
  try {
    sessionStorage.removeItem(`westory:avatar-request:${key}`);
  } catch {
    /* Optional storage. */
  }
};
const retryableFailure = (error: unknown) =>
  /unavailable|deadline-exceeded|internal|network|fetch/i.test(
    String(
      (error as { code?: string; message?: string })?.code ||
        (error as Error)?.message ||
        "",
    ),
  );
const service = async <T>(name: string, payload: Record<string, unknown>) => {
  const owner = auth.currentUser;
  if (!owner) throw new Error("다시 로그인한 뒤 이용해 주세요.");
  const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== owner || !Number.isFinite(epoch))
    throw new Error("로그인 계정이 바뀌었습니다. 다시 열어 주세요.");
  const call = await getHistoryDictionaryCallable<Record<string, unknown>, T>(
    name,
  );
  if (auth.currentUser !== owner)
    throw new Error("로그인 계정이 바뀌었습니다. 다시 열어 주세요.");
  const result = await call(payload);
  if (
    auth.currentUser !== owner ||
    Number((await owner.getIdTokenResult()).claims.auth_time) !== epoch
  )
    throw new Error("로그인 계정이 바뀌었습니다. 다시 열어 주세요.");
  return result.data;
};
export const avatarErrorMessage = (error: unknown) => {
  const e = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  const reason = `${e.details?.reason || ""} ${e.code || ""}`;
  if (/INSUFFICIENT/.test(reason))
    return "위스가 부족합니다. 지갑 잔액을 확인해 주세요.";
  if (/REVISION|aborted/.test(reason))
    return "다른 변경이 먼저 저장되었습니다. 새로고침 후 다시 선택해 주세요.";
  if (/OWNED|OWNERSHIP/.test(reason))
    return "아직 보유하지 않은 아이템이 있습니다. 구매 후 저장해 주세요.";
  if (/resource-exhausted|RATE_LIMIT/.test(reason))
    return "잠시 후 다시 저장해 주세요.";
  if (/SESSION|unauthenticated/.test(reason))
    return "로그인 상태를 다시 확인해 주세요.";
  if (/permission-denied/.test(reason))
    return "현재 계정의 아바타 이용 권한을 확인해 주세요.";
  return "처리를 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
};
export const getStudentAvatar = async (): Promise<AvatarState> => {
  const user = auth.currentUser;
  if (!user) throw new Error("다시 로그인해 주세요.");
  const epoch = Number((await user.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== user || !Number.isFinite(epoch))
    throw new Error("로그인 계정이 바뀌었습니다.");
  const key = `${user.uid}:${epoch}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = service<AvatarState>("getStudentAvatar", {}).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
};
export const purchaseAvatarItem = async (config: Scope, itemId: string) => {
  const { year, semester } = getYearSemester(config);
  const key = `${auth.currentUser?.uid}:${year}:${semester}:${itemId}`;
  try {
    const result = await service<AvatarPurchaseResult>(
      "purchaseStudentAvatarItem",
      {
        year,
        semester,
        itemId,
        requestId: requestIdFor(key),
      },
    );
    clearRequest(key);
    notifyPointsUpdated();
    // The receipt may predate a later purchase in another tab.
    if (result.duplicate) {
      const [avatar, current] = await Promise.all([
        getStudentAvatar(),
        getStudentWisState(config, "student-core", auth.currentUser?.uid, {
          includeLedger: false,
        }),
      ]);
      result.avatar = avatar;
      if (current.account)
        result.wallet = {
          ...result.wallet,
          balance: current.account.balance,
          earnedTotal: current.account.earnedTotal,
          rankEarnedTotal: current.account.rankEarnedTotal,
          spentTotal: current.account.spentTotal,
          revision: current.account.revision,
        };
    }
    return result;
  } catch (error) {
    if (!retryableFailure(error)) clearRequest(key);
    throw error;
  }
};
export const saveStudentAvatar = async (
  look: AvatarLook,
  expectedRevision: number,
  thumbnailWebp: string,
) => {
  // Stable across retries; a changed look gets a separate receipt.
  const bytes = new TextEncoder().encode(JSON.stringify([look, thumbnailWebp]));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const key = `${auth.currentUser?.uid}:save:${expectedRevision}:${hash}`;
  try {
    const result = await service<AvatarState & { duplicate?: boolean }>(
      "saveStudentAvatar",
      {
        look,
        expectedRevision,
        thumbnailWebp,
        requestId: requestIdFor(key),
      },
    );
    clearRequest(key);
    notifyAvatarUpdated();
    return result.duplicate ? await getStudentAvatar() : result;
  } catch (error) {
    if (!retryableFailure(error)) clearRequest(key);
    throw error;
  }
};

export const makeAvatarThumbnail = async (dataUrl: string): Promise<string> => {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("미리보기를 만들지 못했습니다.");
    // Preserve the renderer's alpha so the saved avatar can stand on a podium.
    const scale = Math.min(384 / bitmap.width, 512 / bitmap.height);
    const w = bitmap.width * scale,
      h = bitmap.height * scale;
    ctx.drawImage(bitmap, (384 - w) / 2, (512 - h) / 2, w, h);
    for (const quality of [0.82, 0.68, 0.5]) {
      const webp = canvas.toDataURL("image/webp", quality);
      if (webp.startsWith("data:image/webp;base64,") && webp.length < 86_000)
        return webp;
    }
    throw new Error("미리보기의 용량이 너무 큽니다. 다시 시도해 주세요.");
  } finally {
    bitmap.close();
  }
};
