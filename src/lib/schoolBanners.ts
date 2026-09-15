import { auth, getHttpsCallable } from "./firebase";

export interface SchoolBannerResult {
  noticeId: string;
  imageUrl: string;
  imageStoragePath: string;
  imageWidth: number;
  imageHeight: number;
  imageByteSize: number;
  imageMimeType: string;
  replayed: boolean;
}

export const registerSchoolBanner = async (
  input: { semesterId: string; requestId: string; title: string; image: Blob },
  expectedUid: string,
): Promise<SchoolBannerResult> => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 새로고침해 주세요.");
  const bytes = new Uint8Array(await input.image.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  const payload = {
    semesterId: input.semesterId,
    requestId: input.requestId,
    title: input.title.trim(),
    contentBase64: btoa(binary),
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
