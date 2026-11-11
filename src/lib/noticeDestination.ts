import { isMockExamRound, normalizeMockExamRound } from "./mockExamRounds";

// Only known in-app destinations are accepted; notice data is never a raw URL.
export const getNoticeDestination = (
  notice:
    | {
        mockExamRound?: string;
        developerLogPostId?: string;
      }
    | null
    | undefined,
) => {
  if (isMockExamRound(notice?.mockExamRound)) {
    return {
      path: `/student/quiz?tab=mock&round=${encodeURIComponent(normalizeMockExamRound(notice!.mockExamRound))}`,
      label: "모의고사 응시 화면 열기",
    };
  }
  const postId = String(notice?.developerLogPostId || "").trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(postId)
    ? { path: `/developer-log/${postId}`, label: "연결된 개발자 일지 열기" }
    : null;
};
