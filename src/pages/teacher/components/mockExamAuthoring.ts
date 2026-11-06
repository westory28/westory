import {
  normalizeMockExamRound,
  MOCK_EXAM_ROUNDS,
} from "../../../lib/mockExamRounds";
import type { QuizQuestionDraft } from "./QuizEditor";

export const MOCK_EXAM_FILE_VERSION = 1;
const collator = new Intl.Collator("ko");

/** Keep the option text, image and source index together; answers use the text. */
export const sortMockExamChoices = <T extends { text: string }>(
  items: T[],
): T[] =>
  [...items].sort(
    (a, b) =>
      Array.from(a.text.trim()).length - Array.from(b.text.trim()).length ||
      collator.compare(a.text.trim(), b.text.trim()),
  );

export const validateMockExamPlacement = (value: {
  examRound?: string;
  paperOrder?: number;
  points?: number;
}) => {
  if (!MOCK_EXAM_ROUNDS.includes(value.examRound || ""))
    return "초시·복시·전시 중 회차를 선택해 주세요.";
  if (
    !Number.isInteger(value.paperOrder) ||
    Number(value.paperOrder) < 1 ||
    Number(value.paperOrder) > 200
  )
    return "문항 번호는 1~200의 정수로 입력해 주세요.";
  if (
    !Number.isFinite(value.points) ||
    Number(value.points) < 0.01 ||
    Number(value.points) > 100
  )
    return "배점은 0보다 크고 100 이하인 수로 입력해 주세요.";
  if (
    Math.abs(
      Number(value.points) * 100 - Math.round(Number(value.points) * 100),
    ) > 0.00000001
  )
    return "배점은 소수 둘째 자리까지만 입력해 주세요.";
  return "";
};

export const mockExamQuestionSizeError = (question: object) =>
  new TextEncoder().encode(JSON.stringify(question)).byteLength > 92 * 1024
    ? "문항과 이미지 용량이 너무 큽니다. 이미지를 줄이거나 HTTPS 이미지 주소를 사용해 주세요."
    : "";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("문항 객체가 필요합니다.");
  return value as Record<string, unknown>;
};
const textField = (value: unknown, label: string, max = 12000) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label} 형식이나 길이를 확인해 주세요.`);
  return value.trim();
};
const imageField = (value: unknown) => {
  const text = textField(value, "이미지", 500000);
  if (/^https:\/\//i.test(text) && text.length <= 2048) {
    try {
      if (new URL(text).protocol === "https:") return text;
    } catch {
      /* Report below. */
    }
  }
  if (
    text &&
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(text)
  )
    throw new Error(
      "이미지는 HTTPS 주소 또는 PNG·JPEG·WebP data URL을 사용해 주세요.",
    );
  return text || null;
};

export const parseMockExamFile = (raw: string): QuizQuestionDraft[] => {
  if (raw.length > 6000000)
    throw new Error("시험지 JSON은 6MB 이하로 준비해 주세요.");
  const file = record(JSON.parse(raw));
  if (
    file.version !== MOCK_EXAM_FILE_VERSION ||
    !Array.isArray(file.questions) ||
    !file.questions.length ||
    file.questions.length > 200
  )
    throw new Error("version: 1과 1~200개의 questions가 필요합니다.");
  const ids = new Set<number>();
  const positions = new Set<string>();
  const questions = file.questions.map((input, index) => {
    try {
      const q = record(input);
      if (
        typeof q.id !== "number" ||
        typeof q.paperOrder !== "number" ||
        typeof q.points !== "number"
      )
        throw new Error("id·paperOrder·points는 숫자로 입력해 주세요.");
      const id = Number(q.id);
      if (!Number.isSafeInteger(id) || id < 1 || ids.has(id))
        throw new Error("고유한 양의 정수 id가 필요합니다.");
      ids.add(id);
      if (!MOCK_EXAM_ROUNDS.includes(String(q.examRound)))
        throw new Error(
          "examRound는 round_1·round_2·round_3 중 하나여야 합니다.",
        );
      const examRound = normalizeMockExamRound(q.examRound, "");
      const paperOrder = Number(q.paperOrder);
      const points = Number(q.points);
      const placementError = validateMockExamPlacement({
        examRound,
        paperOrder,
        points,
      });
      if (placementError) throw new Error(placementError);
      const position = `${examRound}:${paperOrder}`;
      if (positions.has(position))
        throw new Error("같은 회차의 문항 번호가 중복됩니다.");
      positions.add(position);
      if (q.type !== "choice" && q.type !== "word")
        throw new Error("type은 choice(객관식) 또는 word(단답형)여야 합니다.");
      const question = textField(q.question, "발문");
      const answer = textField(q.answer, "정답", 2000);
      if (!question || !answer) throw new Error("발문과 정답을 입력해 주세요.");
      const options =
        q.type === "choice" && Array.isArray(q.options)
          ? q.options.map((value) => textField(value, "선지", 2000))
          : [];
      if (
        q.type === "choice" &&
        (options.length !== 5 ||
          options.some((value) => !value) ||
          new Set(options).size !== 5 ||
          !options.includes(answer))
      )
        throw new Error(
          "서로 다른 선지 5개와 선지 원문과 일치하는 정답이 필요합니다.",
        );
      if (q.type === "word" && answer.length > 20)
        throw new Error("단답형 정답은 20자 이하여야 합니다.");
      if (
        q.choiceOptionImages !== undefined &&
        (!Array.isArray(q.choiceOptionImages) ||
          q.choiceOptionImages.length !== options.length)
      )
        throw new Error("선지 이미지 수는 선지 수와 같아야 합니다.");
      const images = Array.isArray(q.choiceOptionImages)
        ? q.choiceOptionImages.map(imageField)
        : options.map(() => null);
      const ordered = sortMockExamChoices(
        options.map((text, i) => ({ text, image: images[i] })),
      );
      if (
        q.paperBreakBefore !== undefined &&
        typeof q.paperBreakBefore !== "boolean"
      )
        throw new Error("paperBreakBefore는 true 또는 false여야 합니다.");
      const concepts =
        q.concepts === undefined
          ? []
          : Array.isArray(q.concepts)
            ? q.concepts.map((value) => textField(value, "핵심 개념", 60))
            : null;
      if (!concepts || concepts.length > 8 || concepts.some((value) => !value))
        throw new Error("핵심 개념은 60자 이내, 최대 8개입니다.");
      const misconceptionTags =
        q.misconceptionTags === undefined ? {} : record(q.misconceptionTags);
      if (
        Object.keys(misconceptionTags).length > 10 ||
        Object.keys(misconceptionTags).some(
          (key) => !options.includes(key) || key.length > 500,
        )
      )
        throw new Error("혼동 지점의 키는 선지 원문과 같아야 합니다.");
      return {
        id,
        unitId: "exam_prep",
        category: "exam_prep",
        type: q.type as "choice" | "word",
        examRound,
        paperOrder,
        points,
        paperBreakBefore: q.paperBreakBefore === true,
        question,
        answer,
        options: ordered.map((item) => item.text),
        choiceOptionImages: ordered.map((item) => item.image),
        passage: textField(q.passage, "자료"),
        explanation: textField(q.explanation, "해설"),
        image: imageField(q.image),
        refBig: textField(q.refBig, "대단원", 200),
        refMid: textField(q.refMid, "중단원", 200),
        refSmall: textField(q.refSmall, "소단원", 200),
        subUnitId:
          textField(q.refSmall || q.refMid || q.refBig, "관련 단원", 200) ||
          null,
        concepts,
        cognitiveProcess: textField(q.cognitiveProcess, "사고 과정", 60),
        familyId: textField(q.familyId, "문항 계열 ID", 200) || String(id),
        derivedFromQuestionId: textField(
          q.derivedFromQuestionId,
          "원본 문항 ID",
          200,
        ),
        reviewLessonId: textField(q.reviewLessonId, "다시 볼 자료 ID", 200),
        misconceptionTags: Object.fromEntries(
          Object.entries(misconceptionTags).map(([key, value]) => [
            key,
            textField(value, "혼동 지점", 120),
          ]),
        ),
        hintEnabled: false,
        hint: "",
      };
    } catch (error) {
      throw new Error(
        `${index + 1}번째 문항: ${error instanceof Error ? error.message : "형식을 확인해 주세요."}`,
      );
    }
  });
  const roundSizes = new Map<string, number>();
  questions.forEach((question, index) => {
    const error = mockExamQuestionSizeError(question);
    if (error) throw new Error(`${index + 1}번째 문항: ${error}`);
    roundSizes.set(
      question.examRound,
      (roundSizes.get(question.examRound) || 0) +
        new TextEncoder().encode(JSON.stringify(question)).byteLength,
    );
  });
  if ([...roundSizes.values()].some((bytes) => bytes > 480 * 1024))
    throw new Error(
      "회차별 시험지 용량이 너무 큽니다. 이미지를 줄이거나 HTTPS 이미지 주소를 사용해 주세요.",
    );
  return questions;
};

export const createMockExamFile = (questions: QuizQuestionDraft[]) =>
  JSON.stringify(
    {
      version: MOCK_EXAM_FILE_VERSION,
      questions: questions.map(
        ({
          id,
          type,
          question,
          answer,
          options,
          choiceOptionImages,
          passage,
          explanation,
          image,
          examRound,
          paperOrder,
          points,
          paperBreakBefore,
          refBig,
          refMid,
          refSmall,
          concepts,
          cognitiveProcess,
          familyId,
          derivedFromQuestionId,
          reviewLessonId,
          misconceptionTags,
        }) => ({
          id,
          type,
          question,
          answer,
          options,
          choiceOptionImages,
          passage,
          explanation,
          image,
          examRound,
          paperOrder,
          points,
          paperBreakBefore,
          refBig,
          refMid,
          refSmall,
          concepts,
          cognitiveProcess,
          familyId,
          derivedFromQuestionId,
          reviewLessonId,
          misconceptionTags,
        }),
      ),
    },
    null,
    2,
  );

export const MOCK_EXAM_FILE_EXAMPLE: QuizQuestionDraft[] = [
  {
    id: 202611060001,
    unitId: "exam_prep",
    category: "exam_prep",
    type: "choice",
    examRound: "round_1",
    paperOrder: 1,
    points: 4,
    question: "다음 설명에 해당하는 문화유산은?",
    passage: "신라의 첨성대는 천체를 관측하기 위해 세운 시설이다.",
    options: ["첨성대", "불국사", "석굴암", "팔만대장경", "무령왕릉"],
    answer: "첨성대",
    explanation: "발문·자료·선지·정답·해설을 실제 출제 내용으로 수정하세요.",
  },
];
