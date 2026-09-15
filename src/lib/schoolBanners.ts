import { auth, getHttpsCallable } from "./firebase";
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";
import type { VisibleNotice } from "./visibleSchedule";

export interface SchoolBannerRecord extends VisibleNotice {
  revision: number;
}

export interface SchoolBannerFields {
  publishAt?: string | null;
  expiresAt?: string | null;
  category?: string;
  targetType?: string;
  targetClass?: string | null;
  targetDate?: string | null;
  developerLogPostId?: string | null;
}

export const bannerTimestamp = (value: unknown): number => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: unknown }).toMillis === "function")
    return (value as { toMillis: () => number }).toMillis();
  if (typeof value === "object" && "seconds" in value)
    return Number((value as { seconds: number }).seconds) * 1000;
  const time = new Date(value as string | number).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const bannerDateTimeInput = (value: unknown): string => {
  const time = bannerTimestamp(value);
  return time
    ? new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
};

export const bannerDateTimeIso = (value: string): string | null => {
  if (!value) return null;
  const time = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(time.getTime()))
    throw new Error("게시 일시를 확인해 주세요.");
  return time.toISOString();
};

export const schoolBannerStatus = (
  banner: Pick<VisibleNotice, "publishAt" | "expiresAt">,
  now = Date.now(),
) => {
  if (
    bannerTimestamp(banner.expiresAt) &&
    bannerTimestamp(banner.expiresAt) <= now
  )
    return "게시 종료";
  if (bannerTimestamp(banner.publishAt) > now) return "예약 게시";
  return "게시 중";
};

export const loadSchoolBanners = async (
  config: SystemConfig | null,
): Promise<SchoolBannerRecord[]> => {
  const snapshot = await getDocs(
    collection(db, getSemesterCollectionPath(config, "notices")),
  );
  return snapshot.docs
    .map(
      (item) =>
        ({
          ...item.data(),
          id: item.id,
          revision: Number(item.data().revision || 0),
        }) as SchoolBannerRecord,
    )
    .filter((item) => Boolean(item.imageUrl))
    .sort((a, b) => {
      const order = (item: SchoolBannerRecord) =>
        Number.isFinite(Number(item.noticeOrder))
          ? Number(item.noticeOrder)
          : -bannerTimestamp(item.createdAt);
      return order(a) - order(b) || a.id.localeCompare(b.id);
    });
};

export interface SchoolBannerResult {
  noticeId: string;
  imageUrl: string;
  imageStoragePath: string;
  imageWidth: number;
  imageHeight: number;
  imageByteSize: number;
  imageMimeType: string;
  replayed: boolean;
  revision?: number;
}

export const registerSchoolBanner = async (
  input: SchoolBannerFields & {
    semesterId: string;
    requestId: string;
    title: string;
    image?: Blob | null;
    noticeId?: string;
    expectedRevision?: number;
  },
  expectedUid: string,
): Promise<SchoolBannerResult> => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 새로고침해 주세요.");
  const bytes = input.image
    ? new Uint8Array(await input.image.arrayBuffer())
    : new Uint8Array();
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  const { image: _image, ...fields } = input;
  const payload = {
    ...fields,
    title: input.title.trim(),
    ...(input.image ? { contentBase64: btoa(binary) } : {}),
  };
  const register = await getHttpsCallable<typeof payload, SchoolBannerResult>(
    "registerSchoolBanner",
    { expectedUid },
  );
  try {
    return (await register(payload)).data;
  } catch (error) {
    const code = String((error as { code?: string })?.code || "");
    // The same request ID makes a lost acknowledgement safe to retry.
    if (!/unavailable|deadline-exceeded|internal/.test(code)) throw error;
    return (await register(payload)).data;
  }
};

export type SchoolBannerManagementInput = {
  semesterId: string;
  requestId: string;
} & (
  | { action: "REORDER"; items: { id: string; revision: number }[] }
  | { action: "DELETE"; noticeId: string; expectedRevision: number }
);

export const manageSchoolBanners = async (
  input: SchoolBannerManagementInput,
  expectedUid: string,
): Promise<void> => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 새로고침해 주세요.");
  const manage = await getHttpsCallable<SchoolBannerManagementInput, unknown>(
    "manageSchoolBanners",
    { expectedUid },
  );
  try {
    await manage(input);
  } catch (error) {
    if (
      !/unavailable|deadline-exceeded|internal/.test(
        String((error as { code?: string })?.code || ""),
      )
    )
      throw error;
    await manage(input);
  }
};
