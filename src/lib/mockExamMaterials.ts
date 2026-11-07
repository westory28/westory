/** Presentation only. Never store a hidden answer inside a passage blank. */
export interface MockExamPassageSet {
  id: string;
  instruction: string;
  passage: string;
  image?: string | null;
}

export interface MockExamMaterialQuestion {
  id: string | number;
  examRound?: string;
  paperOrder?: number;
  examplePassage?: string | null;
  passageSet?: MockExamPassageSet | null;
}

export const mockExamSetSignature = (set: MockExamPassageSet) =>
  JSON.stringify([set.instruction || "", set.passage || "", set.image || ""]);

export const getMockExamSetRun = (
  questions: MockExamMaterialQuestion[],
  index: number,
) => {
  const set = questions[index]?.passageSet;
  if (!set?.id) return null;
  const same = (i: number) =>
    questions[i]?.passageSet?.id === set.id &&
    questions[i]?.examRound === questions[index]?.examRound &&
    mockExamSetSignature(questions[i].passageSet!) ===
      mockExamSetSignature(set);
  let start = index,
    end = index;
  while (start > 0 && same(start - 1)) start--;
  while (end + 1 < questions.length && same(end + 1)) end++;
  return { start, end, passageSet: set };
};

export const validateMockExamMaterials = (
  question: MockExamMaterialQuestion,
) => {
  if (
    question.examplePassage != null &&
    (typeof question.examplePassage !== "string" ||
      question.examplePassage.length > 20_000)
  )
    return "보기는 20,000자 이내로 입력해 주세요.";
  const set = question.passageSet;
  if (!set) return "";
  if (!/^[\w-]{1,160}$/.test(set.id)) return "공통 지문을 다시 선택해 주세요.";
  if (typeof set.instruction !== "string" || set.instruction.length > 300)
    return "세트 발문은 300자 이내로 입력해 주세요.";
  if (
    typeof set.passage !== "string" ||
    set.passage.length > 40_000 ||
    (!set.passage.trim() && !set.image)
  )
    return "공통 지문이나 자료 이미지를 입력해 주세요.";
  return "";
};

/** Local preflight; the same constraints are also enforced by the save API. */
export const validateMockExamSetCollection = (
  questions: MockExamMaterialQuestion[],
) => {
  const groups = new Map<string, MockExamMaterialQuestion[]>();
  for (const q of questions) {
    const error = validateMockExamMaterials(q);
    if (error) return error;
    if (q.passageSet) {
      const key = `${q.examRound || ""}\n${q.passageSet.id}`;
      groups.set(key, [...(groups.get(key) || []), q]);
    }
  }
  for (const group of groups.values()) {
    if (
      new Set(group.map((q) => mockExamSetSignature(q.passageSet!))).size !== 1
    )
      return "같은 세트의 공통 지문은 동일해야 합니다. 새 세트로 분리하거나 기존 지문을 연결해 주세요.";
    const orders = group
      .map((q) => q.paperOrder)
      .sort((a, b) => Number(a) - Number(b));
    if (
      orders.some(
        (n, i) =>
          !Number.isInteger(n) ||
          (i > 0 && Number(n) !== Number(orders[i - 1]) + 1),
      )
    )
      return "세트 문항의 번호는 연속되게 지정해 주세요.";
  }
  return "";
};
