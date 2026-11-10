/** Synthetic draft content only. Never replace this with student records. */
export const PREVIEW_STUDENT = "preview-student-a";

export const DRAFT_SOURCES = [
  {
    id: "lesson",
    label: "수업자료",
    title: "조선 전기의 대외 관계",
    detail: "학습지 · 지도와 본문",
    flow: "학습지에서 질문 → 해당 단원·쪽수 연결",
    restriction: "공개된 자료와 쪽수만 연결합니다.",
  },
  {
    id: "mock",
    label: "모의고사",
    title: "모의고사 1회 · 7번",
    detail: "모의고사 · 오답 노트",
    flow: "오답 노트 → 이 문항 질문하기 → 개별 답변",
    restriction:
      "제출한 모의고사의 오답 노트에서만 질문합니다. 시험 중에는 질문을 받지 않습니다.",
  },
  {
    id: "formative",
    label: "형성평가",
    title: "조선 전기의 대외 관계 · 3번",
    detail: "형성평가 · 복습 문항",
    flow: "제출·해설 공개 → 개념 확인 → 보충 자료",
    restriction: "문항 버전과 공개 여부를 확인한 뒤 연결합니다.",
  },
  {
    id: "diagnostic",
    label: "진단평가",
    title: "조선 전기의 대외 관계 · 2번",
    detail: "진단평가 · 복습 문항",
    flow: "제출·해설 공개 → 질문 → 기초 개념 복습",
    restriction: "진단 결과·수준은 본인과 담당 교사만 확인합니다.",
  },
  {
    id: "dictionary",
    label: "역사 사전",
    title: "교린",
    detail: "역사 사전 · 개념 풀이",
    flow: "용어 확인 → 관련 질문 → 수업자료로 복귀",
    restriction: "공개 가능한 용어·자료만 연결합니다.",
  },
] as const;

export type DraftSourceId = (typeof DRAFT_SOURCES)[number]["id"];
export interface DraftQuestion {
  id: string;
  studentId: string;
  studentLabel: string;
  profileEmojiId?: string;
  source: DraftSourceId;
  origin?: "wrong-note";
  question: string;
  reply: string;
  publicQuestion: string;
  publicReply: string;
  related: DraftSourceId[];
}

/** Public stories deliberately have no owner, class, score, or original question ID. */
export interface DraftStory {
  id: string;
  question: string;
  answer: string;
  related: DraftSourceId[];
}

export const createDraftQuestions = (): DraftQuestion[] => [
  {
    id: "example-1",
    studentId: PREVIEW_STUDENT,
    studentLabel: "예시 학생 A",
    source: "lesson",
    question:
      "4군 6진의 위치가 자꾸 헷갈려요. 지도에서 어떻게 구분하면 좋을까요?",
    reply:
      "학습지 지도에서 압록강과 두만강을 먼저 찾아보세요. 두 강을 기준으로 4군과 6진의 위치를 각각 표시한 뒤, 지도 아래 설명과 연결해 보세요.",
    publicQuestion: "4군 6진, 지도에서 어떻게 구분할까요?",
    publicReply:
      "압록강과 두만강을 먼저 찾아보세요. 두 강을 기준으로 4군과 6진의 위치를 각각 표시하면 구분하기 쉽습니다. 학습지의 지도와 설명을 함께 확인해 보세요.",
    related: ["lesson", "dictionary"],
  },
  {
    id: "example-2",
    studentId: "preview-student-b",
    studentLabel: "예시 학생 B",
    profileEmojiId: "book",
    source: "mock",
    origin: "wrong-note",
    question:
      "7번에서 교린 관계를 묻는다는 건 알겠는데, 자료의 어떤 부분을 봐야 하나요?",
    reply:
      "자료에서 교류 상대와 교류 방식을 나타내는 말을 찾아보세요. 역사 사전의 ‘교린’을 읽고 수업자료의 대외 관계와 비교해 보세요.",
    publicQuestion: "자료에서 교린 관계의 단서를 찾으려면?",
    publicReply:
      "교류 상대와 교류 방식을 나타내는 말에 표시해 보세요. ‘교린’의 뜻을 확인하고 수업자료의 대외 관계와 비교하면 자료의 맥락을 읽을 수 있습니다.",
    related: ["dictionary", "lesson"],
  },
  {
    id: "example-3",
    studentId: PREVIEW_STUDENT,
    studentLabel: "예시 학생 A",
    source: "formative",
    question: "조선 전기의 주변 나라와의 관계를 어떻게 비교하면 좋을까요?",
    reply: "",
    publicQuestion: "",
    publicReply: "",
    related: ["lesson"],
  },
  {
    id: "example-4",
    studentId: "preview-student-c",
    studentLabel: "예시 학생 C",
    profileEmojiId: "soft_smile",
    source: "diagnostic",
    question: "교린이라는 말이 낯설어요. 어떤 뜻인지부터 알고 싶어요.",
    reply: "",
    publicQuestion: "",
    publicReply: "",
    related: ["dictionary"],
  },
];

export const createDraftStories = (): DraftStory[] =>
  createDraftQuestions()
    .slice(0, 2)
    .map((item, index) => ({
      id: `story-${index + 1}`,
      question: item.publicQuestion,
      answer: item.publicReply,
      related: [...item.related],
    }));

export const sourceById = (id: DraftSourceId) =>
  DRAFT_SOURCES.find((source) => source.id === id)!;
